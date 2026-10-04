import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, type ViteServer } from './vite';

// `bun run artemis` as the operator runs it, stopped as the operator stops it: one Ctrl+C in the
// terminal. The terminal signals the whole foreground process group, so the package script's
// `bun run` wrapper and the launcher both receive it (and the wrapper passes it on): the launcher
// must still read it as one press and save the session whole (database, both videos, HAR).

const site = Bun.serve({
  hostname: 'localhost',
  port: 0,
  fetch: () => new Response('<!doctype html><title>Shop</title><h1>Home</h1>', { headers: { 'content-type': 'text/html' } })
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
