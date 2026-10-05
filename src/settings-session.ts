// The configuration view as a session over the store: opening takes a draft of the settings in
// effect, ticking changes only the draft, Apply saves it and applies what is live (the sound
// default), closing discards what was not applied and says so. The command card and the surface
// both call these, so a hotkey and a click do the same thing.

import { getState, setState, type UIState } from './store';
import { CATEGORIES, DEFAULT_SETTINGS, browserStorage, changesBetween, saveSettings, searchSettings, startsMuted, type SettingsStorage } from './settings';

const say = (status: string, statusTone: UIState['statusTone'] = 'info') => setState((s) => ({ status, statusTone, statusId: s.statusId + 1 }));
const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`;
const draftOf = (s: UIState) => s.settingsDraft ?? s.settings;

export function openSettings(): void {
  const s = getState();
  if (s.settingsOpen) return;
  setState({ settingsOpen: true, settingsDraft: { ...s.settings }, settingsQuery: '' });
  say('Settings open. Tick what you want, then Apply (A).');
}

export function closeSettings(): void {
  const s = getState();
  if (!s.settingsOpen) return;
  const pending = changesBetween(s.settings, draftOf(s));
  setState({ settingsOpen: false, settingsDraft: null, settingsQuery: '' });
  say(pending ? `Settings closed: ${plural(pending)} not applied, discarded.` : 'Settings closed.', pending ? 'warn' : 'info');
}

export const toggleSettings = (): void => (getState().settingsOpen ? closeSettings() : openSettings());

export function setOption(id: string, on: boolean): void {
  setState((s) => ({ settingsDraft: { ...draftOf(s), [id]: on } }));
}

/** Changes in the draft not applied yet. */
export const pendingChanges = (s: UIState): number => (s.settingsDraft ? changesBetween(s.settings, s.settingsDraft) : 0);

export function applySettings(storage: SettingsStorage | null = browserStorage()): boolean {
  const s = getState();
  const next = draftOf(s);
  const n = changesBetween(s.settings, next);
  if (!n) {
    say('Nothing to apply: no change.');
    return false;
  }
  saveSettings(next, storage);
  const patch: Partial<UIState> = { settings: { ...next }, settingsDraft: { ...next } };
  // Live in this slice: the sound default also applies now.
  if (next['sound.onAtStart'] !== s.settings['sound.onAtStart']) patch.muted = startsMuted(next);
  setState(patch);
  say(`Settings applied: ${plural(n)}.`, 'ok');
  return true;
}

export function resetCategory(): void {
  const s = getState();
  const category = CATEGORIES.find((c) => c.id === s.settingsCategory);
  if (!category) return;
  const draft = { ...draftOf(s) };
  for (const o of category.options) draft[o.id] = o.default;
  setState({ settingsDraft: draft });
  say(`${category.label} back to its defaults. Apply (A) to keep it.`);
}

export function restoreDefaults(): void {
  setState({ settingsDraft: { ...DEFAULT_SETTINGS } });
  say('Every setting back to its default. Apply (A) to keep them.');
}

export function discardChanges(): void {
  const s = getState();
  const n = pendingChanges(s);
  setState({ settingsDraft: { ...s.settings } });
  say(n ? `${plural(n)} discarded.` : 'Nothing to discard.');
}

/** The next category, wrapping; while searching, only through the categories the search found. */
export function nextCategory(): void {
  const s = getState();
  const ids = searchSettings(s.settingsQuery).map((r) => r.category.id);
  if (!ids.length) return;
  const at = ids.indexOf(s.settingsCategory);
  setState({ settingsCategory: ids[(at + 1) % ids.length] });
}

export const SETTINGS_SEARCH_ID = 'settings-search';

export function focusSearch(): void {
  document.getElementById(SETTINGS_SEARCH_ID)?.focus();
}

/** The settings as a file, for keeping or moving to another machine. */
export function exportSettings(): boolean {
  const s = getState();
  try {
    const blob = new Blob([JSON.stringify(s.settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'artemis-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
    say('Settings exported: artemis-settings.json.', 'ok');
    return true;
  } catch {
    say('Export needs a browser window.', 'warn');
    return false;
  }
}
