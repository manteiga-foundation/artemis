import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
// The command card imports the graph controller, which needs a window: the harness loads it under a fake one.
import './harness';
import { CATEGORIES, DEFAULT_SETTINGS, SETTINGS_KEY, changesBetween, loadSettings, saveSettings, searchSettings, startsMuted, type SettingsStorage } from '../src/settings';
import { applySettings, closeSettings, discardChanges, nextCategory, openSettings, resetCategory, restoreDefaults, setOption } from '../src/settings-session';
import { getState, setState } from '../src/store';
import { commandsFor } from '../src/commands';
import { slotLayout } from '../src/shell';

// The configuration view (the user's sketch): Settings with a search field, categories on the
// left, the chosen category's options as checkboxes, Apply at the bottom right; the scope map and
// the command card stay. Only the sound default works for real in this slice.

const memory = (): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const initial = getState();
afterEach(() => setState(initial));

describe('settings', () => {
  test("the sketch's categories, in order, each with options; only Sound works for real yet, and the rest says so", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['Scope', 'Export', 'LLM connections', 'Sound', 'Autopilot', 'Copilot', 'Defaults']);
    for (const c of CATEGORIES) expect(c.options.length).toBeGreaterThan(0);
    expect(CATEGORIES.filter((c) => c.live).map((c) => c.id)).toEqual(['sound']);
    // Several LLM connections, one per role.
    expect(CATEGORIES.find((c) => c.id === 'llm')!.options.map((o) => o.label.split(':')[0])).toEqual(['Categorization', 'Intelligence', 'Security']);
  });

  test('defaults: sound on at start, subdomains in scope, video and HAR kept with every session', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ 'sound.onAtStart': true, 'scope.subdomains': true, 'defaults.siteVideo': true, 'defaults.consoleVideo': true, 'defaults.har': true });
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(CATEGORIES.flatMap((c) => c.options.map((o) => o.id)).sort());
  });

  test('saved settings come back; missing keys take their default, unknown ones are dropped, a broken store gives the defaults', () => {
    const store = memory();
    saveSettings({ ...DEFAULT_SETTINGS, 'sound.onAtStart': false }, store);
    expect(loadSettings(store)['sound.onAtStart']).toBe(false);
    store.setItem(SETTINGS_KEY, JSON.stringify({ 'sound.onAtStart': false, 'gone.option': true }));
    const loaded = loadSettings(store);
    expect([loaded['sound.onAtStart'], loaded['scope.subdomains'], 'gone.option' in loaded]).toEqual([false, true, false]);
    store.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test('search finds settings by their words: an option word finds its options, a category name all of the category', () => {
    expect(searchSettings('subdomain').map((r) => [r.category.id, r.options.map((o) => o.id)])).toEqual([['scope', ['scope.subdomains']]]);
    const sound = searchSettings('SOUND');
    expect(sound[0].category.id).toBe('sound');
    expect(sound[0].options).toHaveLength(CATEGORIES.find((c) => c.id === 'sound')!.options.length);
    expect(searchSettings('  ')).toHaveLength(CATEGORIES.length);
    expect(searchSettings('nothing like this')).toEqual([]);
  });

  test('changes are the options that differ', () => {
    expect(changesBetween(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBe(0);
    expect(changesBetween(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, 'sound.onAtStart': false, 'scope.subdomains': false })).toBe(2);
  });

  test('the sound default decides whether Artemis starts muted', () => {
    expect(startsMuted(DEFAULT_SETTINGS)).toBe(false);
    expect(startsMuted({ ...DEFAULT_SETTINGS, 'sound.onAtStart': false })).toBe(true);
  });
});

describe('a settings session', () => {
  let store: ReturnType<typeof memory>;
  beforeEach(() => {
    store = memory();
    setState({ ...initial, engaged: true, settings: DEFAULT_SETTINGS, muted: false });
  });

  test('ticking changes only the draft; Apply saves it, and the sound default takes effect at once', () => {
    openSettings();
    expect(getState()).toMatchObject({ settingsOpen: true, settingsCategory: 'scope', settingsQuery: '' });
    setOption('sound.onAtStart', false);
    expect([getState().settings['sound.onAtStart'], getState().muted]).toEqual([true, false]);
    applySettings(store);
    expect([getState().settings['sound.onAtStart'], getState().muted]).toEqual([false, true]);
    expect(JSON.parse(store.data.get(SETTINGS_KEY)!)['sound.onAtStart']).toBe(false);
    expect(getState().status).toBe('Settings applied: 1 change.');
    expect(getState().settingsOpen).toBe(true);
  });

  test('closing with changes not applied discards them and says so; closing clean says nothing about changes', () => {
    openSettings();
    setOption('scope.subdomains', false);
    closeSettings();
    expect(getState()).toMatchObject({ settingsOpen: false, settingsDraft: null });
    expect(getState().settings['scope.subdomains']).toBe(true);
    expect(getState().status).toBe('Settings closed: 1 change not applied, discarded.');
    openSettings();
    closeSettings();
    expect(getState().status).toBe('Settings closed.');
  });

  test('Reset puts the shown category back to its defaults, Defaults puts back everything, Discard drops the draft; all wait for Apply', () => {
    setState({ settings: { ...DEFAULT_SETTINGS, 'sound.onAtStart': false, 'scope.subdomains': false } });
    openSettings();
    setState({ settingsCategory: 'sound' });
    resetCategory();
    expect([getState().settingsDraft!['sound.onAtStart'], getState().settingsDraft!['scope.subdomains']]).toEqual([true, false]);
    restoreDefaults();
    expect(getState().settingsDraft).toEqual(DEFAULT_SETTINGS);
    expect(getState().settings['sound.onAtStart']).toBe(false);
    discardChanges();
    expect(getState().settingsDraft).toEqual(getState().settings);
  });

  test('Next walks the categories, wrapping, and only through the ones a search found', () => {
    openSettings();
    nextCategory();
    expect(getState().settingsCategory).toBe('export');
    setState({ settingsQuery: 'video' });
    nextCategory();
    const found = searchSettings('video').map((r) => r.category.id);
    expect(found).toContain(getState().settingsCategory);
  });
});

describe('the settings command card and the website behind it', () => {
  test('A Apply and S Search hold the top row, V (back to the view) the middle row; nine distinct keys', () => {
    const cmds = commandsFor('browser', false, true);
    expect(cmds.map((c) => c.key)).toHaveLength(9);
    expect(new Set(cmds.map((c) => c.key)).size).toBe(9);
    expect([cmds[0].key, cmds[0].name, cmds[1].key, cmds[1].name, cmds[3].key]).toEqual(['A', 'Apply', 'S', 'Search', 'V']);
    expect(cmds[3].hint).toBe('Close the settings and return to the Browser view.');
    expect(commandsFor('cosmos', true, true)[3].hint).toBe('Close the settings and return to the Cosmos view.');
  });

  test('the native website steps aside while the settings are open', () => {
    const rect = { x: 0, y: 72, width: 1440, height: 796 };
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: null, settingsOpen: true }, rect).visible).toBe(false);
    expect(slotLayout({ engaged: true, stageView: 'browser', viewTransition: null, settingsOpen: false }, rect).visible).toBe(true);
  });
});
