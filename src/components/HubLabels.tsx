import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { useStore } from '../store';

/** Least room between two shown labels (px). */
const LABEL_GAP = 4;

// HTML labels pinned to the core, sector hubs and the current selection.
// Positions are read from cosmos.gl tracked points every frame and written straight to the DOM.
export function HubLabels() {
  const layerRef = useRef<HTMLDivElement>(null);
  const engaged = useStore((s) => s.engaged);
  const selected = useStore((s) => s.selected);
  const seed = useStore((s) => s.seed);
  const graphVersion = useStore((s) => s.graphVersion);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const els = new Map<number, HTMLDivElement>();
    const texts = new Map<number, HTMLSpanElement>();
    const d = controller.data;
    const base = controller.labelIndices();
    const wanted = selected !== null && selected < d.count && !base.includes(selected) ? [...base, selected] : base;
    // When labels collide they give way in this order: the selected page, then the core, then the
    // sections, then the rest (labelIndices' order). Zooming in brings them back.
    const order = [...wanted].sort((a, b) => rank(a) - rank(b));
    function rank(i: number) {
      return i === selected ? -2 : i === d.core ? -1 : wanted.indexOf(i);
    }

    wanted.forEach((idx) => {
      const m = d.meta[idx];
      const el = document.createElement('div');
      el.className = `hub-label tier-${m.tier}${idx === selected ? ' is-selected' : ''}`;
      // Recorded names come from the website: text, never markup.
      const line = document.createElement('span');
      line.className = 'hub-line';
      const text = document.createElement('span');
      text.className = 'hub-text';
      text.textContent = m.id;
      el.append(line, text);
      texts.set(idx, text);
      el.style.opacity = '0';
      layer.appendChild(el);
      els.set(idx, el);
    });

    let raf = 0;
    const tick = () => {
      const pos = controller.hubScreenPositions();
      // Writes first, then reads, so the frame costs one style pass.
      const placed = new Set<number>();
      els.forEach((el, idx) => {
        const p = pos.get(idx);
        if (!p || !Number.isFinite(p[0])) return;
        el.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
        placed.add(idx);
      });
      const shown: DOMRect[] = [];
      for (const idx of order) {
        const el = els.get(idx)!;
        let show = placed.has(idx);
        if (show) {
          const r = texts.get(idx)!.getBoundingClientRect();
          show = !shown.some((o) => r.left < o.right + LABEL_GAP && o.left < r.right + LABEL_GAP && r.top < o.bottom + LABEL_GAP && o.top < r.bottom + LABEL_GAP);
          if (show) shown.push(r);
        }
        const opacity = show ? '1' : '0';
        if (el.style.opacity !== opacity) el.style.opacity = opacity;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((el) => el.remove());
    };
  }, [selected, seed, graphVersion]);

  return <div ref={layerRef} className={`labels-layer${engaged ? ' is-on' : ''}`} aria-hidden />;
}
