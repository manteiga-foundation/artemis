import { rm } from 'node:fs/promises';

// Removes a test's temporary folder. On Windows a file stays locked while any process holds it
// open, and Electron's helper processes outlive the app's close by a second or two; Bun's rm does
// not retry (maxRetries is ignored), so this does, for up to ten seconds.
export async function removeTree(path: string): Promise<void> {
  for (const until = Date.now() + 10_000; ; await Bun.sleep(250)) {
    try {
      return await rm(path, { recursive: true, force: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') || Date.now() > until) throw e;
    }
  }
}
