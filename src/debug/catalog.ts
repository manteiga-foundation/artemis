// What the debug page lists: every sound Artemis can make, and every console action that makes one.
import { bleepsSettings, type Sfx } from '../sounds';
import { SYNTH_PRESETS, type SynthPreset } from './synth';

export type SoundId = `file:${Sfx}` | `synth:${string}`;

export interface CatalogSound {
  id: SoundId;
  label: string;
  kind: 'file' | 'synth';
  description: string;
  /** File sounds: the Arwes category and relative volume; synth: the preset. */
  file?: { name: Sfx; category: string; volume?: number };
  synth?: SynthPreset;
}

const FILE_NOTES: Record<Sfx, string> = {
  intro: 'Arwes sample. Longer rising tone; not used anywhere yet.',
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
    description: FILE_NOTES[name],
    file: { name, category: String(b.category ?? ''), volume: b.volume }
  })),
  ...SYNTH_PRESETS.map((p) => ({
    id: `synth:${p.id}` as SoundId,
    label: p.label,
    kind: 'synth' as const,
    description: p.description,
    synth: p
  }))
];

export const soundById = (id: string): CatalogSound | undefined => SOUND_CATALOG.find((s) => s.id === id);

export interface SfxAction {
  id: string;
  label: string;
  /** Where in the console it fires. */
  where: string;
  /** The sound it plays today (a file sound name). */
  current: Sfx;
}

/** Every place the console makes a sound today, plus moments that are silent but could speak. */
export const SFX_ACTIONS: SfxAction[] = [
  { id: 'hover', label: 'Hover', where: 'Pointer over a command button or a lens tab.', current: 'hover' },
  { id: 'click', label: 'Click', where: 'Lens change, header switches (panels, mute), arrows.', current: 'click' },
  { id: 'command-ok', label: 'Command accepted', where: 'A command runs: Target, Stop, Hold, Focus, Links, Route, Clear...', current: 'click' },
  { id: 'command-error', label: 'Command refused', where: 'A command cannot run (Hold with nothing selected, Focus on nothing).', current: 'error' },
  { id: 'notice', label: 'Notice', where: 'View change announced, Disperse pulse, Links switched on.', current: 'info' },
  { id: 'text', label: 'Text deciphering', where: 'Header labels and titles while they assemble.', current: 'type' },
  { id: 'engage', label: 'Engage', where: 'The console starts after a website is entered. Silent today.', current: 'intro' },
  { id: 'view-dive', label: 'View dive', where: 'The stage moves between Browser, Page and Cosmos (V). Silent today beyond the notice.', current: 'info' },
  { id: 'panels', label: 'Panels fold', where: 'C hides or shows the bottom panels.', current: 'click' }
];

/** Plain-text rendering of the user's picks, one action per line, ready to paste back. */
export function suggestionsText(picks: Record<string, string>): string {
  return SFX_ACTIONS.map((a) => {
    const pick = picks[a.id];
    return pick && pick !== `file:${a.current}` ? `${a.id} -> ${pick}` : `${a.id} -> (keep file:${a.current})`;
  }).join('\n');
}
