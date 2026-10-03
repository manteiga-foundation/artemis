// Sound definitions and routing, kept free of other modules so tools (the debug page, tests) can
// list them without starting the graph. `src/sfx.tsx` plays them.
//
// The console plays by ACTION (hover, click, command accepted...). Each action maps to a sound:
// a shipped file (`file:click`) or a synthesized preset (`synth:soft-click`). The map can be
// overridden from the /debug page; overrides live in localStorage so picks can be judged in the
// real console before they become defaults here.
import type { BleepsProviderSettings } from '@arwes/react';
import { SYNTH_PRESETS } from './synth';

/** Shipped file sounds (Arwes free samples; development only). */
export type Sfx = 'click' | 'info' | 'error' | 'type' | 'intro' | 'hover';

const src = (name: string) => [
  { src: `/assets/sounds/${name}.webm`, type: 'audio/webm' },
  { src: `/assets/sounds/${name}.mp3`, type: 'audio/mpeg' }
];

export const bleepsSettings: BleepsProviderSettings<Sfx> = {
  master: { volume: 0.8 },
  common: { preload: true },
  categories: {
    transition: { volume: 0.55 },
    interaction: { volume: 0.5 },
    notification: { volume: 0.7 }
  },
  bleeps: {
    intro: { category: 'transition', sources: src('intro') },
    type: { category: 'transition', sources: src('type'), volume: 0.5 },
    click: { category: 'interaction', sources: src('click') },
    hover: { category: 'interaction', sources: src('click'), volume: 0.18 },
    info: { category: 'notification', sources: src('info') },
    error: { category: 'notification', sources: src('error') }
  }
};

/** File behind each sound for the plain <audio> fallback. */
export const FALLBACK_FILE: Record<Sfx, string> = {
  intro: 'intro',
  type: 'type',
  click: 'click',
  hover: 'click',
  info: 'info',
  error: 'error'
};

/** Every moment the console makes a sound. */
export type SfxAction =
  | 'hover'
  | 'click'
  | 'command-ok'
  | 'command-error'
  | 'notice'
  | 'text'
  | 'engage'
  | 'view-dive'
  | 'panels-open'
  | 'panels-close';

export const SFX_ACTION_IDS: SfxAction[] = ['hover', 'click', 'command-ok', 'command-error', 'notice', 'text', 'engage', 'view-dive', 'panels-open', 'panels-close'];

export type SoundRef = `file:${Sfx}` | `synth:${string}`;

/** What each action plays unless overridden. */
export const DEFAULT_ACTION_SOUNDS: Record<SfxAction, SoundRef> = {
  hover: 'file:hover',
  click: 'file:click',
  'command-ok': 'file:click',
  'command-error': 'file:error',
  notice: 'file:info',
  text: 'file:type',
  engage: 'file:intro',
  'view-dive': 'file:info',
  'panels-open': 'file:click',
  'panels-close': 'file:click'
};

/** Minimum time between two plays of the same action, ms. */
export const MIN_INTERVAL: Record<SfxAction, number> = {
  hover: 110,
  click: 35,
  'command-ok': 35,
  'command-error': 150,
  notice: 120,
  text: 90,
  engage: 500,
  'view-dive': 300,
  'panels-open': 150,
  'panels-close': 150
};

export type SoundOverrides = Partial<Record<SfxAction, SoundRef>>;

export const OVERRIDES_KEY = 'artemis.sfx.overrides';

const FILE_IDS = new Set(Object.keys(bleepsSettings.bleeps).map((n) => `file:${n}`));
const SYNTH_IDS = new Set(SYNTH_PRESETS.map((p) => `synth:${p.id}`));
export const isSoundRef = (v: unknown): v is SoundRef => typeof v === 'string' && (FILE_IDS.has(v) || SYNTH_IDS.has(v));
const isAction = (v: string): v is SfxAction => (SFX_ACTION_IDS as string[]).includes(v);

export function resolveActionSound(action: SfxAction, overrides: SoundOverrides): SoundRef {
  return overrides[action] ?? DEFAULT_ACTION_SOUNDS[action];
}

/** Read overrides from storage; anything malformed, unknown or stale is dropped. */
export function loadOverrides(storage: Storage | undefined): SoundOverrides {
  if (!storage) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(OVERRIDES_KEY) ?? 'null');
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const out: SoundOverrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isAction(k) && isSoundRef(v)) out[k] = v;
  }
  return out;
}

/** Write overrides; an empty set removes the key so the console is back to its defaults. */
export function saveOverrides(storage: Storage, overrides: SoundOverrides): void {
  const clean: SoundOverrides = {};
  for (const [k, v] of Object.entries(overrides)) if (isAction(k) && isSoundRef(v)) clean[k] = v;
  if (Object.keys(clean).length === 0) storage.removeItem(OVERRIDES_KEY);
  else storage.setItem(OVERRIDES_KEY, JSON.stringify(clean));
}
