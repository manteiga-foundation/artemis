import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startVite, type ViteServer } from './vite';

// `bun run artemis` as the operator runs it, stopped as the operator stops it: Ctrl+C in the
// terminal. The session must still be saved whole (database, both videos, HAR), not cut short.

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

test('Ctrl+C in the terminal saves the session whole: database, both videos and the HAR', async () => {
  const sessions = join(dir, 'sessions');
  const proc = Bun.spawn(['bun', 'run', 'scripts/artemis.ts', `http://localhost:${site.port}/`], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      ARTEMIS_PORT: new URL(vite.url).port,
      ARTEMIS_SHELL_HIDDEN: '1',
      ARTEMIS_PROFILE_DIR: join(dir, 'profile'),
      ARTEMIS_SESSIONS_DIR: sessions
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  try {
    // The website was opened from the command line and its session started.
    const started = Date.now();
    const database = async () => (await readdir(sessions).catch(() => [] as string[])).find((n) => n.endsWith('.sqlite'));
    while (!(await database()) && Date.now() - started < 30000) await Bun.sleep(200);
    expect(await database()).toBeDefined();
    await Bun.sleep(1500);

    proc.kill('SIGINT');
    const code = await Promise.race([proc.exited, Bun.sleep(30000).then(() => 'still running')]);
    const out = await new Response(proc.stdout).text();
    expect(code).toBe(0);
    expect(out).toContain('session saved');

    const files = await readdir(sessions);
    const base = (await database())!.replace(/\.sqlite$/, '');
    for (const ext of ['.site.webm', '.console.webm', '.har']) expect(files).toContain(`${base}${ext}`);
    expect(files.filter((n) => n.startsWith('.'))).toEqual([]);
  } finally {
    proc.kill('SIGKILL');
  }
}, 90000);
