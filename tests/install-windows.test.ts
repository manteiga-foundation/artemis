import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './remove-tree';

// The one-command install on Windows, as a new user runs it: `irm .../install.ps1 | iex` in
// PowerShell. The script text is evaluated the same way here (Get-Content -Raw | Invoke-Expression),
// against a tarball of this working tree shaped like GitHub's, with USERPROFILE moved to a
// temporary folder so it writes nothing of the real user's. Bun, Electron and Playwright caches
// stay the machine's own. The user PATH lives in the registry: it is read before and put back after.
// Windows only; elsewhere install.test.ts covers install.sh.

const root = fileURLToPath(new URL('..', import.meta.url));
const INSTALL = 600_000;
const windows = process.platform === 'win32';

let tmp: string;
let user: string;
let home: string;
let source: string;
let pathBefore = '';

const ps = (command: string, env: Record<string, string> = {}) =>
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: INSTALL });
const userPath = () => ps("[Environment]::GetEnvironmentVariable('Path', 'User')").stdout.trim();
const realBunCache = () => spawnSync('bun', ['pm', 'cache'], { encoding: 'utf8' }).stdout.trim();

const envFor = (extra: Record<string, string> = {}) => ({
  USERPROFILE: user,
  ARTEMIS_SOURCE: `file:///${source.replace(/\\/g, '/')}`,
  BUN_INSTALL_CACHE_DIR: realBunCache(),
  NO_COLOR: '1',
  ...extra
});
const install = (extra: Record<string, string> = {}) => ps(`Get-Content -Raw '${join(root, 'install.ps1')}' | Invoke-Expression`, envFor(extra));
const artemis = (args: string[], extra: Record<string, string> = {}) =>
  spawnSync('cmd', ['/c', join(home, 'bin', 'artemis.cmd'), ...args], { env: { ...process.env, ...envFor(extra) }, encoding: 'utf8', timeout: INSTALL });

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (/^(node_modules|data|dist|dist-shell|\.git)(\/|$)/.test(rel) || /^scripts\/__/.test(rel) || rel === 'rt-auth-probe.mjs') continue;
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

describe.skipIf(!windows)('the one-command install on Windows', () => {
  beforeAll(async () => {
    pathBefore = userPath();
    tmp = await mkdtemp(join(tmpdir(), 'artemis-install-'));
    user = join(tmp, 'user');
    home = join(user, '.artemis');
    await mkdir(user, { recursive: true });
    const tree = join(tmp, 'tree', 'artemis-main');
    for (const f of await walk(root)) await cp(f, join(tree, relative(root, f)), { recursive: true });
    source = join(tmp, 'artemis.tar.gz');
    expect(spawnSync('tar', ['-czf', source, '-C', join(tmp, 'tree'), 'artemis-main']).status).toBe(0);
  }, 120_000);

  afterAll(async () => {
    if (pathBefore) ps(`[Environment]::SetEnvironmentVariable('Path', '${pathBefore.replace(/'/g, "''")}', 'User')`);
    if (tmp) await removeTree(tmp);
  });

  test(
    'irm | iex installs Artemis into its home and an artemis command that answers, with its folder on the user PATH once',
    () => {
      const run = install();
      if (run.status !== 0) console.log(run.stdout, run.stderr);
      expect(run.status).toBe(0);
      // Only its own steps: no package lists from bun install, no download bars.
      expect(run.stdout).not.toContain('packages installed');
      expect(run.stdout.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(10);
      expect(existsSync(join(home, 'app', 'package.json'))).toBe(true);
      expect(existsSync(join(home, 'app', 'node_modules', 'electron', 'path.txt'))).toBe(true);
      expect(run.stdout).toContain(join(home, 'bin', 'artemis.cmd'));

      const help = artemis(['--help']);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('Usage:');
      expect(help.stdout).toContain(join(home, 'profile'));
      expect(help.stdout).toContain(join(home, 'sessions'));

      const again = install();
      expect(again.status).toBe(0);
      expect(userPath().split(';').filter((p) => p === join(home, 'bin'))).toHaveLength(1);
    },
    INSTALL
  );

  test(
    'artemis update replaces the app and keeps the profile and the sessions',
    async () => {
      await writeFile(join(home, 'profile', 'Cookies'), 'signed in');
      await writeFile(join(home, 'sessions', 'review.sqlite'), 'recorded');
      await writeFile(join(home, 'app', 'stale.txt'), 'from the old version');
      const update = artemis(['update'], { ARTEMIS_INSTALLER: join(root, 'install.ps1') });
      if (update.status !== 0) console.log(update.stdout, update.stderr);
      expect(update.status).toBe(0);
      expect(existsSync(join(home, 'app', 'stale.txt'))).toBe(false);
      expect(await readFile(join(home, 'profile', 'Cookies'), 'utf8')).toBe('signed in');
      expect(await readFile(join(home, 'sessions', 'review.sqlite'), 'utf8')).toBe('recorded');
    },
    INSTALL
  );

  test(
    'without the Visual C++ Runtime, declined, it stops with where to get it and leaves the installed version working',
    async () => {
      const empty = join(tmp, 'system32-without-runtime');
      await mkdir(empty, { recursive: true });
      const run = install({ ARTEMIS_SYSTEM32: empty, ARTEMIS_VCREDIST: 'no' });
      expect(run.status).not.toBe(0);
      expect(run.stdout + run.stderr).toContain('Microsoft Visual C++ Runtime');
      expect(run.stdout + run.stderr).toMatch(/aka\.ms\/vs\/17\/release\/vc_redist\.(arm64|x64)\.exe/);
      expect(artemis(['--help']).status).toBe(0);
    },
    INSTALL
  );

  test(
    'a failed download leaves the installed version working',
    () => {
      const broken = install({ ARTEMIS_SOURCE: `file:///${join(tmp, 'missing.tar.gz').replace(/\\/g, '/')}` });
      expect(broken.status).not.toBe(0);
      expect(broken.stdout + broken.stderr).toMatch(/download/i);
      expect(artemis(['--help']).status).toBe(0);
    },
    INSTALL
  );
});
