// Spike 005: which sandbox the shell launched with, as the launcher and Chromium see it.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchShell } from '../../../server/shell';
import { startVite } from '../../../tests/vite';

const vite = await startVite();
const shell = await launchShell({ appUrl: vite.url, userDataDir: await mkdtemp(join(tmpdir(), 'artemis-sbx-')), hidden: true });
try {
  const chromium = await shell.app.evaluate(({ app }) => ({ noSandbox: app.commandLine.hasSwitch('no-sandbox'), processes: app.getAppMetrics().map((m) => m.type) }));
  const site = shell.site()!;
  await site.goto('data:text/html,<p>sandboxed?</p>');
  console.log(JSON.stringify({ sandbox: shell.sandbox, ...chromium }));
} finally {
  await shell.close();
  vite.stop();
  process.exit(0);
}
