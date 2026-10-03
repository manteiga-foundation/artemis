import { describe, expect, test } from 'bun:test';
import { DEFAULT_ACTION_SOUNDS, SFX_ACTION_IDS, loadOverrides, resolveActionSound, saveOverrides, OVERRIDES_KEY, type SfxAction } from '../src/sounds';
import { soundById } from '../src/debug/catalog';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
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

describe('action -> sound routing', () => {
  test('every action has a default that exists in the catalogue', () => {
    for (const a of SFX_ACTION_IDS) expect(soundById(DEFAULT_ACTION_SOUNDS[a])).toBeDefined();
    expect(DEFAULT_ACTION_SOUNDS.hover).toBe('file:hover');
    expect(DEFAULT_ACTION_SOUNDS['command-error']).toBe('file:error');
  });

  test('an override wins over the default; unknown actions fall back to defaults', () => {
    expect(resolveActionSound('hover', {})).toBe('file:hover');
    expect(resolveActionSound('hover', { hover: 'synth:soft-hover' })).toBe('synth:soft-hover');
    expect(resolveActionSound('click', { hover: 'synth:soft-hover' })).toBe('file:click');
  });

  test('overrides persist as JSON under one key and tolerate garbage, unknown actions and unknown sounds', () => {
    const s = fakeStorage();
    saveOverrides(s, { hover: 'synth:soft-hover', 'panels-open': 'synth:panel-open' });
    expect(JSON.parse(s.getItem(OVERRIDES_KEY)!)).toEqual({ hover: 'synth:soft-hover', 'panels-open': 'synth:panel-open' });
    expect(loadOverrides(s)).toEqual({ hover: 'synth:soft-hover', 'panels-open': 'synth:panel-open' });

    expect(loadOverrides(fakeStorage({ [OVERRIDES_KEY]: 'not json' }))).toEqual({});
    expect(loadOverrides(fakeStorage({ [OVERRIDES_KEY]: JSON.stringify({ nope: 'synth:tick', hover: 'synth:does-not-exist', click: 'synth:tap' }) }))).toEqual({ click: 'synth:tap' });
    expect(loadOverrides(undefined)).toEqual({});

    saveOverrides(s, {});
    expect(s.getItem(OVERRIDES_KEY)).toBeNull();
    const a: SfxAction = 'view-dive';
    expect(resolveActionSound(a, loadOverrides(s))).toBe(DEFAULT_ACTION_SOUNDS['view-dive']);
  });
});
