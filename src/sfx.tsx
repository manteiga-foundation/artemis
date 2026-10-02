import { useCallback, useEffect, useRef } from 'react';
import { useBleeps } from '@arwes/react';
import { controller } from './graph/controller';
import { getState, useStore } from './store';
import { FALLBACK_FILE, MIN_INTERVAL, type Sfx } from './sounds';

export { bleepsSettings, type Sfx } from './sounds';

// Fallback path: plain <audio> elements, used only if the Web Audio bleep is unavailable.
const fallbackCache = new Map<Sfx, HTMLAudioElement>();

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
        el = new Audio(`/assets/sounds/${FALLBACK_FILE[name]}.mp3`);
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
