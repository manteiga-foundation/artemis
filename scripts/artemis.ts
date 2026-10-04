// `bun run artemis [website]`: open Artemis in the browser it owns, the Electron shell
// (shell/main.ts). Starts the Vite dev server if nothing answers on the port, then launches the
// shell under Playwright: the website runs as a genuine native page behind the console. The
// profile persists under data/shell-profile so the reviewed site's logins survive restarts; each
// session is recorded under data/sessions. With a website argument, Artemis engages it at once.
//
// However it ends (closing the window, Cmd+Q, Ctrl+C or closing the terminal), the session is
// saved whole: database, videos and HAR. A second Ctrl+C quits without waiting.
//
// Environment: ARTEMIS_PORT (console port, default 5173), ARTEMIS_PROFILE_DIR and
// ARTEMIS_SESSIONS_DIR (override data/shell-profile and data/sessions), ARTEMIS_SHELL_HIDDEN=1.
import { mkdir } from 'node:fs/promises';
import { launchShell } from '../server/shell';

const port = Number(process.env.ARTEMIS_PORT ?? 5173);
const appUrl = `http://127.0.0.1:${port}`;
const profile = process.env.ARTEMIS_PROFILE_DIR ?? new URL('../data/shell-profile', import.meta.url).pathname;
const sessionsDir = process.env.ARTEMIS_SESSIONS_DIR ?? new URL('../data/sessions', import.meta.url).pathname;
const website = process.argv[2];

const up = () => fetch(appUrl).then((r) => r.ok).catch(() => false);

let vite: ReturnType<typeof Bun.spawn> | null = null;
if (!(await up())) {
  vite = Bun.spawn(['bun', 'run', 'dev', '--port', String(port), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'inherit',
    stderr: 'inherit'
  });
  for (let i = 0; i < 200 && !(await up()); i++) await Bun.sleep(100);
  if (!(await up())) {
    console.error(`Artemis: dev server did not answer on ${appUrl}`);
    vite.kill();
    process.exit(1);
  }
}

await mkdir(profile, { recursive: true });
const shell = await launchShell({ appUrl, userDataDir: profile, sessionsDir });
console.log(`Artemis: owned browser open on ${appUrl} (profile ${profile}; sessions recorded in ${sessionsDir})`);
for (const db of shell.recovered) console.log(`Artemis: recovered the videos of an interrupted session: ${db}`);

let closing = false;
const finish = async () => {
  if (closing) return;
  closing = true;
  const files = await shell.finished();
  if (files) {
    console.log(`Artemis: browser closed; session saved:`);
    for (const f of [files.database, files.siteVideo, files.consoleVideo, files.har]) if (f) console.log(`  ${f}`);
  } else console.log('Artemis: browser closed; no website was opened, nothing saved');
  vite?.kill();
  process.exit(0);
};
shell.app.on('close', () => void finish());

// Ctrl+C, closing the terminal, kill: Playwright's own handlers would close the browser at once
// and exit before the session is saved. Artemis's close saves it (HAR, videos), then exits above.
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.removeAllListeners(signal);
  process.on(signal, () => {
    if (interrupted) {
      console.log('\nArtemis: quitting without saving the rest of the session');
      process.exit(130);
    }
    interrupted = true;
    console.log('\nArtemis: closing, saving the session (Ctrl+C again to quit without waiting)');
    void shell.close().catch(() => process.exit(1));
  });
}

if (website) {
  await shell.console.getByRole('textbox', { name: 'Web App' }).fill(website);
  await shell.console.getByRole('button', { name: 'Engage', exact: true }).click();
}
