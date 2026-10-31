import { execFile } from 'node:child_process';

// Fixed PowerShell execution. Scripts are compile-time constants in this package. Values
// that vary (bookmarks, validated command parameters) are passed ONLY through SAATHI_*
// environment variables after strict validation, never concatenated into script text.

const PRELUDE = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference='SilentlyContinue';";

export type PsResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function runPs<T = unknown>(script: string, env: Record<string, string> = {}, timeoutMs = 60_000): Promise<PsResult<T>> {
  for (const k of Object.keys(env)) if (!/^SAATHI_[A-Z_]+$/.test(k)) throw new Error(`refusing non-SAATHI env var ${k}`);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PRELUDE + script],
      { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: (stderr || err.message).trim().slice(0, 500) });
        const text = stdout.trim();
        if (!text) return resolve({ ok: true, value: null as T });
        try {
          resolve({ ok: true, value: JSON.parse(text) as T });
        } catch {
          resolve({ ok: false, error: `unparseable output: ${text.slice(0, 200)}` });
        }
      },
    );
  });
}

/** Run a fixed executable with an argument array (no shell). */
export function runExe(file: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr || err?.message || '') }));
  });
}
