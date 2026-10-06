// `bun run artemis [website] [--autopilot slow|regular|max]`: open Artemis in the browser it
// owns, the Electron shell (shell/main.ts). Starts the Vite dev server if nothing answers on the
// port, then launches the shell under Playwright: the website runs as a genuine native page behind
// the console. The profile persists under data/shell-profile so the reviewed site's logins survive
// restarts; each session is recorded under data/sessions. With a website, Artemis engages it at
// once; with --autopilot it then presses D for you, once per level, as soon as the site has loaded.
//
// The terminal shows a large welcome, then one notification per event: the session's database and
// live HAR with their full paths the moment they exist, the autopilot's flight, closing, the files
// saved. Colours follow the console's palettes; NO_COLOR or a pipe gives plain text.
//
// However it ends (closing the window, Cmd+Q, Ctrl+C or closing the terminal), the session is
// saved whole: database, videos and HAR. A second Ctrl+C quits without waiting.
//
// Environment: ARTEMIS_PORT (console port, default 5173), ARTEMIS_PROFILE_DIR and
// ARTEMIS_SESSIONS_DIR (override data/shell-profile and data/sessions), ARTEMIS_SHELL_HIDDEN=1.
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { launchShell } from '../server/shell';
import { autopilotNotices, LEVELS, parseArtemisArgs, settleSpeeds, USAGE, type Level } from '../server/cli';
import { colorMode, notice, welcome, type NoticeKind } from '../server/terminal';

const args = parseArtemisArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(`Artemis: ${args.error}\n\n${USAGE}`);
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const port = Number(process.env.ARTEMIS_PORT ?? 5173);
const appUrl = `http://127.0.0.1:${port}`;
const profile = process.env.ARTEMIS_PROFILE_DIR ?? new URL('../data/shell-profile', import.meta.url).pathname;
const sessionsDir = process.env.ARTEMIS_SESSIONS_DIR ?? new URL('../data/sessions', import.meta.url).pathname;
const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const mode = colorMode(process.env, !!process.stdout.isTTY);
const say = (kind: NoticeKind, text: string) => console.log(notice(kind, text, { mode }));
console.log(welcome({ version, consoleUrl: appUrl, website: args.website, autopilot: args.autopilot, profile, sessions: sessionsDir }, { mode, columns: process.stdout.columns ?? 100 }));

const up = () => fetch(appUrl).then((r) => r.ok).catch(() => false);

let vite: ReturnType<typeof Bun.spawn> | null = null;
if (!(await up())) {
  say('artemis', `Starting the console on ${appUrl}`);
  // Vite's own banner and per-request lines would bury the notifications; warnings still show.
  vite = Bun.spawn(['bun', 'run', 'dev', '--port', String(port), '--strictPort', '--logLevel', 'warn'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'inherit',
    stderr: 'inherit'
  });
  for (let i = 0; i < 200 && !(await up()); i++) await Bun.sleep(100);
  if (!(await up())) {
    say('error', `The console's server did not answer on ${appUrl}`);
    vite.kill();
    process.exit(1);
  }
}

await mkdir(profile, { recursive: true });
const shell = await launchShell({ appUrl, userDataDir: profile, sessionsDir });
say('artemis', 'Owned browser open');
for (const db of shell.recovered) say('recovered', `Videos of an interrupted session put back beside ${db}`);

// The session's files, the moment they exist. Labels share one width, so every path in the run
// starts in the same column.
const label = (l: string) => l.padEnd(15);
shell.recorder?.onEvent((e) => {
  if (e.type !== 'session') return;
  say('session', `${label('Recording')}${e.target}`);
  const database = shell.recorder?.path();
  const har = shell.recorder?.harPath();
  if (database) say('session', `${label('Database')}${database}`);
  if (har) say('har', `${label('Live HAR')}${har}`);
});

// The autopilot's flight, whoever set it (this command line, or D in the console); quick presses
// of D are one change.
const flight = autopilotNotices();
shell.onAutopilot(
  settleSpeeds((e) => {
    const n = flight(e);
    if (n) say(n.kind, n.text);
  })
);

let closing = false;
const finish = async () => {
  if (closing) return;
  closing = true;
  const files = await shell.finished();
  if (files) {
    say('saved', 'Browser closed; session saved');
    for (const [name, file] of [
      ['Database', files.database],
      ['HAR', files.har],
      ['Site video', files.siteVideo],
      ['Console video', files.consoleVideo]
    ] as const)
      if (file) say('saved', `${label(name)}${file}`);
  } else say('artemis', 'Browser closed; no website was opened, nothing saved');
  vite?.kill();
  process.exit(0);
};
shell.app.on('close', () => void finish());

// Ctrl+C, closing the terminal, kill: Playwright's own handlers would close the browser at once
// and exit before the session is saved. Artemis's close saves it (HAR, videos), then exits above.
// One Ctrl+C can arrive twice: the terminal signals the whole job, and `bun run artemis`'s wrapper
// passes it on to this process too. Repeats within a second are the same press.
const SAME_PRESS_MS = 1000;
let interruptedAt = 0;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.removeAllListeners(signal);
  process.on(signal, () => {
    const now = Date.now();
    if (interruptedAt && now - interruptedAt < SAME_PRESS_MS) return;
    if (interruptedAt) {
      say('warn', 'Quitting without saving the rest of the session');
      process.exit(130);
    }
    interruptedAt = now;
    process.stdout.write('\n');
    say('closing', 'Saving the session (Ctrl+C again to quit without waiting)');
    void shell.close().catch(() => process.exit(1));
  });
}

/** D in the console, once per level (the operator's own control), once the site has loaded. */
async function engageAutopilot(level: Exclude<Level, 0>) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !/^https?:/i.test(shell.site()?.url() ?? '')) await Bun.sleep(100);
  await shell
    .site()
    ?.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    .catch(() => {});
  const speed = async () => (await shell.state().catch(() => null))?.autopilot.speed ?? -1;
  for (let press = 0; press < 4; press++) {
    const now = await speed();
    if (now === level) return;
    await shell.console.keyboard.press('d');
    for (let i = 0; i < 20 && (await speed()) === now; i++) await Bun.sleep(50);
  }
  if ((await speed()) !== level) say('warn', `The autopilot did not engage: press D in the console (${level} times for ${LEVELS[level].name})`);
}

if (args.website) {
  say('artemis', `Opening ${args.website}`);
  await shell.console.getByRole('textbox', { name: 'Web App' }).fill(args.website);
  await shell.console.getByRole('button', { name: 'Engage', exact: true }).click();
  if (args.autopilot) await engageAutopilot(args.autopilot);
}
