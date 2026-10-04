// The files a session writes beside its database while the app runs (videos now; the HAR is only
// written when Artemis closes the app properly). Each launch records into a hidden
// `.recording-<time>` folder with a manifest saying which video is which and which session they
// belong to; a proper close moves them (server/shell.ts). When the close never happened (killed,
// crashed, power cut), the next launch recovers what survived with recoverRecordings().
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { addArtifacts } from './session-store';

export interface RecordingManifest {
  /** Epoch ms the app (and so the videos) started. */
  launchedAt: number;
  siteVideo: string | null;
  consoleVideo: string | null;
  /** The session's database, once a website was opened. */
  database: string | null;
}

const MANIFEST = 'manifest.json';

export const writeManifest = (folder: string, m: RecordingManifest) => writeFile(join(folder, MANIFEST), JSON.stringify(m, null, 2));

const exists = (path: string | null): Promise<boolean> => (path ? Bun.file(path).exists() : Promise.resolve(false));

/**
 * Moves the videos of interrupted sessions next to their databases and lists them there; removes
 * recordings of launches that never opened a website. Leaves `except` (the recording in progress)
 * and folders without a manifest alone. Returns the databases that got their videos back.
 */
export async function recoverRecordings(sessionsDir: string, except?: string): Promise<string[]> {
  const recovered: string[] = [];
  const names = await readdir(sessionsDir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.startsWith('.recording-'))) {
    const folder = join(sessionsDir, name);
    if (except && folder === except) continue;
    const manifest = Bun.file(join(folder, MANIFEST));
    if (!(await manifest.exists())) continue;
    const m = (await manifest.json().catch(() => null)) as RecordingManifest | null;
    if (!m) continue;
    if (m.database && (await exists(m.database))) {
      const base = m.database.replace(/\.sqlite$/, '');
      const artifacts = [];
      for (const [kind, from, to] of [
        ['video-site', m.siteVideo, `${base}.site.webm`],
        ['video-console', m.consoleVideo, `${base}.console.webm`]
      ] as const) {
        if (!(await exists(from)) || (await exists(to))) continue;
        await rename(from!, to);
        artifacts.push({ kind, file: basename(to), startedAt: m.launchedAt });
      }
      if (artifacts.length) {
        addArtifacts(m.database, artifacts);
        recovered.push(m.database);
      }
    }
    await rm(folder, { recursive: true, force: true });
  }
  return recovered;
}
