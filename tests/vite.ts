// Shared: start an isolated Vite dev server on a free port for browser tests.
import { expect } from 'bun:test';
import { join } from 'node:path';
import { consoleServerCommand } from '../server/cli';

export interface ViteServer {
  port: number;
  url: string;
  stop(): void;
}

export async function startVite(): Promise<ViteServer> {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserve') });
  const port = reservation.port!;
  reservation.stop(true);
  // Vite's own entry, run by this Bun: killing it stops the server. Through `bun run dev` the kill
  // reached only the wrapper, and on Windows the server lived on.
  const root = join(import.meta.dir, '..');
  // ARTEMIS_TEST_VITE_LOG=<file> keeps the server's output, to see why one stopped answering.
  const log = process.env.ARTEMIS_TEST_VITE_LOG ? Bun.file(`${process.env.ARTEMIS_TEST_VITE_LOG}.${port}`) : 'ignore';
  const proc = Bun.spawn(consoleServerCommand(process.execPath, port, root), { cwd: root, stdout: log, stderr: log });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (await fetch(`http://127.0.0.1:${port}`).then((r) => r.ok).catch(() => false)) {
      ready = true;
      break;
    }
    await Bun.sleep(100);
  }
  expect(ready).toBe(true);
  return { port, url: `http://127.0.0.1:${port}`, stop: () => proc.kill() };
}
