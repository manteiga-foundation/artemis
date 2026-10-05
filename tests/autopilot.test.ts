import { afterEach, describe, expect, test } from 'bun:test';
// The command card imports the graph controller, which needs a window: the harness loads it under a fake one.
import './harness';
import { autopilotFromShell, etaText, stepAutopilot } from '../src/autopilot';
import { commandByKey } from '../src/commands';
import { YokeIcon } from '../src/icons';
import { getState, setState } from '../src/store';

// The autopilot's control (the user's sketch): a yoke with three squares for the speed, hotkey D,
// in the Browser view's top-right slot. Each press steps the speed: off, slow, regular, max, off.
// It flies in the owned browser; the shell reports progress, the end of the site, and the
// operator taking the controls (touching the site disengages it).

const initial = getState();
afterEach(() => setState(initial));

describe('the autopilot control', () => {
  test('D steps up: off, slow, regular, max, then off; each step says what it does', () => {
    setState({ engaged: true, view: 'browser', stageView: 'browser', autopilot: 0 });
    const sent: number[] = [];
    const shell = { autopilot: (speed: number) => sent.push(speed) };
    stepAutopilot(shell);
    expect(getState().autopilot).toBe(1);
    expect(getState().status).toMatch(/^Autopilot: slow\b/);
    stepAutopilot(shell);
    expect([getState().autopilot, getState().status]).toEqual([2, expect.stringMatching(/^Autopilot: regular\b/)]);
    stepAutopilot(shell);
    expect([getState().autopilot, getState().status]).toEqual([3, expect.stringMatching(/^Autopilot: max\b/)]);
    stepAutopilot(shell);
    expect([getState().autopilot, getState().status]).toEqual([0, 'Autopilot off.']);
    expect(sent).toEqual([1, 2, 3, 0]);
  });

  test('outside the owned browser only the controls answer, and it says where it flies', () => {
    setState({ engaged: true, view: 'browser', autopilot: 0 });
    stepAutopilot(null);
    expect(getState().autopilot).toBe(1);
    expect(getState().status).toContain('flies in the owned browser (bun run artemis)');
  });

  test('the shell reports progress, the end of the site, and the operator taking the controls', () => {
    setState({ engaged: true, view: 'browser', autopilot: 2 });
    autopilotFromShell({ speed: 2, event: 'progress', visited: 4, pending: 13, etaMs: 95_000, url: 'https://shop.example/catalog' });
    expect(getState().autopilotProgress).toEqual({ visited: 4, pending: 13, etaMs: 95_000 });
    expect(getState().status).toBe('Autopilot: regular · 4 pages visited, 13 to go, about 2 min left · https://shop.example/catalog');

    autopilotFromShell({ speed: 0, event: 'disengaged' });
    expect([getState().autopilot, getState().statusTone]).toEqual([0, 'warn']);
    expect(getState().status).toBe('Autopilot disengaged: you took the controls.');

    setState({ autopilot: 3 });
    autopilotFromShell({ speed: 0, event: 'done', visited: 17, pending: 0, etaMs: 0 });
    expect(getState().autopilot).toBe(0);
    expect(getState().status).toBe('Autopilot: the site is covered. 17 pages visited, nothing left to open.');
  });

  test('time left reads plainly', () => {
    expect(etaText(0)).toBe('nothing left');
    expect(etaText(30_000)).toBe('under a minute left');
    expect(etaText(95_000)).toBe('about 2 min left');
    expect(etaText(3_900_000)).toBe('about 1 h 5 min left');
  });

  test('the D command flies a yoke, shows the speed as three squares and is lit in flight', () => {
    const d = commandByKey('browser', 'D')!;
    expect([d.name, d.Icon]).toEqual(['Autopilot', YokeIcon]);
    expect(d.pips!({ ...getState(), autopilot: 2 })).toBe(2);
    expect(d.isActive!({ ...getState(), autopilot: 0 })).toBe(false);
    expect(d.isActive!({ ...getState(), autopilot: 1 })).toBe(true);
  });

  test('only in the Browser view for now: D stays Disperse in the Cosmos', () => {
    expect(commandByKey('cosmos', 'D')!.name).toBe('Disperse');
    expect(commandByKey('cosmos', 'D', true)!.name).toBe('Disperse');
  });
});
