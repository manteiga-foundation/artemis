import { describe, expect, test } from 'bun:test';
import { PANEL_SELECTOR, passesThrough, slotLayout } from '../src/shell';
import { RESUME_KEY, readResume, writeResume } from '../src/resume';

// The console side of the Electron shell: where the native site view goes, and whether a click at
// the pointer belongs to the site or to the console.
describe('slot layout for the native site view', () => {
  const rect = { x: 0.4, y: 72.2, width: 1440, height: 795.6 };
  test('shown, rounded to whole pixels, when engaged in the Browser view and no dive is running', () => {
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: null }, rect)).toEqual({ visible: true, x: 0, y: 72, w: 1440, h: 796 });
  });
  test('hidden during a dive, in another view, before Engage, or without a slot', () => {
    const hidden = { visible: false, x: 0, y: 0, w: 0, h: 0 };
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: { id: 1 } }, rect)).toEqual(hidden);
    expect(slotLayout({ engaged: true, stageView: 'page', viewTransition: null }, rect)).toEqual(hidden);
    expect(slotLayout({ engaged: false, stageView: 'browser', viewTransition: null }, rect)).toEqual(hidden);
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: null }, null)).toEqual(hidden);
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: null }, { x: 0, y: 0, width: 0, height: 0 })).toEqual(hidden);
  });
});

describe('click pass-through', () => {
  const at = (inPanel: boolean) => ({ closest: (sel: string) => (inPanel && sel === PANEL_SELECTOR ? {} : null) });
  test('over the site the click goes to the site; over a panel it stays with the console', () => {
    expect(passesThrough(true, at(false))).toBe(true);
    expect(passesThrough(true, at(true))).toBe(false);
  });
  test('never passes through while the site view is hidden', () => {
    expect(passesThrough(false, at(false))).toBe(false);
    expect(passesThrough(false, null)).toBe(false);
  });
  test('the panels are the header, the address strip, the bottom panels and the entry screen', () => {
    for (const s of ['.hud-header', '.browser-bar', '.hud-bottom > *', '.boot']) expect(PANEL_SELECTOR).toContain(s);
  });
});

describe('resume across a console reload', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
  };
  test('the engaged website is written and read back', () => {
    const s = store();
    writeResume(s, { targetUrl: 'https://intranet.example/' });
    expect(readResume(s)).toEqual({ targetUrl: 'https://intranet.example/' });
  });
  test('nothing, garbage or a non-web address resumes nothing', () => {
    const s = store();
    expect(readResume(s)).toBeNull();
    s.raw.set(RESUME_KEY, '{not json');
    expect(readResume(s)).toBeNull();
    s.raw.set(RESUME_KEY, JSON.stringify({ targetUrl: 'javascript:alert(1)' }));
    expect(readResume(s)).toBeNull();
  });
  test('a storage that throws (privacy mode) is survived', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => writeResume(broken, { targetUrl: 'https://example.com/' })).not.toThrow();
    expect(readResume(broken)).toBeNull();
  });
});
