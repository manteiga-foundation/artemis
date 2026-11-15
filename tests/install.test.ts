import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// The one-command install, as a new user runs it: `curl -fsSL .../install.sh | sh`. The script
// arrives on standard input, fetches Artemis as a release tarball (here a tarball of this working
// tree, shaped like GitHub's: one top folder), installs its dependencies and puts an `artemis`
// command on the PATH. Everything it owns lives under one home; `artemis update` replaces the
// app and never touches the profile (the reviewed sites' logins) or the recorded sessions.
// Bun and the dependency caches are the machine's own, so a second run takes seconds.

const root = new URL('..', import.meta.url).pathname;
const INSTALL = 300_000;

let tmp: string;
let home: string;
let bin: string;
let user: string;
let source: string;

// A new user's home: the script writes only there (its rc file included). The download caches
// stay the machine's own, as they would be for that user on a second install.
const real = homedir();
const caches =
  process.platform === 'darwin'
    ? { electron_config_cache: join(real, 'Library/Caches/electron'), PLAYWRIGHT_BROWSERS_PATH: join(real, 'Library/Caches/ms-playwright') }
    : { electron_config_cache: join(real, '.cache/electron'), PLAYWRIGHT_BROWSERS_PATH: join(real, '.cache/ms-playwright') };
const bunCache = spawnSync('bun', ['pm', 'cache'], { encoding: 'utf8' }).stdout.trim();

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  ...caches,
  ...(bunCache ? { BUN_INSTALL_CACHE_DIR: bunCache } : {}),
  HOME: user,
  ARTEMIS_SOURCE: `file://${source}`,
  SHELL: '/bin/zsh',
  NO_COLOR: '1',
  ...extra
});

const piped = (script: string, extra?: Record<string, string>) =>
  spawnSync('sh', [], { input: script, env: env(extra), encoding: 'utf8', timeout: INSTALL });

const artemis = (args: string[], extra?: Record<string, string>) =>
  spawnSync(join(bin, 'artemis'), args, { env: env(extra), encoding: 'utf8', timeout: INSTALL });

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'artemis-install-'));
  user = join(tmp, 'user');
  home = join(user, '.artemis');
  bin = join(user, '.local', 'bin');
  await mkdir(user, { recursive: true });
  // The working tree as git sees it (tracked and new files, ignored ones out), under one top
  // folder as GitHub's archive has it. The maintainer's untracked scratch is not Artemis.
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files = listed.stdout.split('\n').filter((f) => f && !/^scripts\/__/.test(f) && f !== 'rt-auth-probe.mjs' && existsSync(join(root, f)));
  const tree = join(tmp, 'tree', 'artemis-main');
  for (const f of files) await cp(join(root, f), join(tree, f), { recursive: true });
  source = join(tmp, 'artemis.tar.gz');
  const tar = spawnSync('tar', ['-czf', source, '-C', join(tmp, 'tree'), 'artemis-main']);
  expect(tar.status).toBe(0);
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('the one-command install', () => {
  test('one address everywhere: the README, the script’s own header and `artemis update` use artemis.n30.ai', async () => {
    const url = 'https://artemis.n30.ai/install.sh';
    const readme = await readFile(join(root, 'README.md'), 'utf8');
    const script = await readFile(join(root, 'install.sh'), 'utf8');
    expect(readme).toContain(`curl -fsSL ${url} | sh`);
    expect(script).toContain(`#   curl -fsSL ${url} | sh`);
    expect(script).toContain(`\${ARTEMIS_INSTALLER:-${url}}`);
    expect(readme + script).not.toContain('raw.githubusercontent.com');
  });
  test(
    'curl | sh installs Artemis into its home and an artemis command that answers',
    async () => {
      const run = piped(await readFile(join(root, 'install.sh'), 'utf8'));
      if (run.status !== 0) console.log(run.stdout, run.stderr);
      expect(run.status).toBe(0);
      expect(existsSync(join(home, 'app', 'package.json'))).toBe(true);
      expect(existsSync(join(home, 'app', 'node_modules', 'playwright'))).toBe(true);
      // Nothing left to fetch on the first launch: Electron's binary is in place.
      expect(existsSync(join(home, 'app', 'node_modules', 'electron', 'path.txt'))).toBe(true);
      expect(run.stdout).toContain(join(bin, 'artemis'));

      const help = artemis(['--help']);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('Usage:');
      // The profile and the sessions live in the installed home, not inside the app it replaces.
      expect(help.stdout).toMatch(new RegExp(`Profile\\s+${join(home, 'profile')}`));
      expect(help.stdout).toMatch(new RegExp(`Sessions\\s+${join(home, 'sessions')}`));
    },
    INSTALL
  );

  test(
    'puts the command on the PATH of new terminals once, however often it runs',
    async () => {
      const rc = await readFile(join(user, '.zshrc'), 'utf8');
      expect(rc.split('\n').filter((l) => l.includes(bin))).toHaveLength(1);
      const again = piped(await readFile(join(root, 'install.sh'), 'utf8'));
      expect(again.status).toBe(0);
      const after = await readFile(join(user, '.zshrc'), 'utf8');
      expect(after.split('\n').filter((l) => l.includes(bin))).toHaveLength(1);
    },
    INSTALL
  );

  test(
    'artemis update replaces the app and keeps the profile and the sessions',
    async () => {
      await mkdir(join(home, 'profile'), { recursive: true });
      await mkdir(join(home, 'sessions'), { recursive: true });
      await writeFile(join(home, 'profile', 'Cookies'), 'signed in');
      await writeFile(join(home, 'sessions', 'review.sqlite'), 'recorded');
      await writeFile(join(home, 'app', 'stale.txt'), 'from the old version');

      const update = artemis(['update'], { ARTEMIS_INSTALLER: `file://${join(root, 'install.sh')}` });
      if (update.status !== 0) console.log(update.stdout, update.stderr);
      expect(update.status).toBe(0);
      expect(existsSync(join(home, 'app', 'stale.txt'))).toBe(false);
      expect(await readFile(join(home, 'profile', 'Cookies'), 'utf8')).toBe('signed in');
      expect(await readFile(join(home, 'sessions', 'review.sqlite'), 'utf8')).toBe('recorded');
      expect(artemis(['--help']).status).toBe(0);
    },
    INSTALL
  );

  test(
    'a machine without Bun gets it from Bun’s installer, and the command finds it there',
    async () => {
      // Bun's installer stands in as a script that puts this Bun where the real one puts it.
      const fresh = join(tmp, 'fresh');
      await mkdir(fresh, { recursive: true });
      const installer = join(tmp, 'bun-install.sh');
      await writeFile(installer, `mkdir -p "$HOME/.bun/bin" && ln -s "${process.execPath}" "$HOME/.bun/bin/bun"\n`);
      const bare = { HOME: fresh, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ARTEMIS_BUN_INSTALLER: `file://${installer}`, SHELL: '/bin/bash' };
      const run = piped(await readFile(join(root, 'install.sh'), 'utf8'), bare);
      if (run.status !== 0) console.log(run.stdout, run.stderr);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain('Installing Bun');
      const rc = await readFile(join(fresh, process.platform === 'darwin' ? '.bash_profile' : '.bashrc'), 'utf8');
      expect(rc).toContain(join(fresh, '.local', 'bin'));
      const help = spawnSync(join(fresh, '.local', 'bin', 'artemis'), ['--help'], { env: env(bare), encoding: 'utf8' });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain(join(fresh, '.artemis', 'sessions'));
    },
    INSTALL
  );

  test(
    'a failed download leaves the installed version working',
    async () => {
      const broken = piped(await readFile(join(root, 'install.sh'), 'utf8'), { ARTEMIS_SOURCE: `file://${join(tmp, 'missing.tar.gz')}` });
      expect(broken.status).not.toBe(0);
      expect(broken.stderr + broken.stdout).toMatch(/download/i);
      expect(artemis(['--help']).status).toBe(0);
    },
    INSTALL
  );
});
