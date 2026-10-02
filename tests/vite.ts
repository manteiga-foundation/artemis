// Shared: start an isolated Vite dev server on a free port for browser tests.
import { expect } from 'bun:test';

export interface ViteServer {
  port: number;
  url: string;
  stop(): void;
}

export async function startVite(): Promise<ViteServer> {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserve') });
  const port = reservation.port!;
  reservation.stop(true);
  const proc = Bun.spawn(['bun', 'run', 'dev', '--port', String(port), '--strictPort'], {
    cwd: import.meta.dir + '/..',
    stdout: 'ignore',
    stderr: 'ignore'
  });
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
