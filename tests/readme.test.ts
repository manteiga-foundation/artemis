import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The README opens with the visuals (hero, the dive, the features) and keeps the technical sections
// under them; every image it shows is in the repository and light enough for GitHub to serve.
const root = new URL('..', import.meta.url).pathname;
const readme = await Bun.file(join(root, 'README.md')).text();
const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img[^>]+src="([^"]+)"/g)].map((m) => m[1] ?? m[2]).filter((src) => !/^https?:/.test(src));

describe('the README', () => {
  test('opens with the hero, the dive and the features, before the badges and the technical sections', () => {
    const at = (s: string) => readme.indexOf(s);
    expect(at('docs/readme/hero.png')).toBeGreaterThan(-1);
    expect(at('docs/readme/dive.gif')).toBeGreaterThan(at('docs/readme/hero.png'));
    expect(at('docs/readme/features.png')).toBeGreaterThan(at('docs/readme/dive.gif'));
    expect(at('img.shields.io')).toBeGreaterThan(at('docs/readme/features.png'));
    expect(at('## Requirements')).toBeGreaterThan(at('docs/readme/features.png'));
    expect(readme).toContain('docs/readme/dive.mp4');
  });

  test('every image it shows is in the repository; the GIF stays under 10 MB and the stills under 2 MB', () => {
    expect(images.length).toBeGreaterThanOrEqual(4);
    for (const src of images) {
      const file = join(root, src);
      expect(existsSync(file), src).toBe(true);
      const limit = src.endsWith('.gif') ? 10e6 : 2e6;
      expect(statSync(file).size, src).toBeLessThan(limit);
    }
  });
});
