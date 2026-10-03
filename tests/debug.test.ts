import { describe, expect, test } from 'bun:test';
import { SOUND_CATALOG, SFX_ACTIONS, soundById, suggestionsText } from '../src/debug/catalog';
import { SYNTH_PRESETS } from '../src/synth';
import { bleepsSettings, DEFAULT_ACTION_SOUNDS } from '../src/sounds';

describe('sound catalogue (debug page)', () => {
  test('every shipped file sound and every synthesized preset is listed once, with a unique id', () => {
    const ids = SOUND_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of Object.keys(bleepsSettings.bleeps)) expect(ids).toContain(`file:${name}`);
    for (const p of SYNTH_PRESETS) expect(ids).toContain(`synth:${p.id}`);
    expect(SYNTH_PRESETS.length).toBeGreaterThanOrEqual(20);
  });

  test('synth presets are short bleeps with a description, a group and distinct ids', () => {
    const ids = SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of SYNTH_PRESETS) {
      expect(p.durationMs).toBeGreaterThanOrEqual(20);
      expect(p.durationMs).toBeLessThanOrEqual(900);
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.steps.length).toBeGreaterThan(0);
      expect(['bright', 'soft']).toContain(p.group);
    }
  });

  test('the soft family is gentle by construction: no square or sawtooth, low-passed, never an instant attack', () => {
    const soft = SYNTH_PRESETS.filter((p) => p.group === 'soft');
    expect(soft.length).toBeGreaterThanOrEqual(9);
    for (const p of soft) {
      expect(p.level).toBeLessThanOrEqual(0.5);
      for (const s of p.steps) {
        expect(['sine', 'triangle', 'noise']).toContain(s.wave);
        expect(s.attackMs ?? 0).toBeGreaterThanOrEqual(4);
        const cutoff = s.lowpass ?? s.bandpass?.to ?? s.bandpass?.from;
        expect(cutoff).toBeDefined();
        expect(cutoff!).toBeLessThanOrEqual(3200);
      }
    }
    for (const id of ['soft-hover', 'soft-click', 'panel-open', 'panel-close', 'view-out', 'view-in']) {
      expect(soft.map((p) => p.id)).toContain(id);
    }
  });

  test('every console action names its current sound (the routing default) and says where it fires', () => {
    for (const a of SFX_ACTIONS) {
      expect(a.current).toBe(DEFAULT_ACTION_SOUNDS[a.id]);
      expect(soundById(a.current)).toBeDefined();
      expect(a.where.length).toBeGreaterThan(5);
    }
    expect(SFX_ACTIONS.map((a) => a.id)).toEqual(
      expect.arrayContaining(['hover', 'click', 'command-ok', 'command-error', 'notice', 'text', 'engage', 'view-dive', 'panels-open', 'panels-close'])
    );
    expect(SFX_ACTIONS.find((a) => a.id === 'engage')!.where).not.toContain('Silent');
  });

  test('suggestions are rendered as a plain list the user can paste back', () => {
    const text = suggestionsText({ hover: 'synth:soft-hover', 'command-error': 'file:error' });
    expect(text).toContain('hover -> synth:soft-hover');
    expect(text).toContain('command-error -> (keep file:error)'); // picking the current sound is a keep
    expect(text.split('\n').length).toBe(SFX_ACTIONS.length);
    expect(text).toContain('click -> (keep file:click)');
  });
});
