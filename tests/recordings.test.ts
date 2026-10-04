import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessionStore } from '../server/session-store';
import { recoverRecordings, writeManifest } from '../server/recordings';

// A session's videos are written while the app runs and only move next to its database when
// Artemis closes properly. When it does not (killed, crashed, power cut), the next launch puts
// what survived where it belongs, using the manifest each recording folder keeps.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'artemis-recover-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const folder = async (name: string, files: Record<string, string>) => {
  const d = join(dir, name);
  await mkdir(join(d, 'video'), { recursive: true });
  for (const [f, text] of Object.entries(files)) await writeFile(join(d, 'video', f), text);
  return d;
};

describe('recovering an interrupted session', () => {
  test('the videos of a session cut short move next to its database and are listed in it', async () => {
    const database = join(dir, '20261004T220000-shop.example.sqlite');
    openSessionStore(database, { target: 'http://shop.example/', startedAt: 1 }).close();
    const d = await folder('.recording-100', { 'page@a.webm': 'site frames', 'page@b.webm': 'console frames' });
    await writeManifest(d, { launchedAt: 100, siteVideo: join(d, 'video', 'page@a.webm'), consoleVideo: join(d, 'video', 'page@b.webm'), database });

    const recovered = await recoverRecordings(dir);

    expect(recovered).toEqual([database]);
    const base = database.replace(/\.sqlite$/, '');
    expect(await Bun.file(`${base}.site.webm`).text()).toBe('site frames');
    expect(await Bun.file(`${base}.console.webm`).text()).toBe('console frames');
    const db = new Database(database, { readonly: true });
    expect(db.query('SELECT kind, file, started_at FROM artifacts ORDER BY kind').all()).toEqual([
      { kind: 'video-console', file: '20261004T220000-shop.example.console.webm', started_at: 100 },
      { kind: 'video-site', file: '20261004T220000-shop.example.site.webm', started_at: 100 }
    ]);
    db.close();
    expect((await readdir(dir)).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  test('a recording where no website was ever opened is simply removed', async () => {
    const d = await folder('.recording-200', { 'page@a.webm': 'x' });
    await writeManifest(d, { launchedAt: 200, siteVideo: join(d, 'video', 'page@a.webm'), consoleVideo: null, database: null });
    expect(await recoverRecordings(dir)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  test('the recording in progress and folders without a manifest are left alone', async () => {
    const current = await folder('.recording-300', { 'page@a.webm': 'x' });
    await writeManifest(current, { launchedAt: 300, siteVideo: null, consoleVideo: null, database: null });
    await folder('.recording-400', { 'page@b.webm': 'y' });
    expect(await recoverRecordings(dir, current)).toEqual([]);
    expect((await readdir(dir)).sort()).toEqual(['.recording-300', '.recording-400']);
  });
});
