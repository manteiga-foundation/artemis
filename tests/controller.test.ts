import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';

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
    expect(getState().viewTransition).toMatchObject({ from: 'cosmos', to: 'page', dir: 'in' });
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
