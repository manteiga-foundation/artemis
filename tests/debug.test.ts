import { describe, expect, test } from 'bun:test';
import { SOUND_CATALOG, SFX_ACTIONS, soundById, suggestionsText } from '../src/debug/catalog';
import { SYNTH_PRESETS } from '../src/debug/synth';
import { bleepsSettings } from '../src/sounds';

describe('sound catalogue (debug page)', () => {
  test('every shipped file sound and every synthesized preset is listed once, with a unique id', () => {
    const ids = SOUND_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of Object.keys(bleepsSettings.bleeps)) expect(ids).toContain(`file:${name}`);
    for (const p of SYNTH_PRESETS) expect(ids).toContain(`synth:${p.id}`);
    expect(SYNTH_PRESETS.length).toBeGreaterThanOrEqual(10);
  });

  test('synth presets are short bleeps with a description and distinct ids', () => {
    const ids = SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SYNTH_PRESETS) {
      expect(p.durationMs).toBeGreaterThanOrEqual(20);
      expect(p.durationMs).toBeLessThanOrEqual(900);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.steps.length).toBeGreaterThan(0);
    }
  });

  test('every console action names a real current sound, and the file sounds say where they are used', () => {
    for (const a of SFX_ACTIONS) {
      expect(soundById(`file:${a.current}`)).toBeDefined();
      expect(a.where.length).toBeGreaterThan(5);
    }
    const hover = SFX_ACTIONS.find((a) => a.id === 'hover')!;
    expect(hover.current).toBe('hover');
    expect(SFX_ACTIONS.map((a) => a.id)).toEqual(expect.arrayContaining(['hover', 'click', 'command-ok', 'command-error', 'notice', 'text', 'engage', 'view-dive']));
  });

  test('suggestions are rendered as a plain list the user can paste back', () => {
    const text = suggestionsText({ hover: 'synth:tick', 'command-error': 'file:error' });
    expect(text).toContain('hover -> synth:tick');
    expect(text).toContain('command-error -> (keep file:error)'); // picking the current sound is a keep
    expect(text.split('\n').length).toBe(SFX_ACTIONS.length);
    expect(text).toContain('click -> (keep file:click)');
  });
});
