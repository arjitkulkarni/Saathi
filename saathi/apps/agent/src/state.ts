import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Local agent state (build.md Ph05.2). JSON files are written atomically (temp + rename).
// On Windows the directory ACL is restricted best-effort with icacls; the outcome is
// recorded and reported as a prerequisite, never assumed.

export class StateStore {
  aclRestricted: boolean | null = null;
  aclDetail: string | null = null;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  path(name: string) {
    return join(this.dir, name);
  }

  read<T>(name: string, fallback: T): T {
    const p = this.path(name);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  write(name: string, value: unknown) {
    const p = this.path(name);
    const tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, p);
  }

  /** Restrict the state directory to SYSTEM, Administrators and the current user. */
  async restrictAcl(): Promise<void> {
    if (process.platform !== 'win32') {
      this.aclRestricted = true;
      this.aclDetail = 'POSIX file modes 0600';
      return;
    }
    const user = process.env.USERNAME ? `${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${process.env.USERNAME}` : null;
    const args = [this.dir, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '/grant:r', '*S-1-5-32-544:(OI)(CI)F'];
    if (user) args.push('/grant:r', `${user}:(OI)(CI)F`);
    await new Promise<void>((resolve) => {
      execFile('icacls', args, { windowsHide: true, timeout: 15_000 }, (err, _out, stderr) => {
        this.aclRestricted = !err;
        this.aclDetail = err ? `icacls failed: ${(stderr || err.message).trim().slice(0, 200)}` : 'restricted to SYSTEM, Administrators and the agent user';
        resolve();
      });
    });
  }
}

export function defaultStateDir(simulate: boolean) {
  const base = process.env.ProgramData ?? process.env.HOME ?? '.';
  return join(base, simulate ? 'SaathiAgent-simulated' : 'SaathiAgent');
}
