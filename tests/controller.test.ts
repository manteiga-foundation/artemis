import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Graph } from '@cosmos.gl/graph';
import { getState, setState } from '../src/store';

// Import the real controller, but never allocate a WebGL renderer in Bun.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const fakeWindow = { setInterval: () => 1, setTimeout: () => 1, clearTimeout: () => undefined };
const restoreWindow = () => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
};
Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
const { controller } = await import('../src/graph/controller').finally(restoreWindow);
const initialState = getState();

// Only the GPU boundary is faked: data model and controller behaviour stay real.
class Renderer {
  config: Record<string, unknown> = {};
  renders = 0;
  fits = 0;
  zoomed: number[] = [];
  tracked: number[] = [];
  colors = new Float32Array();
  linkColors = new Float32Array();
  setPointPositions() {}
  setLinks() {}
  setPointColors(c: Float32Array) { this.colors = c; }
  setLinkColors(c: Float32Array) { this.linkColors = c; }
  setPointSizes() {}
  setLinkWidths() {}
  setPointClusters() {}
  setClusterPositions() {}
  setPinnedPoints() {}
  trackPointPositionsByIndices(t: number[]) { this.tracked = t; }
  setConfigPartial(c: Record<string, unknown>) { this.config = { ...this.config, ...c }; }
  getNeighboringPointIndices(index: number) {
    const { links } = controller.data;
    const out: number[] = [];
    for (let l = 0; l < links.length; l += 2) {
      if (links[l] === index) out.push(links[l + 1]);
      else if (links[l + 1] === index) out.push(links[l]);
    }
    return out;
  }
  render() { this.renders++; }
  start() {}
  fitView() { this.fits++; }
  getZoomLevel() { return 1; }
  zoomToPointByIndex(i: number) { this.zoomed.push(i); }
}
const attach = () => {
  const main = new Renderer();
  const mini = new Renderer();
  controller.main = main as unknown as Graph;
  controller.mini = mini as unknown as Graph;
  return { main, mini };
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
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

describe('views and lenses in the store', () => {
  test('the console starts in the cosmos view with the overview lens and no transition running', () => {
    const s = getState();
    expect(s.view).toBe('cosmos');
    expect(s.lens).toBe('overview');
    expect(s.viewTransition).toBeNull();
  });

  test('V dives from cosmos into page, recording an inward transition and announcing the view', () => {
    attach();
    const r = controller.cycleView();
    expect(r.ok).toBe(true);
    expect(getState().view).toBe('page');
    expect(getState().viewTransition).toEqual({ from: 'cosmos', to: 'page', dir: 'in', id: 1 });
    expect(getState().status).toBe('View: Page. Page and its connections.');
  });

  test('wrapping from browser back to cosmos is an outward transition', () => {
    attach();
    setState({ view: 'browser' });
    controller.cycleView();
    expect(getState().view).toBe('cosmos');
    expect(getState().viewTransition?.dir).toBe('out');
  });

  test('switching directly to the current view is a no-op without a transition', () => {
    attach();
    const r = controller.setView('cosmos');
    expect(r.ok).toBe(false);
    expect(getState().viewTransition).toBeNull();
  });

  test('a finished transition is cleared only if it is still the current one', () => {
    attach();
    controller.cycleView();
    const first = getState().viewTransition!.id;
    controller.cycleView();
    controller.endViewTransition(first);
    expect(getState().viewTransition?.id).toBe(first + 1);
    controller.endViewTransition(first + 1);
    expect(getState().viewTransition).toBeNull();
  });

  test('lenses keep their 1-5 behaviour under the new name', () => {
    attach();
    controller.setLens('hubs');
    expect(getState().lens).toBe('hubs');
    expect(getState().status).toBe('Lens: Hubs.');
  });
});

describe('focus absorbs vision', () => {
  test('with nothing selected, F tours the six sectors and then fits the whole network', () => {
    const { main } = attach();
    const sectors = controller.data.sectors;
    for (let i = 0; i < sectors.length; i++) {
      controller.focus();
      expect(main.zoomed[i]).toBe(sectors[i]);
    }
    expect(main.fits).toBe(0);
    const r = controller.focus();
    expect(r.message).toBe('Full network in view.');
    expect(main.fits).toBe(1);
    controller.focus();
    expect(main.zoomed[sectors.length]).toBe(sectors[0]);
  });
});
