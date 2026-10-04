// Launch the owned browser: the Electron shell (shell/main.ts) under Playwright's Electron mode.
// Playwright keeps owning it, so the console page and the website's page are ordinary Playwright
// pages (automation, video, tracing, routing), and the machine feed pushes the header readouts.
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startMachineFeed } from './machine';
import { startRecorder, type Recorder } from './recorder';

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
}

export async function launchShell(o: LaunchShellOptions): Promise<Shell> {
  // Electron waits indefinitely on a console page that cannot load: check first, and say why.
  const answers = await fetch(o.appUrl, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  if (!answers) throw new Error(`nothing answers on ${o.appUrl}: start the dev server (bun run dev), or use bun run artemis`);
  const main = await buildShell();
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
    recordVideo: o.recordVideo
  });
  const origin = new URL(o.appUrl).origin;
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
  const stopFeed = startMachineFeed(consolePage, o.userDataDir);
  app.on('close', stopFeed);
  const site = () => app.windows().find((p) => !isConsole(p));
  let recorder: Recorder | null = null;
  if (o.sessionsDir) {
    await mkdir(o.sessionsDir, { recursive: true });
    let sitePage = site();
    for (let i = 0; i < 200 && !sitePage; i++) sitePage = (await Bun.sleep(50), site());
    if (sitePage) recorder = startRecorder({ app, site: sitePage, sessionsDir: o.sessionsDir });
  }
  return {
    app,
    console: consolePage,
    site,
    recorder,
    state: () => app.evaluate(() => (globalThis as unknown as { __artemisShell: ShellState }).__artemisShell),
    close: async () => {
      stopFeed();
      await recorder?.stop();
      await app.close();
    }
  };
}
