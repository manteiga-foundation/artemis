import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';
import { commandsFor, commandByKey } from '../src/commands';
import { pageSubgraph } from '../src/graph/data';
import { VIEWS } from '../src/views';
import { FaLayerGroup } from 'react-icons/fa6';

const initialState = getState();

beforeEach(() => {
  installFakeWindow();
  controller.main = null;
  controller.mini = null;
  setState({ ...initialState, engaged: true });
});

afterEach(() => {
  controller.main = null;
  controller.mini = null;
  setState(initialState);
  restoreWindow();
});

describe('one command card in every view', () => {
  const UNIFIED_KEYS = ['A', 'S', 'D', 'V', 'F', 'I', 'P', 'R', 'X'];
  const UNIFIED_NAMES = ['Target', 'Stop', 'Autopilot', 'View', 'Focus', 'Interceptor', 'Artemis', 'Regenerate', 'Clear'];

  test('every view offers the same nine commands: A S D on the top row, V F I in the middle, P R X below', () => {
    for (const v of VIEWS) {
      const cmds = commandsFor(v.id);
      expect(cmds.map((c) => c.key)).toEqual(UNIFIED_KEYS);
      expect(cmds.map((c) => c.name)).toEqual(UNIFIED_NAMES);
      expect(new Set(cmds.map((c) => c.key)).size).toBe(9);
    }
  });

  test('the recorded session swaps Regenerate for Scope (E) in every view, since the card is one', () => {
    for (const v of VIEWS) {
      const cmds = commandsFor(v.id, true);
      expect(cmds.map((c) => c.key)).toEqual(['A', 'S', 'D', 'V', 'F', 'I', 'P', 'R', 'X'].map((k) => (k === 'R' ? 'E' : k)));
      expect(cmds[7].name).toBe('Scope');
    }
  });

  test('V is the View command: the browser pulls back to the cosmos, the cosmos returns to the browser', () => {
    attach();
    setState({ view: 'browser', stageView: 'browser' });
    const v = commandByKey('browser', 'V')!;
    expect(v.name).toBe('View');
    expect(v.hint).toBe('Pull back to the Cosmos view: entire network.');
    v.run();
    expect(getState().view).toBe('cosmos');
    expect(commandByKey('cosmos', 'V')!.hint).toBe('Return to the Browser view: live page.');
    // Layered panels, not a cube: the glyph reads as "stacked views" at a glance.
    for (const view of VIEWS) expect(commandByKey(view.id, 'V')!.Icon).toBe(FaLayerGroup);
  });

  test('cosmos no longer has a Vision command; Focus owns fitting the network', () => {
    const names = commandsFor('cosmos').map((c) => c.name);
    expect(names).not.toContain('Vision');
    expect(commandByKey('cosmos', 'F')!.hint).toMatch(/fit/i);
  });

  test('the Page view keeps its depth logic in the controller, without a card of its own', () => {
    attach();
    setState({ view: 'page' });
    expect(commandByKey('page', 'D')!.name).toBe('Autopilot');
    expect(getState().pageHops).toBe(1);
    controller.depth();
    expect(getState().pageHops).toBe(2);
    controller.depth();
    expect(getState().pageHops).toBe(1);
  });

  test('I is the Interceptor: it opens and closes the panel from the card, lit while open, and the card never changes', () => {
    attach();
    const i = commandByKey('browser', 'I')!;
    expect(i.name).toBe('Interceptor');
    expect(i.isActive!(getState())).toBe(false);
    i.run();
    expect(getState().interceptorOpen).toBe(true);
    expect(i.isActive!(getState())).toBe(true);
    // The panel has its own buttons (Arm, Hold, Edit, Forward, Drop, Forward all, Next, Reset);
    // the card stays the card, so I is still there to close it and A is still Target.
    expect(commandsFor('browser').map((c) => c.name)).toEqual(['Target', 'Stop', 'Autopilot', 'View', 'Focus', 'Interceptor', 'Artemis', 'Regenerate', 'Clear']);
    expect(commandByKey('browser', 'I')!.name).toBe('Interceptor');
    i.run();
    expect(getState().interceptorOpen).toBe(false);
  });

  test('Links left the card but keeps its key: L toggles the layer in a view, never over the settings', () => {
    attach();
    expect(commandsFor('cosmos').map((c) => c.name)).not.toContain('Links');
    const l = commandByKey('cosmos', 'L')!;
    expect(l.name).toBe('Links');
    const before = getState().linksOn;
    l.run();
    expect(getState().linksOn).toBe(!before);
    expect(commandByKey('cosmos', 'L', false, true)).toBeUndefined();
    // Hold left with no key: pinning stays in the controller for later.
    expect(commandByKey('cosmos', 'H')).toBeUndefined();
  });

  test('the Browser view has no placeholders any more: its card is the same card', () => {
    attach();
    setState({ view: 'browser' });
    expect(commandsFor('browser').map((c) => c.name)).not.toContain('Annotate');
    expect(commandByKey('browser', 'A')!.name).toBe('Target');
  });
});

describe('the settings card is the only one that replaces the view card', () => {
  test('the Interceptor has no card of its own: its actions are the panel\'s buttons', () => {
    expect(commandsFor('browser').map((c) => c.name)[0]).toBe('Target');
    expect(commandsFor('browser', false, true).map((c) => c.name)[0]).toBe('Apply');
  });
});

describe('page view shows one page and its connections', () => {
  test('pageSubgraph returns the focus plus every node within the hop limit, each truly adjacent', () => {
    const d = controller.data;
    const focus = d.relays[0];
    const one = pageSubgraph(d, focus, 1);
    expect(one).toContain(focus);
    expect(one.length).toBeGreaterThan(1);
    const adjacent = (a: number, b: number) => {
      for (let l = 0; l < d.links.length; l += 2) {
        if ((d.links[l] === a && d.links[l + 1] === b) || (d.links[l] === b && d.links[l + 1] === a)) return true;
      }
      return false;
    };
    for (const n of one) if (n !== focus) expect(adjacent(focus, n)).toBe(true);
    const two = pageSubgraph(d, focus, 2);
    expect(two.length).toBeGreaterThan(one.length);
    for (const n of one) expect(two).toContain(n);
  });

  test('entering page view hides everything outside the current page subgraph and frames that subgraph', () => {
    const { main, mini } = attach();
    const d = controller.data;
    expect(getState().currentPage).toBe(d.relays[0]);
    controller.setView('page');
    const sub = pageSubgraph(d, d.relays[0], 1);
    expect(main.fittedTo).toEqual(sub);
    expect(main.config.highlightedPointIndices).toEqual(sub);
    expect(main.config.pointGreyoutOpacity).toBe(0);
    expect(main.config.linkGreyoutOpacity).toBe(0);
    // The minimap keeps the whole cosmos as context, dimming rather than hiding the rest.
    expect(mini.config.highlightedPointIndices).toEqual(sub);
    expect(mini.config.pointGreyoutOpacity).toBeGreaterThan(0);
  });

  test('changing depth in page view reframes the larger subgraph', () => {
    const { main } = attach();
    const d = controller.data;
    controller.setView('page');
    controller.depth();
    expect(main.fittedTo).toEqual(pageSubgraph(d, d.relays[0], 2));
  });

  test('a selected node becomes the page in page view, and leaving restores the cosmos greyout', () => {
    const { main } = attach();
    const d = controller.data;
    controller.setView('page');
    setState({ selected: d.sectors[1] });
    controller.applyLens();
    expect(main.config.highlightedPointIndices).toEqual(pageSubgraph(d, d.sectors[1], 1));
    controller.setView('cosmos');
    expect(main.config.pointGreyoutOpacity).toBe(0.1);
    expect(main.config.linkGreyoutOpacity).toBe(0.04);
  });
});
