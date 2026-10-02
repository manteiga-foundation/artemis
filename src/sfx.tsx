import { useCallback, useEffect, useRef } from 'react';
import { useBleeps, type BleepsProviderSettings } from '@arwes/react';
import { controller, type Sfx } from './graph/controller';
import { getState, useStore } from './store';

const src = (name: string) => [
  { src: `/assets/sounds/${name}.webm`, type: 'audio/webm' },
  { src: `/assets/sounds/${name}.mp3`, type: 'audio/mpeg' }
];

// Sound assets are the official Arwes UI sounds (github.com/arwes/arwes, static/assets/sounds).
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

const MIN_INTERVAL: Record<Sfx, number> = {
  intro: 500,
  type: 90,
  click: 35,
  hover: 110,
  info: 120,
  error: 150
};

// Fallback path: plain <audio> elements, used only if the Web Audio bleep is unavailable.
const fallbackCache = new Map<Sfx, HTMLAudioElement>();
const fallbackFile: Record<Sfx, string> = {
  intro: 'intro',
  type: 'type',
  click: 'click',
  hover: 'click',
  info: 'info',
  error: 'error'
};

export function useSfx() {
  const bleeps = useBleeps<Sfx>();
  const last = useRef<Partial<Record<Sfx, number>>>({});

  return useCallback(
    (name: Sfx) => {
      const s = getState();
      if (s.muted || !s.engaged) return;
      const now = performance.now();
      if (now - (last.current[name] ?? 0) < MIN_INTERVAL[name]) return;
      last.current[name] = now;

      const bleep = bleeps[name];
      if (bleep) {
        bleep.play();
        return;
      }
      let el = fallbackCache.get(name);
      if (!el) {
        el = new Audio(`/assets/sounds/${fallbackFile[name]}.mp3`);
        el.volume = name === 'hover' ? 0.15 : 0.5;
        fallbackCache.set(name, el);
      }
      el.currentTime = 0;
      void el.play().catch(() => undefined);
    },
    [bleeps]
  );
}

/** Routes sound requests emitted by the graph controller to the Arwes bleeps. */
export function SfxBridge() {
  const play = useSfx();
  const bleeps = useBleeps<Sfx>();
  const muted = useStore((s) => s.muted);

  useEffect(() => controller.onSfx(play), [play]);

  useEffect(() => {
    // Dev-only handle for inspecting bleep load state from the console.
    if (import.meta.env.DEV) (window as unknown as { __bleeps: unknown }).__bleeps = bleeps;
  }, [bleeps]);

  useEffect(() => {
    Object.values(bleeps).forEach((b) => b?.update({ muted }));
  }, [bleeps, muted]);

  return null;
}
