// `bun run artemis`: open Artemis in the browser it owns, the Electron shell (shell/main.ts).
// Starts the Vite dev server if nothing answers on the port, then launches the shell under
// Playwright: the website runs as a genuine native page behind the console. The profile persists
// under data/shell-profile so the reviewed site's logins survive restarts.
import { mkdir } from 'node:fs/promises';
import { launchShell } from '../server/shell';

const port = Number(process.env.ARTEMIS_PORT ?? 5173);
const appUrl = `http://127.0.0.1:${port}`;
const profile = new URL('../data/shell-profile', import.meta.url).pathname;
const sessionsDir = new URL('../data/sessions', import.meta.url).pathname;

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

let closing = false;
const finish = async () => {
  if (closing) return;
  closing = true;
  await shell.recorder?.stop();
  const file = shell.recorder?.path();
  console.log(`Artemis: browser closed${file ? `; session saved to ${file}` : ''}`);
  vite?.kill();
  process.exit(0);
};
shell.app.on('close', () => void finish());
