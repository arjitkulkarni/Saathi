// Saathi interactive-session lock helper (build.md §2, Ph09).
//
// Runs inside the signed-in user's interactive session (a background service cannot operate
// the interactive desktop). It listens on \\.\pipe\saathi-lock, whose ACL admits only
// LocalSystem (the agent service) and the interactive user. It accepts exactly one request
// form, "LOCK <hex-nonce>", calls LockWorkStation, and replies "LOCKED <nonce> <sessionId>"
// only after it OBSERVES the WTS_SESSION_LOCK notification for its own session; otherwise
// "NOT_OBSERVED <nonce>". Locking does not stop running programs or network activity.
//
// C# 5 compatible: builds with the .NET Framework csc.exe (see build.ps1).

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace Saathi.LockHelper
{
    internal static class Native
    {
        [DllImport("user32.dll", SetLastError = true)]
        internal static extern bool LockWorkStation();

        [DllImport("wtsapi32.dll", SetLastError = true)]
        internal static extern bool WTSRegisterSessionNotification(IntPtr hWnd, int dwFlags);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        internal static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);

        internal const int NOTIFY_FOR_THIS_SESSION = 0;
        internal const int WM_WTSSESSION_CHANGE = 0x02B1;
        internal const int WTS_SESSION_LOCK = 0x7;
        internal const int WTS_SESSION_UNLOCK = 0x8;
    }

    /// <summary>Hidden window that receives session-change notifications.</summary>
    internal sealed class SessionWatcher : NativeWindow, IDisposable
    {
        private readonly ManualResetEvent locked = new ManualResetEvent(false);
        private volatile bool isLocked;

        public SessionWatcher()
        {
            CreateHandle(new CreateParams());
            if (!Native.WTSRegisterSessionNotification(Handle, Native.NOTIFY_FOR_THIS_SESSION))
                throw new InvalidOperationException("WTSRegisterSessionNotification failed: " + Marshal.GetLastWin32Error());
        }

        public bool IsLocked { get { return isLocked; } }

        public void ResetLockSignal() { locked.Reset(); }

        public bool WaitForLock(int timeoutMs) { return locked.WaitOne(timeoutMs); }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_WTSSESSION_CHANGE)
            {
                int code = m.WParam.ToInt32();
                if (code == Native.WTS_SESSION_LOCK) { isLocked = true; locked.Set(); }
                else if (code == Native.WTS_SESSION_UNLOCK) { isLocked = false; }
            }
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            Native.WTSUnRegisterSessionNotification(Handle);
            DestroyHandle();
            locked.Dispose();
        }
    }

    internal static class Program
    {
        private const string PipeName = "saathi-lock";
        private static readonly Regex Request = new Regex("^LOCK ([0-9a-f]{8,64})$", RegexOptions.CultureInvariant);

        [STAThread]
        private static int Main(string[] args)
        {
            using (SessionWatcher watcher = new SessionWatcher())
            {
                Thread server = new Thread(delegate () { Serve(watcher); });
                server.IsBackground = true;
                server.Start();
                Application.Run();
            }
            return 0;
        }

        private static PipeSecurity BuildSecurity()
        {
            PipeSecurity sec = new PipeSecurity();
            SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            sec.AddAccessRule(new PipeAccessRule(system, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            sec.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance, AccessControlType.Allow));
            return sec;
        }

        private static void Serve(SessionWatcher watcher)
        {
            int sessionId = Process.GetCurrentProcess().SessionId;
            while (true)
            {
                try
                {
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.None, 256, 256, BuildSecurity()))
                    {
                        pipe.WaitForConnection();
                        StreamReader reader = new StreamReader(pipe, Encoding.ASCII, false, 256, true);
                        StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false), 256, true);
                        writer.AutoFlush = true;
                        string line = ReadLine(reader, 100);
                        if (line == null) continue; // health probe: connect and close
                        Match m = Request.Match(line.Trim());
                        if (!m.Success) { writer.Write("REJECTED\n"); continue; }
                        string nonce = m.Groups[1].Value;
                        watcher.ResetLockSignal();
                        bool requested = Native.LockWorkStation();
                        bool observed = requested && watcher.WaitForLock(10000);
                        writer.Write(observed ? ("LOCKED " + nonce + " " + sessionId + "\n") : ("NOT_OBSERVED " + nonce + "\n"));
                    }
                }
                catch (IOException) { /* client went away */ }
                catch (Exception ex) { Console.Error.WriteLine("saathi-lock: " + ex.Message); Thread.Sleep(1000); }
            }
        }

        private static string ReadLine(StreamReader reader, int maxChars)
        {
            StringBuilder sb = new StringBuilder();
            int c;
            while ((c = reader.Read()) != -1)
            {
                if (c == '\n') return sb.ToString();
                if (sb.Length >= maxChars) return null;
                sb.Append((char)c);
            }
            return sb.Length > 0 ? sb.ToString() : null;
        }
    }
}
