import { describe, expect, test } from 'bun:test';
import { RECENTS_KEY, RECENTS_MAX, ageLabel, loadRecents, rememberRecent } from '../src/recents';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v))
  };
}

describe('recently engaged web apps', () => {
  test('empty storage is an empty list; malformed storage too', () => {
    const s = memoryStorage();
    expect(loadRecents(s)).toEqual([]);
    s.setItem(RECENTS_KEY, '{not json');
    expect(loadRecents(s)).toEqual([]);
    s.setItem(RECENTS_KEY, JSON.stringify([{ url: 'nope', at: 1 }, { url: 'https://ok.example/', at: 'x' }, { url: 'https://fine.example/', at: 5 }, 7]));
    expect(loadRecents(s)).toEqual([{ url: 'https://fine.example/', at: 5 }]);
    expect(loadRecents(undefined)).toEqual([]);
  });

  test('remembering puts the newest first, keeps one entry per web app, and holds the last five', () => {
    const s = memoryStorage();
    rememberRecent(s, 'https://a.example/', 1000);
    rememberRecent(s, 'https://b.example/', 2000);
    expect(loadRecents(s).map((r) => r.url)).toEqual(['https://b.example/', 'https://a.example/']);
    // Engaging a again moves it to the front with the new time, no duplicate.
    rememberRecent(s, 'https://a.example/', 3000);
    expect(loadRecents(s)).toEqual([
      { url: 'https://a.example/', at: 3000 },
      { url: 'https://b.example/', at: 2000 }
    ]);
    for (let i = 0; i < 10; i++) rememberRecent(s, `https://site${i}.example/`, 4000 + i);
    const list = loadRecents(s);
    expect(list).toHaveLength(RECENTS_MAX);
    expect(RECENTS_MAX).toBe(5);
    expect(list[0].url).toBe('https://site9.example/');
    expect(list[4].url).toBe('https://site5.example/');
  });

  test('a path keeps the entry distinct from the bare host; the same address is one entry', () => {
    const s = memoryStorage();
    rememberRecent(s, 'https://shop.example/', 1);
    rememberRecent(s, 'https://shop.example/checkout', 2);
    rememberRecent(s, 'https://shop.example/checkout', 3);
    expect(loadRecents(s).map((r) => r.url)).toEqual(['https://shop.example/checkout', 'https://shop.example/']);
  });

  test('ages read as a person says them', () => {
    const now = 10_000_000_000;
    expect(ageLabel(now - 20_000, now)).toBe('just now');
    expect(ageLabel(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ageLabel(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ageLabel(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(ageLabel(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(ageLabel(now - 40 * 86_400_000, now)).toBe('40 days ago');
  });
});
