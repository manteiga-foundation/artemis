// Sound definitions, kept free of other modules so tools (the debug page, tests) can list them
// without starting the graph. `src/sfx.tsx` plays them.
import type { BleepsProviderSettings } from '@arwes/react';

export type Sfx = 'click' | 'info' | 'error' | 'type' | 'intro' | 'hover';

const src = (name: string) => [
  { src: `/assets/sounds/${name}.webm`, type: 'audio/webm' },
  { src: `/assets/sounds/${name}.mp3`, type: 'audio/mpeg' }
];

// Sound assets are the free sample files from the Arwes repository (github.com/arwes/arwes,
// static/assets/sounds), fine for development; the debug page offers synthesized replacements.
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

/** Minimum time between two plays of the same sound, ms. */
export const MIN_INTERVAL: Record<Sfx, number> = {
  intro: 500,
  type: 90,
  click: 35,
  hover: 110,
  info: 120,
  error: 150
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
