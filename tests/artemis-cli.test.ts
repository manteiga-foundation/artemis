import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, type ViteServer } from './vite';
import { harProblems } from './har-spec';

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
beforeAll(async () => {
  vite = await startVite();
  dir = await mkdtemp(join(tmpdir(), 'artemis-cli-'));
}, 30000);
afterAll(async () => {
  vite?.stop();
  site.stop(true);
  walker.stop(true);
  await rm(dir, { recursive: true, force: true });
});

test('one Ctrl+C in the terminal saves the session whole: database, both videos and the HAR', async () => {
  const sessions = join(dir, 'sessions');
  // Its own process group, like a terminal's foreground job, so the signal can go to all of it.
  const proc = spawn('bun', ['run', 'artemis', `http://localhost:${site.port}/`], {
    cwd: new URL('..', import.meta.url).pathname,
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
  };
  try {
    // The website was opened from the command line and its session started.
    const started = Date.now();
    const database = async () => (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
    while (!(await database()) && Date.now() - started < 30000) await Bun.sleep(200);
    expect(await database()).toBeDefined();
    await Bun.sleep(1500);

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

test('killed outright mid-session (kill -9), nothing browsed is lost: the session file on its own holds it', async () => {
  const root = join(dir, 'crash');
  const sessions = join(root, 'sessions');
  const profile = join(root, 'profile');
  const proc = spawn('bun', ['run', 'artemis', `http://localhost:${walker.port}/`], {
    cwd: new URL('..', import.meta.url).pathname,
    detached: true,
    env: { ...process.env, ARTEMIS_PORT: new URL(vite.url).port, ARTEMIS_SHELL_HIDDEN: '1', ARTEMIS_PROFILE_DIR: profile, ARTEMIS_SESSIONS_DIR: sessions },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  // Playwright starts Electron in its own process group: kill it by the test's own profile path.
  const killAll = () => {
    try {
      process.kill(-proc.pid!, 'SIGKILL');
    } catch {
      // already gone
    }
    Bun.spawnSync(['pkill', '-9', '-f', profile]);
  };
  const WALKED = `SELECT (SELECT count(*) FROM visits) AS visits,
                         (SELECT count(*) FROM requests r JOIN bodies b ON b.hash = r.res_body_hash WHERE r.url LIKE '%/api/config%') AS config`;
  const walked = [{ visits: 2, config: 2 }];
  try {
    const started = Date.now();
    let database: string | undefined;
    let live: unknown = null;
    while (Date.now() - started < 30000) {
      database ??= (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
      if (database) live = JSON.parse(Bun.spawnSync(['sqlite3', '-readonly', '-json', join(sessions, database), WALKED]).stdout.toString() || 'null');
      if (JSON.stringify(live) === JSON.stringify(walked)) break;
      await Bun.sleep(200);
    }
    // Read live by another process while Artemis runs.
    expect(live).toEqual(walked);
    await Bun.sleep(1500); // one second for the file itself to catch up, and some
    killAll();
    for (let i = 0; i < 50 && Bun.spawnSync(['pgrep', '-f', profile]).exitCode === 0; i++) await Bun.sleep(100);

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
