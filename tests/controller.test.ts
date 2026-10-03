import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';
import { engageConsole } from '../src/session';

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

describe('views and lenses in the store', () => {
  test('the entry screen sits over the cosmos; engaging lands in the browser view with no transition', () => {
    const s = getState();
    expect(s.view).toBe('cosmos');
    expect(s.stageView).toBe('cosmos');
    expect(s.lens).toBe('overview');
    expect(s.viewTransition).toBeNull();
    engageConsole('example.com');
    expect(getState().view).toBe('browser');
    expect(getState().stageView).toBe('browser');
    expect(getState().viewTransition).toBeNull();
  });

  test('V pulls back from the browser straight to the cosmos, recording an outward transition and announcing the view', () => {
    attach();
    setState({ view: 'browser', stageView: 'browser' });
    const r = controller.cycleView();
    expect(r.ok).toBe(true);
    expect(getState().view).toBe('cosmos');
    expect(getState().viewTransition).toMatchObject({ from: 'browser', to: 'cosmos', dir: 'out' });
    expect(getState().status).toBe(`View: Cosmos. Current page ${controller.data.meta[getState().currentPage].id} selected.`);
  });

  test('pulling back from the browser lands on the current page: selected, in focus and zoomed in on', () => {
    const { main, mini } = attach();
    const page = getState().currentPage;
    const id = controller.data.meta[page].id;
    setState({ view: 'browser', stageView: 'browser' });
    controller.cycleView();
    expect(getState().selected).toBe(page);
    expect(main.config.focusedPointIndex).toBe(page);
    expect(main.config.highlightedPointIndices).toContain(page);
    expect(mini.config.focusedPointIndex).toBe(page);
    // The camera closes in on the page rather than fitting the whole network.
    expect(main.zoomed.at(-1)).toBe(page);
    expect(main.zoomScales.at(-1)).toBeGreaterThanOrEqual(3);
    expect(main.fits).toBe(0);
    // Its label rides with it, and the console says where the operator is.
    expect(main.tracked).toContain(page);
    expect(getState().status).toContain(id);
  });

  test('a selection made in the cosmos gives way to the current page on the next pull-back', () => {
    attach();
    const page = getState().currentPage;
    setState({ view: 'browser', stageView: 'browser', selected: controller.data.sectors[2] });
    controller.cycleView();
    expect(getState().selected).toBe(page);
  });

  test('wrapping from cosmos back into the browser is an inward transition', () => {
    attach();
    setState({ view: 'cosmos', stageView: 'cosmos' });
    controller.cycleView();
    expect(getState().view).toBe('browser');
    expect(getState().viewTransition?.dir).toBe('in');
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

describe('the first layout frames itself until the operator aims the camera', () => {
  /** One whole settling layout, as the graph reports it: start, ticks, end. */
  const settle = (ticks = 300) => {
    controller.layoutStarted();
    for (let i = 0; i < ticks; i++) controller.layoutTick();
    controller.layoutSettled();
  };

  test('left alone, a new layout is fitted as it unfolds (ticks 90 and 240) and once settled', () => {
    const { main } = attach();
    controller.regenerate();
    settle();
    expect(main.fits).toBe(3);
  });

  test('pulling back onto the current page keeps the camera there while the layout settles', () => {
    const { main } = attach();
    controller.regenerate();
    setState({ view: 'browser', stageView: 'browser' });
    controller.cycleView();
    settle();
    expect(main.fits).toBe(0);
  });

  test('Focus on a sector, and a zoom or pan by the operator, also cancel the pending fit', () => {
    let { main } = attach();
    controller.regenerate();
    controller.focus();
    settle();
    expect(main.fits).toBe(0);

    ({ main } = attach());
    controller.regenerate();
    controller.zoomStarted(false); // the controller's own camera moves do not count
    controller.zoomStarted(true); // the wheel or a drag on the graph
    settle();
    expect(main.fits).toBe(0);
  });
});
