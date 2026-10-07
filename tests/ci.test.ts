import { describe, expect, test } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { needsBrowser, unitTestFiles } from '../scripts/test-unit';

// The continuous integration job runs on Linux without a GPU, a Chromium or an Electron: it
// type-checks, builds and runs every test file that starts neither a browser nor a Vite server.
// The rest (real Chromium, the Electron shell) stays local; a new test file is sorted by what it
// imports, so it can never fall out of both sets.
const root = new URL('..', import.meta.url).pathname;

describe('the tests the CI job runs', () => {
  test('a test file that imports Playwright or the isolated Vite server needs a browser; others do not', () => {
    expect(needsBrowser(`import { chromium } from 'playwright';`)).toBe(true);
    expect(needsBrowser(`import { startVite } from "./vite";`)).toBe(true);
    expect(needsBrowser(`import { expect } from 'bun:test';\nimport { route } from '../src/views';`)).toBe(false);
    expect(needsBrowser(`// a comment naming playwright and ./vite is not an import`)).toBe(false);
  });

  test('every test file is either a unit file CI runs or a browser file kept local', async () => {
    const all = (await readdir(join(root, 'tests'))).filter((f) => f.endsWith('.test.ts')).sort();
    const unit = (await unitTestFiles(root)).map((f) => f.replace(/^tests\//, ''));
    const local = all.filter((f) => !unit.includes(f));
    expect(unit.length + local.length).toBe(all.length);
    expect(unit).toContain('session-store.test.ts');
    expect(unit).toContain('ci.test.ts');
    expect(local).toEqual(['artemis-cli.test.ts', 'autopilot-flight.test.ts', 'debug-page.test.ts', 'integration.test.ts', 'owned-browser.test.ts', 'recorder.test.ts', 'shell.test.ts']);
  });

  test('the workflow runs check, build and the unit tests on Linux with the pinned Bun', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:unit']).toBe('bun run scripts/test-unit.ts');
    const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('runs-on: ubuntu-latest');
    expect(ci).toContain(`bun-version: ${Bun.version}`);
    expect(ci).toContain('ELECTRON_SKIP_BINARY_DOWNLOAD');
    for (const step of ['bun install --frozen-lockfile', 'bun run check', 'bun run build', 'bun run test:unit']) expect(ci).toContain(`run: ${step}`);
  });
});
