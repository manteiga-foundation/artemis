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

  test('V pulls back from browser to page, recording an outward transition and announcing the view', () => {
    attach();
    setState({ view: 'browser', stageView: 'browser' });
    const r = controller.cycleView();
    expect(r.ok).toBe(true);
    expect(getState().view).toBe('page');
    expect(getState().viewTransition).toMatchObject({ from: 'browser', to: 'page', dir: 'out' });
    expect(getState().status).toBe('View: Page. Page and its connections.');
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
