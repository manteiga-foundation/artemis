import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, type ViteServer } from './vite';
import { harProblems } from './har-spec';
import { fileURLToPath } from 'node:url';
import { queryOutside } from './sqlite-outside';
import { killTree, pressCtrlC, stillRunning } from './kill-tree';
import { removeTree } from './remove-tree';

// `bun run artemis` as the operator runs it, stopped as the operator stops it: one Ctrl+C in the
// terminal. The terminal signals the whole foreground process group, so the package script's
// `bun run` wrapper and the launcher both receive it (and the wrapper passes it on): the launcher
// must still read it as one press and save the session whole (database, both videos, HAR).

const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch: () => new Response('<!doctype html><title>Shop</title><h1>Home</h1>', { headers: { 'content-type': 'text/html' } })
});

// A site that browses itself (the launcher's test cannot click): Home reads its config, then
// goes on to Next, which reads its own and stays. It moves on after a moment, as a person does:
// leaving the instant a response is read discards its body before the recorder can ask for it.
const walker = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/config') return Response.json({ page: url.searchParams.get('page') });
    const next = url.pathname === '/' ? "setTimeout(() => (location.href = '/next'), 600)" : '';
    return new Response(
      `<!doctype html><title>Walk</title><h1>${url.pathname}</h1><script>fetch('/api/config?page=' + location.pathname).then((r) => r.json()).then(() => { ${next} })</script>`,
      { headers: { 'content-type': 'text/html', ...(url.pathname === '/' ? { 'set-cookie': 'sid=walk; Path=/' } : {}) } }
    );
  }
});

let vite: ViteServer;
let dir: string;

// A small site to fly: four pages, each linking to all the others.
const flyer = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (!['/', '/a', '/b', '/c'].includes(path)) return new Response('not found', { status: 404 });
    const nav = ['/', '/a', '/b', '/c'].map((p) => `<a href="${p}">${p === '/' ? 'Home' : p.slice(1).toUpperCase()}</a>`).join(' ');
    return new Response(`<!doctype html><title>Fly ${path}</title><nav>${nav}</nav><h1>${path}</h1>`, { headers: { 'content-type': 'text/html' } });
  }
});
beforeAll(async () => {
  vite = await startVite();
  dir = await mkdtemp(join(tmpdir(), 'artemis-cli-'));
}, 30000);
afterAll(async () => {
  vite?.stop();
  site.stop(true);
  walker.stop(true);
  flyer.stop(true);
  await removeTree(dir);
});

// A terminal's Ctrl+C reaches the job's POSIX process group; on Windows it is a console control
// event, the test after this one.
test.skipIf(process.platform === 'win32')('one Ctrl+C in the terminal saves the session whole: database, both videos and the HAR', async () => {
  const sessions = join(dir, 'sessions');
  // Its own process group, like a terminal's foreground job, so the signal can go to all of it.
  const proc = spawn('bun', ['run', 'artemis', `http://localhost:${site.port}/`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    detached: true,
    env: {
      ...process.env,
      ARTEMIS_PORT: new URL(vite.url).port,
      ARTEMIS_SHELL_HIDDEN: '1',
      ARTEMIS_PROFILE_DIR: join(dir, 'profile'),
      ARTEMIS_SESSIONS_DIR: sessions
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  proc.stdout!.on('data', (b) => (out += String(b)));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  const group = (signal: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid!, signal);
    } catch {
      // already gone
    }
    // Playwright starts Electron in its own process group: a failed run must not leave it behind.
    if (signal === 'SIGKILL') killTree(proc.pid!, join(dir, 'profile'));
  };
  try {
    // The website was opened from the command line and its session started.
    const started = Date.now();
    const database = async () => (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
    while (!(await database()) && Date.now() - started < 30000) await Bun.sleep(200);
    expect(await database()).toBeDefined();
    await Bun.sleep(1500);

    // Before anything closes, the terminal already shows the welcome and both files' full paths,
    // printed the moment they were created.
    expect(out).toContain('WEB APPLICATION INTELLIGENT CONSOLE');
    expect(out).toContain('███████╗███╗   ███╗');
    const db = join(sessions, (await database())!);
    expect(out).toMatch(new RegExp(`SESSION\\s+Database\\s+${db.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(out).toMatch(new RegExp(`HAR\\s+Live HAR\\s+${db.replace(/\.sqlite$/, '.har').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    group('SIGINT'); // one Ctrl+C
    const code = await Promise.race([exited, Bun.sleep(30000).then(() => 'still running')]);
    expect(out).not.toContain('without saving');
    expect(out).toContain('session saved');
    expect(code).toBe(0);

    const files = await readdir(sessions);
    const base = (await database())!.replace(/\.sqlite$/, '');
    for (const ext of ['.site.webm', '.console.webm', '.har']) expect(files).toContain(`${base}${ext}`);
    expect(files.filter((n) => n.startsWith('.'))).toEqual([]);
  } finally {
    group('SIGKILL');
  }
}, 90000);

test.skipIf(process.platform !== 'win32')('Windows: one Ctrl+C in the console saves the session whole: database, both videos and the HAR', async () => {
  const root = join(dir, 'console');
  const sessions = join(root, 'sessions');
  const profile = join(root, 'profile');
  const log = join(root, 'terminal.log');
  await mkdir(root, { recursive: true });
  // A console of its own, as a person's PowerShell or Windows Terminal window: Node's detached
  // child on Windows has no console at all, so `start` opens one and the output goes to a file.
  // The inner command whole in quotes, so the redirection is the inner console's, not `start`'s.
  const proc = spawn('cmd', ['/c', 'start', '"artemis"', '/min', 'cmd', '/c', `"bun run artemis http://localhost:${site.port}/ > ${log} 2>&1"`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ARTEMIS_PORT: new URL(vite.url).port, ARTEMIS_SHELL_HIDDEN: '1', ARTEMIS_PROFILE_DIR: profile, ARTEMIS_SESSIONS_DIR: sessions },
    stdio: 'ignore',
    windowsVerbatimArguments: true
  });
  await new Promise((resolve) => proc.on('exit', resolve));
  const out = async () => (await Bun.file(log).exists() ? await Bun.file(log).text() : '');
  const consolePid = () => {
    const r = Bun.spawnSync(['powershell', '-NoProfile', '-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -and $_.CommandLine.Contains('${log}') } | Select-Object -First 1).ProcessId`]);
    return Number(r.stdout.toString().trim()) || 0;
  };
  try {
    const started = Date.now();
    const database = async () => (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
    while (!(await database()) && Date.now() - started < 30000) await Bun.sleep(200);
    expect(await database()).toBeDefined();
    await Bun.sleep(1500);
    expect(await out()).toContain('WEB APPLICATION INTELLIGENT CONSOLE');

    expect(pressCtrlC(consolePid())).toBe(true); // one Ctrl+C
    for (const until = Date.now() + 30000; Date.now() < until && !(await out()).includes('session saved'); ) await Bun.sleep(200);
    expect(await out()).not.toContain('without saving');
    expect(await out()).toContain('session saved');
    // Then everything ends: the launcher, its console and the browser.
    for (let i = 0; i < 100 && (consolePid() || stillRunning(profile)); i++) await Bun.sleep(100);
    expect(stillRunning(profile)).toBe(false);

    const files = await readdir(sessions);
    const base = (await database())!.replace(/\.sqlite$/, '');
    for (const ext of ['.site.webm', '.console.webm', '.har']) expect(files).toContain(`${base}${ext}`);
    expect(files.filter((n) => n.startsWith('.'))).toEqual([]);
  } finally {
    const pid = consolePid();
    if (pid) killTree(pid, profile);
  }
}, 90000);

test('killed outright mid-session (kill -9), nothing browsed is lost: the session file on its own holds it', async () => {
  const root = join(dir, 'crash');
  const sessions = join(root, 'sessions');
  const profile = join(root, 'profile');
  const proc = spawn('bun', ['run', 'artemis', `http://localhost:${walker.port}/`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    detached: true,
    env: { ...process.env, ARTEMIS_PORT: new URL(vite.url).port, ARTEMIS_SHELL_HIDDEN: '1', ARTEMIS_PROFILE_DIR: profile, ARTEMIS_SESSIONS_DIR: sessions },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  // Playwright starts Electron in its own process group: kill it by the test's own profile path.
  const killAll = () => killTree(proc.pid!, profile);
  // Both pages and both config calls completed; the body of the page still open. The first page's
  // body is not asked for: Chromium drops a page's bodies once it navigates, and under heavy load
  // Playwright's fetch can come after the walker moves on (600 ms later); the database then says
  // "unavailable" instead of holding it (reproduced with ten `yes` processes on eight cores).
  const WALKED = `SELECT (SELECT count(*) FROM visits) AS visits,
                         (SELECT count(*) FROM requests WHERE url LIKE '%/api/config%' AND status = 200) AS config,
                         (SELECT count(*) FROM requests r JOIN bodies b ON b.hash = r.res_body_hash WHERE r.url LIKE '%/api/config?page=/next') AS openBody`;
  const walked = [{ visits: 2, config: 2, openBody: 1 }];
  try {
    const started = Date.now();
    let database: string | undefined;
    let live: unknown = null;
    while (Date.now() - started < 60000) {
      database ??= (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
      if (database) {
        try {
          live = queryOutside(join(sessions, database), WALKED);
        } catch {
          live = null; // no tables yet
        }
      }
      if (JSON.stringify(live) === JSON.stringify(walked)) break;
      await Bun.sleep(200);
    }
    // Read live by another process while Artemis runs.
    if (JSON.stringify(live) !== JSON.stringify(walked) && database)
      console.error('config rows:', JSON.stringify(queryOutside(join(sessions, database), "SELECT url, status, t_end, res_body_hash, res_body_note FROM requests WHERE url LIKE '%/api/config%'")));
    expect(live).toEqual(walked);
    await Bun.sleep(1500); // one second for the file itself to catch up, and some
    killAll();
    for (let i = 0; i < 50 && stillRunning(profile); i++) await Bun.sleep(100);

    // Only the `.sqlite`, as a backup, a sync folder or another machine would get it.
    const copy = join(root, 'copy.sqlite');
    await copyFile(join(sessions, database!), copy);
    const db = new Database(copy);
    try {
      expect(db.query(WALKED).all()).toEqual(walked);
      // Never closed: the session says so instead of pretending it ended.
      expect(db.query('SELECT ended_at FROM sessions').get()).toEqual({ ended_at: null });
    } finally {
      db.close();
    }

    // The HAR beside it survived too, whole and valid (Playwright's was only written at close):
    // both pages' config calls, the second carrying the session cookie Home set.
    const har = (await Bun.file(join(sessions, database!.replace(/\.sqlite$/, '.har'))).json().catch(() => null)) as {
      log: { entries: { request: { url: string; cookies: { name: string; value: string }[] } }[] };
    } | null;
    expect(harProblems(har)).toEqual([]);
    const configs = har!.log.entries.filter((e) => e.request.url.includes('/api/config'));
    expect(configs.map((e) => new URL(e.request.url).searchParams.get('page')).sort()).toEqual(['/', '/next']);
    expect(configs.find((e) => e.request.url.endsWith('page=/next'))!.request.cookies).toContainEqual({ name: 'sid', value: 'walk' });
  } finally {
    killAll();
  }
}, 90000);

test('`--autopilot max` flies the site once it has loaded, and the terminal says so: engaged, covered; its clicks recorded as its own', async () => {
  const root = join(dir, 'fly');
  const sessions = join(root, 'sessions');
  const profile = join(root, 'profile');
  const proc = spawn('bun', ['run', 'artemis', `http://localhost:${flyer.port}/`, '--autopilot', 'max'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    detached: true,
    env: { ...process.env, ARTEMIS_PORT: new URL(vite.url).port, ARTEMIS_SHELL_HIDDEN: '1', ARTEMIS_PROFILE_DIR: profile, ARTEMIS_SESSIONS_DIR: sessions },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  proc.stdout!.on('data', (b) => (out += String(b)));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  const killAll = () => killTree(proc.pid!, profile);
  try {
    const started = Date.now();
    while (!/the site is covered/i.test(out) && Date.now() - started < 45000) await Bun.sleep(200);
    expect(out).toMatch(/Autopilot\s+max · the next page as soon as one has loaded/);
    expect(out).toMatch(/AUTOPILOT\s+Engaged at max/);
    expect(out).not.toMatch(/Engaged at (slow|regular)|Speed: /);
    // Home was open already; it went to the three others.
    expect(out).toMatch(/AUTOPILOT\s+The site is covered: 3 pages visited/);

    // Read live from the session database: the clicks that took it there are the autopilot's.
    const database = (await readdir(sessions)).find((n) => n.endsWith('.sqlite'))!;
    const actors = queryOutside(join(sessions, database), "SELECT DISTINCT actor FROM actions WHERE kind = 'click'").map((r) => r.actor).join('\n');
    expect(actors).toBe('autopilot');

    if (process.platform !== 'win32') {
      process.kill(-proc.pid!, 'SIGINT');
      expect(await Promise.race([exited, Bun.sleep(30000).then(() => 'still running')])).toBe(0);
      expect(out).toContain('session saved');
    }
  } finally {
    killAll();
  }
}, 90000);
