import { useEffect, useRef, useState, type RefObject } from 'react';
import { createEffectIlluminator } from '@arwes/react';

/** Arwes illuminator effect: a soft radial glow that follows the pointer inside a container. */
export function useIlluminator(ref: RefObject<HTMLElement>, color = 'hsl(225 90% 60% / 9%)', size = 260) {
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const fx = createEffectIlluminator({ container, color, size });
    return () => fx.cancel();
  }, [ref, color, size]);
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export interface Telemetry {
  ts: number;
  ns: number;
  rs: number;
  history: number[];
}

/**
 * Placeholder telemetry feed for the header counters (T/S, N/S, R/S).
 * Values are simulated with a bounded random walk; replace with a real source.
 */
export function useTelemetry(active: boolean): Telemetry {
  const ref = useRef<Telemetry>({ ts: 1240, ns: 38, rs: 812, history: Array(48).fill(1240) });
  const [, force] = useState(0);
  useEffect(() => {
    const walk = (v: number, lo: number, hi: number, step: number) =>
      Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * step));
    const t = window.setInterval(() => {
      const cur = ref.current;
      // Livelier feed while the layout simulation is running.
      const ts = walk(cur.ts, 400, 2400, active ? 320 : 120);
      ref.current = {
        ts,
        ns: walk(cur.ns, 4, 96, 14),
        rs: walk(cur.rs, 200, 1400, 150),
        history: [...cur.history.slice(1), ts]
      };
      force((n) => n + 1);
    }, 700);
    return () => window.clearInterval(t);
  }, [active]);
  return ref.current;
}

/** Fires when a command hotkey is pressed so its button can flash. */
export const CMD_PRESS_EVENT = 'scope:cmd-press';

export function useCommandFlash(key: string) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let t = 0;
    const onPress = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== key) return;
      setFlash(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setFlash(false), 160);
    };
    window.addEventListener(CMD_PRESS_EVENT, onPress);
    return () => {
      window.removeEventListener(CMD_PRESS_EVENT, onPress);
      window.clearTimeout(t);
    };
  }, [key]);
  return flash;
}
