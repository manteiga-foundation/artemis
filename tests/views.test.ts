import { describe, expect, test } from 'bun:test';
import { VIEWS, VIEW_BY_ID, SHOWN_VIEWS, nextView, prevView, PALETTES, paletteCss, viewDepth } from '../src/views';

describe('views', () => {
  test('three views ordered from nearest (browser) to farthest (cosmos)', () => {
    expect(VIEWS.map((v) => v.id)).toEqual(['browser', 'page', 'cosmos']);
    expect(viewDepth('browser')).toBe(0);
    expect(viewDepth('cosmos')).toBe(2);
  });

  test('the Page view is kept but hidden: only the Browser and the Cosmos are shown', () => {
    expect(VIEW_BY_ID.get('page')?.hidden).toBe(true);
    expect(SHOWN_VIEWS.map((v) => v.id)).toEqual(['browser', 'cosmos']);
  });

  test('V pulls back from the browser straight to the cosmos, then returns to the browser', () => {
    expect(nextView('browser')).toBe('cosmos');
    expect(nextView('cosmos')).toBe('browser');
    expect(prevView('browser')).toBe('cosmos');
    expect(prevView('cosmos')).toBe('browser');
    // Reached only from code while hidden, the Page view still steps out to the cosmos.
    expect(nextView('page')).toBe('cosmos');
    expect(prevView('page')).toBe('browser');
  });

  test('each view carries its label and a palette with the approved base, line and accent', () => {
    expect(VIEW_BY_ID.get('cosmos')?.label).toBe('Cosmos');
    expect(PALETTES.cosmos.base).toBe('#1034a6');
    expect(PALETTES.cosmos.alert).toBe('#e0b85c');
    expect(PALETTES.browser.base).toBe('#005d2c');
    expect(PALETTES.browser.azure).toBe('#009561');
    expect(PALETTES.browser.sky).toBe('#43b48a');
    expect(PALETTES.browser.alert).toBe('#e0b85c');
    expect(PALETTES.page.base).toBe('#954c00');
    expect(PALETTES.page.azure).toBe('#c88000');
    expect(PALETTES.page.frost).toBe('#efdec4');
    expect(PALETTES.page.alert).toBe('#9fb6ff');
  });

  test('every palette defines the same tokens so a view switch can never leave a variable unset', () => {
    const keys = Object.keys(PALETTES.cosmos).sort();
    expect(Object.keys(PALETTES.browser).sort()).toEqual(keys);
    expect(Object.keys(PALETTES.page).sort()).toEqual(keys);
  });

  test('palette css emits one custom property per token', () => {
    const css = paletteCss('page');
    expect(css).toContain('--base: #954c00;');
    expect(css).toContain('--alert: #9fb6ff;');
    expect(css.split(';').filter(Boolean).length).toBe(Object.keys(PALETTES.page).length);
  });
});
