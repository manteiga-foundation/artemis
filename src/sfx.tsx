import { useCallback, useEffect, useRef } from 'react';
import { useBleeps } from '@arwes/react';
import { controller } from './graph/controller';
import { getState, useStore } from './store';
import {
  FALLBACK_FILE,
  MIN_INTERVAL,
  OVERRIDES_KEY,
  loadOverrides,
  resolveActionSound,
  type Sfx,
  type SfxAction,
  type SoundOverrides,
  type SoundRef
} from './sounds';
import { SYNTH_PRESETS, playSynth } from './synth';

export { bleepsSettings, type Sfx, type SfxAction } from './sounds';

// Fallback path: plain <audio> elements, used only if the Web Audio bleep is unavailable.
const fallbackCache = new Map<Sfx, HTMLAudioElement>();

// One audio context for synthesized sounds, created on first use (after the Engage gesture).
let synthCtx: AudioContext | null = null;
const synthContext = () => (synthCtx ??= new AudioContext());

// Overrides from /debug, read once and refreshed when another tab (the debug page) writes them.
let overrides: SoundOverrides | null = null;
const currentOverrides = (): SoundOverrides => (overrides ??= loadOverrides(typeof localStorage !== 'undefined' ? localStorage : undefined));
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === OVERRIDES_KEY || e.key === null) overrides = null;
  });
  window.addEventListener('focus', () => {
    overrides = null;
  });
}

/** Resolve an action to the sound the console should play right now. */
export const soundForAction = (action: SfxAction): SoundRef => resolveActionSound(action, currentOverrides());

export function useSfx() {
  const bleeps = useBleeps<Sfx>();
  const last = useRef<Partial<Record<SfxAction, number>>>({});

  return useCallback(
    (action: SfxAction) => {
      const s = getState();
      if (s.muted || !s.engaged) return;
      const now = performance.now();
      if (now - (last.current[action] ?? 0) < MIN_INTERVAL[action]) return;
      last.current[action] = now;

      const ref = soundForAction(action);
      document.body.dataset.lastPlayed = ref;

      if (ref.startsWith('synth:')) {
        const preset = SYNTH_PRESETS.find((p) => `synth:${p.id}` === ref);
        if (!preset) return;
        const ctx = synthContext();
        if (ctx.state === 'suspended') void ctx.resume();
        playSynth(ctx, preset);
        return;
      }

      const name = ref.slice('file:'.length) as Sfx;
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
