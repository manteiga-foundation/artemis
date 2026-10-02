// Resource readouts. The page can measure itself precisely (frame rate, frame spikes, main-thread
// busy time, JS heap) but cannot see the machine; the owned browser's Bun side supplies machine
// and process figures (server/machine.ts) through a window event, so the header can tell
// "Artemis is slow" apart from "the machine is full".
import { useEffect } from 'react';
import { setState } from './store';
import { MACHINE_EVENT, type MachineStats } from './machine-stats';

export { MACHINE_EVENT, type MachineStats } from './machine-stats';

export interface FrameStats {
  /** Frames rendered per second over the last window. */
  fps: number;
  /** Longest frame in the window, ms. */
  worstMs: number;
}

export interface PerfStats extends FrameStats {
  /** Share of the window the main thread spent in long tasks (>50 ms), percent. */
  busyPct: number;
  /** JS heap in use, MB (Chromium only; null elsewhere). */
  heapMB: number | null;
  /** Recent fps samples, oldest first, for the header sparkline. */
  history: number[];
}

export const HISTORY = 60;

export function summarizeFrames(deltasMs: number[]): FrameStats {
  if (deltasMs.length === 0) return { fps: 0, worstMs: 0 };
  let sum = 0;
  let worst = 0;
  for (const d of deltasMs) {
    sum += d;
    if (d > worst) worst = d;
  }
  return { fps: Math.round((deltasMs.length * 1000) / sum), worstMs: Math.round(worst) };
}

/** Samples the page's own performance once a second into the store, and listens for machine stats. */
export function usePerfSampler(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const deltas: number[] = [];
    let last = performance.now();
    let longTaskMs = 0;
    let raf = 0;
    let history: number[] = [];

    const frame = (now: number) => {
      deltas.push(now - last);
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTaskMs += e.duration;
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      observer = null;
    }

    let windowStart = performance.now();
    const tick = window.setInterval(() => {
      const now = performance.now();
      const span = now - windowStart;
      windowStart = now;
      const frames = summarizeFrames(deltas);
      deltas.length = 0;
      const busyPct = span > 0 ? Math.min(100, Math.round((longTaskMs / span) * 100)) : 0;
      longTaskMs = 0;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      history = [...history.slice(-(HISTORY - 1)), frames.fps];
      setState({ perf: { ...frames, busyPct, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null, history } });
    }, 1000);

    const onMachine = (e: Event) => setState({ machine: (e as CustomEvent<MachineStats>).detail });
    window.addEventListener(MACHINE_EVENT, onMachine);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tick);
      observer?.disconnect();
      window.removeEventListener(MACHINE_EVENT, onMachine);
    };
  }, [enabled]);
}
