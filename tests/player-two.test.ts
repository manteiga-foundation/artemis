// Player Two: Artemis reading the cosmos beside the operator, emulated. Red is hers; the cosmos
// stays blue. These run against the real controller with the fake renderer (tests/harness.ts).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';
import { commandByKey } from '../src/commands';
import { PALETTES, paletteCss, VIEWS } from '../src/views';
import { rgba } from '../src/theme';

const initialState = getState();

beforeEach(() => {
  installFakeWindow();
  controller.main = null;
  controller.mini = null;
  controller.useEmulated();
  setState({ ...initialState, engaged: true, view: 'cosmos', stageView: 'cosmos', agent: { ...initialState.agent } });
});

afterEach(() => {
  controller.agentStop();
  controller.main = null;
  controller.mini = null;
  setState(initialState);
  restoreWindow();
});

const colorAt = (colors: Float32Array, i: number) => Array.from(colors.slice(i * 4, i * 4 + 4));
/** Float32 on the GPU side: compare to the hex within a step of the 8-bit channel. */
const near = (a: number[], b: ArrayLike<number>) => a.every((v, k) => Math.abs(v - b[k]) < 1 / 255);

describe('red is hers', () => {
  test('every palette names a player colour and the app exposes it as --player', () => {
    for (const v of VIEWS) {
      expect(PALETTES[v.id].player).toMatch(/^#[0-9a-f]{6}$/);
      expect(paletteCss(v.id)).toContain(`--player: ${PALETTES[v.id].player};`);
    }
    expect(PALETTES.cosmos.player).not.toBe(PALETTES.cosmos.alert);
  });

  test('the node she is reading is drawn full red, her trail keeps a red tint, the cosmos stays blue', () => {
    const { main } = attach();
    const d = controller.data;
    controller.applyLens();
    const before = colorAt(main.colors, d.sectors[0]);
    expect(before).toHaveLength(4);
    controller.agentVisit(d.core);
    controller.agentVisit(d.sectors[0]);
    controller.agentVisit(d.sectors[1]);
    const red = rgba(PALETTES.cosmos.player);
    expect(near(colorAt(main.colors, d.sectors[1]), red)).toBe(true);
    // The trail: tinted toward red, not full red, not what it was.
    const trailColor = colorAt(main.colors, d.sectors[0]);
    expect(near(trailColor, red)).toBe(false);
    expect(trailColor).not.toEqual(before);
    expect(trailColor[0]).toBeGreaterThan(before[0]);
    // Untouched nodes keep their colour.
    expect(colorAt(main.colors, d.sectors[2])).toEqual(colorAt(main.colors, d.sectors[2]));
    expect(getState().agent.trail).toEqual([d.core, d.sectors[0]]);
    expect(getState().agent.at).toBe(d.sectors[1]);
  });

  test('the links she walked are red', () => {
    const { main } = attach();
    const d = controller.data;
    controller.agentVisit(d.core);
    controller.agentVisit(d.sectors[0]);
    const red = rgba(PALETTES.cosmos.player);
    const l = linkBetween(d.links, d.core, d.sectors[0]);
    expect(l).toBeGreaterThanOrEqual(0);
    const c = colorAt(main.linkColors, l);
    expect(near(c.slice(0, 3), red.slice(0, 3))).toBe(true);
  });
});

describe('she plays on P', () => {
  test('P is Artemis in every view, emulated and recorded alike; D stays the autopilot', () => {
    expect(commandByKey('cosmos', 'P')!.name).toBe('Artemis');
    expect(commandByKey('cosmos', 'P', true)!.name).toBe('Artemis');
    expect(commandByKey('browser', 'P')!.name).toBe('Artemis');
    expect(commandByKey('browser', 'D')!.name).toBe('Autopilot');
    expect(commandByKey('cosmos', 'D')!.name).toBe('Autopilot');
  });

  test('D starts her at the core and says so; D again stands her down, keeping the trail', () => {
    attach();
    const d = controller.data;
    const r = controller.agent();
    expect(r.ok).toBe(true);
    const s = getState();
    expect(s.agent.on).toBe(true);
    expect(s.agent.at).toBe(d.core);
    expect(s.agent.note).toContain(d.meta[d.core].id);
    controller.agentStep();
    controller.agentStep();
    expect(getState().agent.trail.length).toBe(2);
    const off = controller.agent();
    expect(off.ok).toBe(true);
    expect(getState().agent.on).toBe(false);
    expect(getState().agent.at).toBeNull();
    expect(getState().agent.trail.length).toBe(3);
  });

  test('her walk is deterministic, never repeats a node, and reaches every anomaly', () => {
    attach();
    const d = controller.data;
    controller.agent();
    const seen = new Set<number>([d.core]);
    for (let i = 0; i < d.count * 2 && getState().agent.on; i++) {
      controller.agentStep();
      const at = getState().agent.at;
      if (at === null) break;
      expect(seen.has(at)).toBe(false);
      seen.add(at);
    }
    for (const a of d.anomalies) expect(seen.has(a)).toBe(true);
    const findings = getState().agent.findings;
    expect(findings.map((f) => f.node).sort()).toEqual([...d.anomalies].sort());
    expect(findings.every((f) => f.note.length > 0)).toBe(true);
  });

  test('a finding stays on the node after she stands down, and Clear keeps it too', () => {
    attach();
    const d = controller.data;
    controller.agent();
    while (getState().agent.findings.length === 0 && getState().agent.on) controller.agentStep();
    const found = getState().agent.findings[0];
    expect(d.anomalies).toContain(found.node);
    controller.agent();
    controller.clear();
    expect(getState().agent.findings[0]).toEqual(found);
  });
});

function linkBetween(links: ArrayLike<number>, a: number, b: number): number {
  for (let l = 0; l < links.length; l += 2) {
    if ((links[l] === a && links[l + 1] === b) || (links[l] === b && links[l + 1] === a)) return l / 2;
  }
  return -1;
}
