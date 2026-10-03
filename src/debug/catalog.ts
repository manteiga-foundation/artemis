// What the debug page lists: every sound Artemis can make, and every console action that makes one.
import { DEFAULT_ACTION_SOUNDS, bleepsSettings, type Sfx, type SfxAction, type SoundRef } from '../sounds';
import { SYNTH_PRESETS, type SynthGroup, type SynthPreset } from '../synth';

export type SoundId = SoundRef;

export interface CatalogSound {
  id: SoundId;
  label: string;
  kind: 'file' | 'synth';
  /** file | bright | soft: how the table groups them. */
  group: 'file' | SynthGroup;
  description: string;
  /** File sounds: the Arwes category and relative volume; synth: the preset. */
  file?: { name: Sfx; category: string; volume?: number };
  synth?: SynthPreset;
}

const FILE_NOTES: Record<Sfx, string> = {
  intro: 'Arwes sample. Longer rising tone; plays on Engage.',
  type: 'Arwes sample. Typing texture; plays while header text deciphers.',
  click: 'Arwes sample. Short click; the default for buttons and accepted commands.',
  hover: 'The click sample at 18% volume, for pointer hover.',
  info: 'Arwes sample. Soft notice; view changes, disperse, links on.',
  error: 'Arwes sample. Refusal; commands that cannot run.'
};

export const SOUND_CATALOG: CatalogSound[] = [
  ...(Object.entries(bleepsSettings.bleeps) as [Sfx, { category?: string; volume?: number }][]).map(([name, b]) => ({
    id: `file:${name}` as SoundId,
    label: name,
    kind: 'file' as const,
    group: 'file' as const,
    description: FILE_NOTES[name],
    file: { name, category: String(b.category ?? ''), volume: b.volume }
  })),
  ...SYNTH_PRESETS.map((p) => ({
    id: `synth:${p.id}` as SoundId,
    label: p.label,
    kind: 'synth' as const,
    group: p.group,
    description: p.description,
    synth: p
  }))
];

export const soundById = (id: string): CatalogSound | undefined => SOUND_CATALOG.find((s) => s.id === id);

export interface SfxActionInfo {
  id: SfxAction;
  label: string;
  /** Where in the console it fires. */
  where: string;
  /** The sound it plays today (the routing default). */
  current: SoundRef;
}

const ACTION_INFO: Record<SfxAction, { label: string; where: string }> = {
  hover: { label: 'Hover', where: 'Pointer over a command button or a lens tab.' },
  click: { label: 'Click', where: 'Lens change, header switches (mute), arrows.' },
  'command-ok': { label: 'Command accepted', where: 'A command runs: Target, Stop, Hold, Focus, Links, Route, Clear...' },
  'command-error': { label: 'Command refused', where: 'A command cannot run (Hold with nothing selected, Focus on nothing).' },
  notice: { label: 'Notice', where: 'Disperse pulse, Links switched on, a view announced.' },
  text: { label: 'Text deciphering', where: 'Header labels while they assemble (driven by Arwes; file sounds only for now).' },
  engage: { label: 'Engage', where: 'The console starts after a website is entered.' },
  'view-dive': { label: 'View dive', where: 'The stage moves between Browser, Page and Cosmos (V).' },
  'panels-open': { label: 'Panels open', where: 'C or the header switch brings the bottom panels back.' },
  'panels-close': { label: 'Panels close', where: 'C or the header switch folds the bottom panels away.' }
};

/** Every place the console makes a sound, with what it plays today. */
export const SFX_ACTIONS: SfxActionInfo[] = (Object.keys(ACTION_INFO) as SfxAction[]).map((id) => ({
  id,
  ...ACTION_INFO[id],
  current: DEFAULT_ACTION_SOUNDS[id]
}));

/** Plain-text rendering of the user's picks, one action per line, ready to paste back. */
export function suggestionsText(picks: Record<string, string>): string {
  return SFX_ACTIONS.map((a) => {
    const pick = picks[a.id];
    return pick && pick !== a.current ? `${a.id} -> ${pick}` : `${a.id} -> (keep ${a.current})`;
  }).join('\n');
}
