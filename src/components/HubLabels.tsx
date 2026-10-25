import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { useStore } from '../store';

/** Least room between two shown labels (px). */
const LABEL_GAP = 4;
/** Frames a label waits for its tracked position before it hides (a growth re-tracks for a frame). */
const POSITION_GRACE = 12;

// HTML labels pinned to the core, sector hubs and the current selection.
// Positions are read from cosmos.gl tracked points every frame and written straight to the DOM.
// The set of labels is reconciled, never rebuilt: a node added while the autopilot flies or the
// selection changing keeps every other label's element, so nothing fades out and in (no flash).
export function HubLabels() {
  const layerRef = useRef<HTMLDivElement>(null);
  const engaged = useStore((s) => s.engaged);
  const selected = useStore((s) => s.selected);
  const seed = useStore((s) => s.seed);
  const graphVersion = useStore((s) => s.graphVersion);
  const els = useRef(new Map<number, HTMLDivElement>());
  const texts = useRef(new Map<number, HTMLSpanElement>());
  const order = useRef<number[]>([]);
  const missing = useRef(new Map<number, number>());

  // What is wanted, and in which order labels give way: the selected page, then the core, then
  // the sections, then the rest (labelIndices' order). Zooming in brings them back.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const d = controller.data;
    const base = controller.labelIndices();
    const wanted = selected !== null && selected < d.count && !base.includes(selected) ? [...base, selected] : base;
    const rank = (i: number) => (i === selected ? -2 : i === d.core ? -1 : wanted.indexOf(i));
    order.current = [...wanted].sort((a, b) => rank(a) - rank(b));
    const keep = new Set(wanted);
    els.current.forEach((el, idx) => {
      if (keep.has(idx)) return;
      el.remove();
      els.current.delete(idx);
      texts.current.delete(idx);
      missing.current.delete(idx);
    });
    wanted.forEach((idx) => {
      const m = d.meta[idx];
      const cls = `hub-label tier-${m.tier}${idx === selected ? ' is-selected' : ''}`;
      let el = els.current.get(idx);
      if (!el) {
        el = document.createElement('div');
        // Recorded names come from the website: text, never markup.
        const line = document.createElement('span');
        line.className = 'hub-line';
        const text = document.createElement('span');
        text.className = 'hub-text';
        el.append(line, text);
        texts.current.set(idx, text);
        el.style.opacity = '0';
        layer.appendChild(el);
        els.current.set(idx, el);
      }
      if (el.className !== cls) el.className = cls;
      const text = texts.current.get(idx)!;
      if (text.textContent !== m.id) text.textContent = m.id;
    });
  }, [selected, seed, graphVersion]);

  // One frame loop for the layer's life.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pos = controller.hubScreenPositions();
      // Writes first, then reads, so the frame costs one style pass.
      const placed = new Set<number>();
      els.current.forEach((el, idx) => {
        const p = pos.get(idx);
        if (p && Number.isFinite(p[0])) {
          el.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
          placed.add(idx);
          missing.current.delete(idx);
        } else {
          // Not tracked this frame (a growth re-tracks): hold the last place for a few frames.
          const n = (missing.current.get(idx) ?? 0) + 1;
          missing.current.set(idx, n);
          if (n <= POSITION_GRACE && el.style.transform) placed.add(idx);
        }
      });
      const shown: DOMRect[] = [];
      for (const idx of order.current) {
        const el = els.current.get(idx);
        if (!el) continue;
        let show = placed.has(idx);
        if (show) {
          const r = texts.current.get(idx)!.getBoundingClientRect();
          show = !shown.some((o) => r.left < o.right + LABEL_GAP && o.left < r.right + LABEL_GAP && r.top < o.bottom + LABEL_GAP && o.top < r.bottom + LABEL_GAP);
          if (show) shown.push(r);
        }
        const opacity = show ? '1' : '0';
        if (el.style.opacity !== opacity) el.style.opacity = opacity;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const current = els.current;
    const currentTexts = texts.current;
    return () => {
      cancelAnimationFrame(raf);
      current.forEach((el) => el.remove());
      current.clear();
      currentTexts.clear();
    };
  }, []);

  return <div ref={layerRef} className={`labels-layer${engaged ? ' is-on' : ''}`} aria-hidden />;
}
