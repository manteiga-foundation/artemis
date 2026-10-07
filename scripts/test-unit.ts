// `bun run test:unit`: the tests that need neither a browser nor a GPU, as the CI job on Linux runs
// them. A test file needs a browser when it imports Playwright or the isolated Vite server
// (`tests/vite.ts`); those stay local (`bun run test` runs everything). Sorting by imports means a
// new test file lands in one set or the other without a list to keep up to date.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const BROWSER_IMPORT = /^\s*import\b[^;]*?\bfrom\s+['"](playwright|\.\/vite)['"]/m;

export function needsBrowser(source: string): boolean {
  return BROWSER_IMPORT.test(source);
}

export async function unitTestFiles(root: string): Promise<string[]> {
  const names = (await readdir(join(root, 'tests'))).filter((f) => f.endsWith('.test.ts')).sort();
  const unit: string[] = [];
  for (const name of names) {
    if (!needsBrowser(await readFile(join(root, 'tests', name), 'utf8'))) unit.push(`tests/${name}`);
  }
  return unit;
}

if (import.meta.main) {
  const root = new URL('..', import.meta.url).pathname;
  const files = await unitTestFiles(root);
  const run = Bun.spawnSync(['bun', 'test', '--timeout', '60000', ...files.map((f) => `./${f}`)], { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] });
  process.exit(run.exitCode ?? 1);
}
