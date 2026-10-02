// `bun run artemis`: open Artemis in the browser it owns.
// Starts the Vite dev server if nothing answers on the port, then launches a chromeless Chromium
// (app mode) with Artemis as its page. The profile persists under data/browser-profile so the
// reviewed site's logins survive restarts.
import { mkdir } from 'node:fs/promises';
import { ownBrowser } from '../server/owned-browser';

const port = Number(process.env.ARTEMIS_PORT ?? 5173);
const appUrl = `http://127.0.0.1:${port}`;
const profile = new URL('../data/browser-profile', import.meta.url).pathname;

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
const owned = await ownBrowser({ appUrl, userDataDir: profile, headless: false });
console.log(`Artemis: owned browser open on ${appUrl} (profile ${profile})`);

owned.context.on('close', () => {
  console.log('Artemis: browser closed');
  vite?.kill();
  process.exit(0);
});
