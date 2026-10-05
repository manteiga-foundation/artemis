// The configuration view's settings (the user's sketch): categories, each a list of options shown
// as checkboxes, with their defaults. Pure data and helpers, no store, so the store can read the
// saved settings at start. Only the sound default works for real in this slice; the other
// categories are interface with emulated options (`live: false`) and say so on screen.
//
// Settings are a flat map of option id -> on/off, saved in the browser's storage under
// SETTINGS_KEY. Loading merges with the defaults, so options added later get their default and
// options removed later are dropped.

export type Settings = Record<string, boolean>;

export interface SettingOption {
  id: string;
  label: string;
  /** One line under the label. */
  hint?: string;
  default: boolean;
}

export interface SettingCategory {
  id: string;
  label: string;
  description: string;
  /** Works for real; the others are interface only for now. */
  live: boolean;
  options: SettingOption[];
}

export const CATEGORIES: readonly SettingCategory[] = [
  {
    id: 'scope',
    label: 'Scope',
    description: 'What counts as the site under review: everything else is outside the scope.',
    live: false,
    options: [
      { id: 'scope.subdomains', label: 'Include subdomains', hint: 'cdn.example.com counts as example.com', default: true },
      { id: 'scope.signInPages', label: 'Count outside sign-in pages as part of the review', hint: 'Microsoft, Okta, PingOne pages reached from the site', default: false },
      { id: 'scope.hideOutside', label: 'Start the cosmos with outside hosts hidden', hint: 'the Scope command (E) shows them again', default: false }
    ]
  },
  {
    id: 'export',
    label: 'Export',
    description: 'Formats a session exports to, for tools that import them.',
    live: false,
    options: [
      { id: 'export.har', label: 'HAR 1.2', hint: 'Burp Suite, ZAP, browser developer tools', default: true },
      { id: 'export.json', label: 'Artemis session (JSON)', hint: 'pages, actions, requests and responses as recorded', default: false },
      { id: 'export.csv', label: 'Request list (CSV)', default: false },
      { id: 'export.mask', label: 'Mask credentials and typed values', hint: 'cookies, Authorization headers, passwords and form fields', default: true }
    ]
  },
  {
    id: 'llm',
    label: 'LLM connections',
    description: 'Models Artemis may call, one per role. None is called yet.',
    live: false,
    options: [
      { id: 'llm.categorization', label: 'Categorization: a small model labels each page', hint: 'local, for example LM Studio at localhost:1234', default: false },
      { id: 'llm.intelligence', label: 'Intelligence: explains pages, actions and flows', default: false },
      { id: 'llm.security', label: 'Security: maps pages to NIST CSF 2.0 and PCI DSS', default: false }
    ]
  },
  {
    id: 'sound',
    label: 'Sound',
    description: 'The console sounds as you browse and command. M mutes and unmutes at any time.',
    live: true,
    options: [{ id: 'sound.onAtStart', label: 'Sound on when Artemis starts', hint: 'off: Artemis starts muted', default: true }]
  },
  {
    id: 'autopilot',
    label: 'Autopilot',
    description: 'Exploring the site on its own, by rules, without a language model.',
    live: false,
    options: [
      { id: 'autopilot.afterEngage', label: 'Start exploring after Engage', default: false },
      { id: 'autopilot.noRepeats', label: 'Never visit the same page twice', default: true },
      { id: 'autopilot.templates', label: 'Visit two or three pages of each kind', hint: 'product 1, product 2, not every product', default: true },
      { id: 'autopilot.inScope', label: 'Stay inside the scope', default: true },
      { id: 'autopilot.forms', label: 'Submit forms', hint: 'off: fills nothing, sends nothing', default: false }
    ]
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Help from a language model while you review. Needs an LLM connection.',
    live: false,
    options: [
      { id: 'copilot.nextPage', label: 'Suggest the next page to review', default: false },
      { id: 'copilot.explain', label: 'Explain the page in plain words', default: false },
      { id: 'copilot.findings', label: 'Draft findings for review', default: false }
    ]
  },
  {
    id: 'defaults',
    label: 'Defaults',
    description: 'What every session keeps next to its database.',
    live: false,
    options: [
      { id: 'defaults.siteVideo', label: 'Video of the website', default: true },
      { id: 'defaults.consoleVideo', label: 'Video of the console', default: true },
      { id: 'defaults.har', label: 'HAR of the site traffic', default: true },
      { id: 'defaults.imageBodies', label: 'Keep image and asset bodies', hint: 'off: documents and API calls only', default: false }
    ]
  }
];

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(CATEGORIES.flatMap((c) => c.options.map((o) => [o.id, o.default])));

export const SETTINGS_KEY = 'artemis.settings';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's storage, when there is one (not in unit tests, not when storage refuses). */
export const browserStorage = (): SettingsStorage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadSettings(storage: SettingsStorage | null): Settings {
  let saved: Record<string, unknown> = {};
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    saved = {};
  }
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([id, value]) => [id, typeof saved[id] === 'boolean' ? (saved[id] as boolean) : value]));
}

export function saveSettings(settings: Settings, storage: SettingsStorage | null): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or refused: the settings still apply for this session.
  }
}

export const changesBetween = (a: Settings, b: Settings): number => Object.keys(DEFAULT_SETTINGS).filter((id) => a[id] !== b[id]).length;

export const startsMuted = (s: Settings): boolean => !s['sound.onAtStart'];

export interface SearchResult {
  category: SettingCategory;
  options: SettingOption[];
}

/**
 * Settings matching what was typed: a category whose name or description matches shows all of its
 * options; otherwise only the options whose label or hint matches. Empty: everything.
 */
export function searchSettings(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATEGORIES.map((category) => ({ category, options: category.options }));
  const has = (...texts: (string | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));
  return CATEGORIES.flatMap((category) => {
    if (has(category.label, category.description)) return [{ category, options: category.options }];
    const options = category.options.filter((o) => has(o.label, o.hint));
    return options.length ? [{ category, options }] : [];
  });
}
