// Launch the owned browser: the Electron shell (shell/main.ts) under Playwright's Electron mode.
// Playwright keeps owning it, so the console page and the website's page are ordinary Playwright
// pages (automation, video, tracing, routing), and the machine feed pushes the header readouts.
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { startMachineFeed } from './machine';
import { startRecorder, type Recorder } from './recorder';
import { startSiteFeed } from './site-feed';
import { addArtifacts } from './session-store';

const require = createRequire(import.meta.url);
const SHELL_SRC = new URL('../shell/', import.meta.url).pathname;
export const SHELL_OUT = new URL('../dist-shell/', import.meta.url).pathname;

/** Bundle the shell's main process and preloads into CommonJS for Electron. Returns main's path. */
export async function buildShell(): Promise<string> {
  const result = await Bun.build({
    entrypoints: ['main.ts', 'site-preload.ts', 'console-preload.ts'].map((f) => SHELL_SRC + f),
    outdir: SHELL_OUT,
    target: 'node',
    format: 'cjs',
    external: ['electron'],
    naming: '[name].cjs'
  });
  if (!result.success) throw new Error(`shell build failed:\n${result.logs.join('\n')}`);
  return SHELL_OUT + 'main.cjs';
}

export interface ShellState {
  passThrough: boolean;
  siteVisible: boolean;
  editable: boolean;
  layout: { visible: boolean; x: number; y: number; w: number; h: number } | null;
  siteUrl: string;
}

export interface Shell {
  app: ElectronApplication;
  /** The Artemis console. */
  console: Page;
  /** The website's page (about:blank until the console engages). */
  site(): Page | undefined;
  /** Records the session into SQLite when `sessionsDir` was given. */
  recorder: Recorder | null;
  /** Resolves once the app has closed and the session's files are in place (null: no session). */
  finished(): Promise<SessionFiles | null>;
  state(): Promise<ShellState>;
  close(): Promise<void>;
}

export interface LaunchShellOptions {
  /** Where the console is served, e.g. http://127.0.0.1:5173 */
  appUrl: string;
  /** Persistent profile directory (cookies, logins survive restarts). */
  userDataDir: string;
  /** Never show the windows (tests). */
  hidden?: boolean;
  recordVideo?: { dir: string; size?: { width: number; height: number } };
  /** Record each browsing session as a SQLite file in this directory. */
  sessionsDir?: string;
  /**
   * With `sessionsDir`: also keep a video of the website and of the console, and a HAR of the
   * site's traffic, next to the session file. Both on by default until the configuration view.
   */
  record?: { video?: boolean; har?: boolean };
}

/** Video frame size: the shell's window, so the website stays legible. */
const VIDEO_SIZE = { width: 1440, height: 900 };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Files a session left next to its database. */
export interface SessionFiles {
  database: string;
  siteVideo: string | null;
  consoleVideo: string | null;
  har: string | null;
}

export async function launchShell(o: LaunchShellOptions): Promise<Shell> {
  // Electron waits indefinitely on a console page that cannot load: check first, and say why.
  const answers = await fetch(o.appUrl, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  if (!answers) throw new Error(`nothing answers on ${o.appUrl}: start the dev server (bun run dev), or use bun run artemis`);
  const main = await buildShell();
  const origin = new URL(o.appUrl).origin;
  // Recordings are written while the app runs and only complete when it closes, before anyone
  // knows the session's name: they start in a hidden folder and move next to the database.
  const launchedAt = Date.now();
  const scratch = o.sessionsDir ? join(o.sessionsDir, `.recording-${launchedAt}`) : null;
  const video = scratch && o.record?.video !== false ? { dir: join(scratch, 'video'), size: VIDEO_SIZE } : undefined;
  const har = scratch && o.record?.har !== false ? join(scratch, 'session.har') : null;
  if (scratch) await mkdir(scratch, { recursive: true });
  const app = await _electron.launch({
    executablePath: require('electron') as string,
    // The profile flag on the command line lets the machine feed find Artemis's process tree.
    args: [main, `--user-data-dir=${o.userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      ARTEMIS_APP_URL: o.appUrl,
      ARTEMIS_USER_DATA: o.userDataDir,
      ARTEMIS_SHELL_DIR: SHELL_OUT,
      ...(o.hidden ? { ARTEMIS_SHELL_HIDDEN: '1' } : {})
    },
    recordVideo: o.recordVideo ?? video,
    // The site's traffic only: the console's own requests are left out.
    ...(har ? { recordHar: { path: har, urlFilter: new RegExp(`^(?!${escapeRegExp(origin)})`) } } : {})
  });
  const isConsole = (p: Page) => p.url().startsWith(origin);
  let consolePage: Page | undefined;
  for (let i = 0; i < 200 && !consolePage; i++) {
    consolePage = app.windows().find(isConsole);
    if (!consolePage) await Bun.sleep(50);
  }
  if (!consolePage) {
    await app.close();
    throw new Error(`the console never opened on ${o.appUrl}`);
  }
  const consoleWindow = consolePage;
  const stopFeed = startMachineFeed(consolePage, o.userDataDir);
  app.on('close', stopFeed);
  const site = () => app.windows().find((p) => !isConsole(p));
  let sitePage: Page | undefined;
  let recorder: Recorder | null = null;
  if (o.sessionsDir) {
    await mkdir(o.sessionsDir, { recursive: true });
    sitePage = site();
    for (let i = 0; i < 200 && !sitePage; i++) sitePage = (await Bun.sleep(50), site());
    if (sitePage) recorder = startRecorder({ app, site: sitePage, sessionsDir: o.sessionsDir });
  }
  // The console's cosmos grows from the recording as it is written.
  const stopSiteFeed = recorder ? startSiteFeed(consolePage, recorder) : () => {};
  app.on('close', stopSiteFeed);

  // Once the app has closed (by close() or by the operator closing the window): move the
  // recordings next to the session's database and list them in it.
  let finishing: Promise<SessionFiles | null> | null = null;
  const finish = () =>
    (finishing ??= (async (): Promise<SessionFiles | null> => {
      await recorder?.stop();
      const database = recorder?.path() ?? null;
      const base = database?.replace(/\.sqlite$/, '') ?? null;
      const keep = async (v: ReturnType<Page['video']> | undefined, file: string | null) => {
        if (!v) return null;
        if (file) await v.saveAs(file).catch(() => {});
        await v.delete().catch(() => {});
        return file && (await Bun.file(file).exists()) ? file : null;
      };
      const files: SessionFiles | null = base
        ? {
            database: database!,
            siteVideo: await keep(sitePage?.video(), `${base}.site.webm`),
            consoleVideo: await keep(consoleWindow.video(), `${base}.console.webm`),
            har: har && (await Bun.file(har).exists()) ? (await rename(har, `${base}.har`), `${base}.har`) : null
          }
        : (await keep(sitePage?.video(), null), await keep(consoleWindow.video(), null), null);
      if (files) {
        const name = (f: string) => basename(f);
        addArtifacts(files.database, [
          ...(files.har ? [{ kind: 'har', file: name(files.har), startedAt: launchedAt }] : []),
          ...(files.consoleVideo ? [{ kind: 'video-console', file: name(files.consoleVideo), startedAt: launchedAt }] : []),
          ...(files.siteVideo ? [{ kind: 'video-site', file: name(files.siteVideo), startedAt: launchedAt }] : [])
        ]);
      }
      if (scratch) await rm(scratch, { recursive: true, force: true });
      return files;
    })());
  if (o.sessionsDir) app.on('close', () => void finish());

  return {
    app,
    console: consolePage,
    site,
    recorder,
    finished: () => finish(),
    state: () => app.evaluate(() => (globalThis as unknown as { __artemisShell: ShellState }).__artemisShell),
    close: async () => {
      stopFeed();
      stopSiteFeed();
      await recorder?.stop();
      await app.close();
      if (o.sessionsDir) await finish();
    }
  };
}
