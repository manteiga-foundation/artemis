// Launch the owned browser: the Electron shell (shell/main.ts) under Playwright's Electron mode.
// Playwright keeps owning it, so the console page and the website's page are ordinary Playwright
// pages (automation, video, tracing, routing), and the machine feed pushes the header readouts.
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { startMachineFeed } from './machine';
import { linuxSandbox, missingLibraries, readSandboxFacts, shellLaunchArgs, type LinuxSandbox } from './platform';
import { startRecorder, type Recorder } from './recorder';
import { startSiteFeed } from './site-feed';
import { startAutopilot, type AutopilotEvent } from './autopilot-driver';
import { watchSiteDialogs } from './site-dialogs';
import { addArtifacts } from './session-store';
import { recoverRecordings, writeManifest } from './recordings';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SHELL_SRC = fileURLToPath(new URL('../shell/', import.meta.url));
export const SHELL_OUT = fileURLToPath(new URL('../dist-shell/', import.meta.url));
/** The app icon (rendered from public/icon.svg by scripts/icon.ts). */
export const SHELL_ICON = SHELL_SRC + 'icon.png';

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
  icon: { width: number; height: number } | null;
  autopilot: { speed: number };
  /** Certificates Chromium could not trust that the shell accepted for the site, once per origin and error. */
  certificateErrors: CertificateError[];
}

/** A site's certificate error the shell accepted (shell/main.ts): the site's own finding, reported. */
export interface CertificateError {
  /** Epoch ms first seen. */
  t: number;
  origin: string;
  url: string;
  /** Chromium's reason, e.g. net::ERR_CERT_DATE_INVALID. */
  error: string;
  issuer: string;
  subject: string;
  /** When the certificate expires (ISO), as it claims. */
  validExpiry: string;
}

export interface Shell {
  app: ElectronApplication;
  /** Linux: how Chromium's sandbox runs ('off': the system allows neither way). Null elsewhere: the platform's own. */
  sandbox: LinuxSandbox | null;
  /** How WebGL is drawn, as Chromium says (`getGPUFeatureStatus().webgl`): 'enabled' on a GPU. */
  webgl(): Promise<string>;
  /** The Artemis console. */
  console: Page;
  /** The website's page (about:blank until the console engages). */
  site(): Page | undefined;
  /** Records the session into SQLite when `sessionsDir` was given. */
  recorder: Recorder | null;
  /** Databases of earlier, interrupted sessions whose videos were put back in place at launch. */
  recovered: string[];
  /** Resolves once the app has closed and the session's files are in place (null: no session). */
  finished(): Promise<SessionFiles | null>;
  /** The autopilot's flight as the Bun side sees it (speed changes, progress, the end). */
  onAutopilot(listener: (e: AutopilotEvent) => void): () => void;
  /** Each certificate error the shell accepted for the site, as it is found (within a fifth of a second). */
  onCertificateError(listener: (c: CertificateError) => void): () => void;
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
   * site's traffic (written live by the recorder), next to the session file. Both on by default
   * until the configuration view.
   */
  record?: { video?: boolean; har?: boolean };
}

/** Video frame size: the shell's window, so the website stays legible. */
const VIDEO_SIZE = { width: 1440, height: 900 };

/** Files a session left next to its database. */
export interface SessionFiles {
  database: string;
  siteVideo: string | null;
  consoleVideo: string | null;
  har: string | null;
}

export async function launchShell(o: LaunchShellOptions): Promise<Shell> {
  // Electron waits indefinitely on a console page that cannot load: check first, and say why.
  const answers = await fetch(o.appUrl, { signal: AbortSignal.timeout(15000) }).then((r) => r.ok).catch(() => false);
  if (!answers) throw new Error(`nothing answers on ${o.appUrl}: start the dev server (bun run dev), or use bun run artemis`);
  const main = await buildShell();
  const origin = new URL(o.appUrl).origin;
  // What earlier launches could not save (killed, crashed) goes next to its session first.
  const recovered = o.sessionsDir ? await recoverRecordings(o.sessionsDir) : [];
  // Recordings are written while the app runs and only complete when it closes, before anyone
  // knows the session's name: they start in a hidden folder and move next to the database. The
  // HAR is not among them: the recorder writes it live next to the database (server/har.ts).
  const launchedAt = Date.now();
  const scratch = o.sessionsDir ? join(o.sessionsDir, `.recording-${launchedAt}`) : null;
  const video = scratch && o.record?.video !== false ? { dir: join(scratch, 'video'), size: VIDEO_SIZE } : undefined;
  if (scratch) await mkdir(scratch, { recursive: true });
  const electronPath = require('electron') as string;
  if (process.platform === 'linux') {
    const ldd = Bun.spawnSync(['ldd', electronPath], { stdout: 'pipe', stderr: 'ignore' });
    const missing = missingLibraries(ldd.stdout.toString());
    if (missing.length) throw new Error(`Electron cannot start: this system lacks ${missing.join(', ')}; install the packages that provide them (a desktop install has them all)`);
  }
  // Playwright launches Electron with --no-sandbox on Linux unless asked: ask whenever the system
  // lets Chromium sandbox the site's pages (server/platform.ts), or Electron aborts at launch.
  const sandbox = process.platform === 'linux' ? linuxSandbox(readSandboxFacts(electronPath)) : null;
  const app = await _electron.launch({
    executablePath: electronPath,
    chromiumSandbox: sandbox !== 'off',
    // The profile flag on the command line lets the machine feed find Artemis's process tree.
    args: [main, `--user-data-dir=${o.userDataDir}`, ...shellLaunchArgs(process.platform)],
    env: {
      ...(process.env as Record<string, string>),
      ARTEMIS_APP_URL: o.appUrl,
      ARTEMIS_USER_DATA: o.userDataDir,
      ARTEMIS_SHELL_DIR: SHELL_OUT,
      ARTEMIS_ICON: SHELL_ICON,
      // Electron's development build prints "Electron Security Warning" into every page's
      // developer console, the site's included: a reviewer would take it for the site's own.
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      ...(o.hidden ? { ARTEMIS_SHELL_HIDDEN: '1' } : {}),
      // A recorded session is only whole after close(): the shell hands quitting to Artemis.
      ...(o.sessionsDir ? { ARTEMIS_GRACEFUL_QUIT: '1' } : {})
    },
    recordVideo: o.recordVideo ?? video
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
  // On Windows Playwright starts Electron through a shell, and its close ends only that shell: a
  // browser held open by a site's dialog box outlived it. Electron's own pid, to end it after.
  const electronPid = process.platform === 'win32' ? await app.evaluate(() => process.pid).catch(() => 0) : 0;
  const consoleWindow = consolePage;
  // Windows has no `ps`: the header's ARTEMIS figures come from Electron's own process list there.
  const stopFeed = startMachineFeed(consolePage, o.userDataDir, 2000, () =>
    app.evaluate(({ app: electron }) => electron.getAppMetrics().map((m) => ({ cpu: m.cpu.percentCPUUsage, workingSetKB: m.memory.workingSetSize })))
  );
  app.on('close', stopFeed);
  const site = () => app.windows().find((p) => !isConsole(p));
  let sitePage: Page | undefined = site();
  for (let i = 0; i < 200 && !sitePage; i++) sitePage = (await Bun.sleep(50), site());
  let recorder: Recorder | null = null;
  if (o.sessionsDir) {
    await mkdir(o.sessionsDir, { recursive: true });
    if (sitePage) recorder = startRecorder({ app, site: sitePage, sessionsDir: o.sessionsDir, har: o.record?.har !== false });
  }
  // The autopilot flies the site when the console sets a speed (D in the Browser view).
  const autopilotListeners = new Set<(e: AutopilotEvent) => void>();
  const autopilot = sitePage ? startAutopilot({ app, site: sitePage, recorder, onEvent: (e) => autopilotListeners.forEach((l) => l(e)) }) : null;
  app.on('close', () => void autopilot?.stop());
  // The site's dialogs: the operator's are theirs (the native box); the autopilot answers its own.
  const stopDialogs = watchSiteDialogs({ app, flying: () => autopilot?.flying() ?? false, onAnswered: (text) => autopilot?.answered(text) });
  app.on('close', stopDialogs);
  // The console's cosmos grows from the recording as it is written.
  const stopSiteFeed = recorder ? startSiteFeed(consolePage, recorder) : () => {};
  app.on('close', stopSiteFeed);

  // Which video is which, and whose session they are: what a later launch needs to recover them
  // if this one never closes properly.
  const videoPath = async (p: Page | undefined) => {
    try {
      return (await p?.video()?.path()) ?? null;
    } catch {
      return null;
    }
  };
  const manifest = async () => {
    if (!scratch) return;
    const [siteVideo, consoleVideo] = await Promise.all([videoPath(sitePage), videoPath(consolePage)]);
    await writeManifest(scratch, { launchedAt, siteVideo, consoleVideo, database: recorder?.path() ?? null }).catch(() => {});
  };
  await manifest();
  recorder?.onEvent((e) => e.type === 'session' && void manifest());

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
      const har = recorder?.harPath() ?? null;
      const files: SessionFiles | null = base
        ? {
            database: database!,
            siteVideo: await keep(sitePage?.video(), `${base}.site.webm`),
            consoleVideo: await keep(consoleWindow.video(), `${base}.console.webm`),
            har: har && (await Bun.file(har).exists()) ? har : null
          }
        : (await keep(sitePage?.video(), null), await keep(consoleWindow.video(), null), null);
      if (files) {
        // The HAR was listed when the session started.
        const name = (f: string) => basename(f);
        addArtifacts(files.database, [
          ...(files.consoleVideo ? [{ kind: 'video-console', file: name(files.consoleVideo), startedAt: launchedAt }] : []),
          ...(files.siteVideo ? [{ kind: 'video-site', file: name(files.siteVideo), startedAt: launchedAt }] : [])
        ]);
      }
      if (scratch) await rm(scratch, { recursive: true, force: true });
      return files;
    })());
  if (o.sessionsDir) app.on('close', () => void finish());

  // The one proper close: drain the recorder (which completes the HAR), let the shell quit, close
  // through Playwright (which finishes the videos), then put the files in place.
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      clearInterval(quitWatch);
      stopFeed();
      stopSiteFeed();
      await autopilot?.stop();
      await recorder?.stop();
      await app.evaluate(() => (globalThis as unknown as { __artemisApproveQuit?: () => void }).__artemisApproveQuit?.()).catch(() => {});
      await app.close();
      await endOrphan(electronPid);
      if (o.sessionsDir) await finish();
    })());
  // The operator closed the window or quit: the shell waits for this close (shell/main.ts). The same
  // look also collects the certificate errors the shell accepted since the last one.
  const certificateListeners = new Set<(c: CertificateError) => void>();
  let certificatesSeen = 0;
  let watching = false;
  const quitWatch = setInterval(() => {
    if (watching) return;
    watching = true;
    app
      .evaluate((_electron, seen) => {
        const s = (globalThis as unknown as { __artemisShell?: { quitRequested?: boolean; certificateErrors?: unknown[] } }).__artemisShell;
        return { quit: s?.quitRequested === true, certificates: (s?.certificateErrors ?? []).slice(seen) };
      }, certificatesSeen)
      .then(({ quit, certificates }) => {
        for (const c of certificates as CertificateError[]) {
          certificatesSeen++;
          certificateListeners.forEach((l) => l(c));
        }
        if (quit) void close();
      })
      .catch(() => {})
      .finally(() => (watching = false));
  }, 200);
  app.on('close', () => clearInterval(quitWatch));

  return {
    app,
    sandbox,
    webgl: () => app.evaluate(({ app: electron }) => electron.getGPUFeatureStatus().webgl),
    console: consolePage,
    site,
    recorder,
    recovered,
    finished: () => finish(),
    onAutopilot: (listener) => {
      autopilotListeners.add(listener);
      return () => autopilotListeners.delete(listener);
    },
    onCertificateError: (listener) => {
      certificateListeners.add(listener);
      return () => certificateListeners.delete(listener);
    },
    state: () => app.evaluate(() => (globalThis as unknown as { __artemisShell: ShellState }).__artemisShell),
    close
  };
}

/** Waits up to three seconds for a closed Electron (Windows) to exit by itself, then ends its tree. */
async function endOrphan(pid: number): Promise<void> {
  if (!pid) return;
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 30 && alive(); i++) await Bun.sleep(100);
  if (alive()) Bun.spawnSync(['taskkill', '/F', '/T', '/PID', String(pid)]);
}
