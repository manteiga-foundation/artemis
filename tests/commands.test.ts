import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';
import { commandsFor, commandByKey } from '../src/commands';
import { pageSubgraph } from '../src/graph/data';
import { VIEWS } from '../src/views';

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

describe('the command card adapts to the view', () => {
  test('every view offers nine commands with unique hotkeys', () => {
    for (const v of VIEWS) {
      const cmds = commandsFor(v.id);
      expect(cmds).toHaveLength(9);
      expect(new Set(cmds.map((c) => c.key)).size).toBe(9);
    }
  });

  test('A and S keep the top row and V the middle row, as drawn in the sketch, in every view', () => {
    for (const v of VIEWS) {
      const keys = commandsFor(v.id).map((c) => c.key);
      expect(keys[0]).toBe('A');
      expect(keys[1]).toBe('S');
      expect(keys[3]).toBe('V');
    }
  });

  test('V is the View command and dives to the next view', () => {
    attach();
    const v = commandByKey('cosmos', 'V')!;
    expect(v.name).toBe('View');
    expect(v.hint).toContain('Page');
    v.run();
    expect(getState().view).toBe('page');
    expect(commandByKey('page', 'V')!.hint).toContain('Browser');
  });

  test('cosmos no longer has a Vision command; Focus owns fitting the network', () => {
    const names = commandsFor('cosmos').map((c) => c.name);
    expect(names).not.toContain('Vision');
    expect(commandByKey('cosmos', 'F')!.hint).toMatch(/fit/i);
  });

  test('page view: D toggles the connection depth between one and two hops', () => {
    attach();
    setState({ view: 'page' });
    const d = commandByKey('page', 'D')!;
    expect(d.name).toBe('Depth');
    expect(getState().pageHops).toBe(1);
    d.run();
    expect(getState().pageHops).toBe(2);
    expect(d.isActive!(getState())).toBe(true);
    d.run();
    expect(getState().pageHops).toBe(1);
  });

  test('browser view commands are interface placeholders that still answer on the console', () => {
    attach();
    setState({ view: 'browser' });
    const names = commandsFor('browser').map((c) => c.name);
    expect(names).toEqual(['Annotate', 'Snapshot', 'Highlight', 'View', 'Flow', 'Links', 'DOM', 'Reload', 'Clear']);
    const r = commandByKey('browser', 'A')!.run();
    expect(r.ok).toBe(true);
    expect(getState().status).toContain('Annotate');
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

  test('entering page view hides everything outside the current page subgraph and zooms to the page', () => {
    const { main } = attach();
    const d = controller.data;
    expect(getState().currentPage).toBe(d.relays[0]);
    controller.setView('page');
    expect(main.zoomed).toContain(d.relays[0]);
    expect(main.config.highlightedPointIndices).toEqual(pageSubgraph(d, d.relays[0], 1));
    expect(main.config.pointGreyoutOpacity).toBe(0);
    expect(main.config.linkGreyoutOpacity).toBe(0);
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
