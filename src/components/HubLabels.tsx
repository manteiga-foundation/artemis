import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { useStore } from '../store';

// HTML labels pinned to the core, sector hubs and the current selection.
// Positions are read from cosmos.gl tracked points every frame and written straight to the DOM.
export function HubLabels() {
  const layerRef = useRef<HTMLDivElement>(null);
  const engaged = useStore((s) => s.engaged);
  const selected = useStore((s) => s.selected);
  const seed = useStore((s) => s.seed);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const els = new Map<number, HTMLDivElement>();
    const d = controller.data;
    const wanted = [d.core, ...d.sectors, ...(selected !== null ? [selected] : [])];

    wanted.forEach((idx) => {
      const m = d.meta[idx];
      const el = document.createElement('div');
      el.className = `hub-label tier-${m.tier}${idx === selected ? ' is-selected' : ''}`;
      el.innerHTML = `<span class="hub-line"></span><span class="hub-text">${m.id}</span>`;
      el.style.opacity = '0';
      layer.appendChild(el);
      els.set(idx, el);
    });

    let raf = 0;
    const tick = () => {
      const pos = controller.hubScreenPositions();
      els.forEach((el, idx) => {
        const p = pos.get(idx);
        if (!p || !Number.isFinite(p[0])) {
          el.style.opacity = '0';
          return;
        }
        el.style.opacity = '1';
        el.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((el) => el.remove());
    };
  }, [selected, seed]);

  return <div ref={layerRef} className={`labels-layer${engaged ? ' is-on' : ''}`} aria-hidden />;
}
