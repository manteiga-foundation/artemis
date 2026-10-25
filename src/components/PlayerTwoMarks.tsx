import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { useStore } from '../store';

/** Frames a mark waits for its tracked position before it hides (a growth re-tracks for a frame). */
const POSITION_GRACE = 12;

/**
 * Player Two's hand on the cosmos: a red reticle on the node Artemis is reading, with what she is
 * doing in one line, and a red pin with its note on every node she marked. Positions are read
 * from cosmos.gl tracked points every frame, as the hub labels are. The marks are reconciled,
 * never rebuilt, so a step of hers or a growth of the cosmos moves the reticle without a flash.
 * She never takes the camera.
 */
export function PlayerTwoMarks() {
  const layerRef = useRef<HTMLDivElement>(null);
  const engaged = useStore((s) => s.engaged);
  const stageView = useStore((s) => s.stageView);
  const at = useStore((s) => s.agent.at);
  const note = useStore((s) => s.agent.note);
  const on = useStore((s) => s.agent.on);
  const findings = useStore((s) => s.agent.findings);
  const graphVersion = useStore((s) => s.graphVersion);
  const seed = useStore((s) => s.seed);
  const els = useRef(new Map<string, HTMLDivElement>());
  const missing = useRef(new Map<string, number>());

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const d = controller.data;
    const wanted = new Map<string, { idx: number; cls: string; who: string; text: string }>();
    if (stageView === 'cosmos') {
      for (const f of findings) {
        if (f.node < d.count) wanted.set(`f${f.node}`, { idx: f.node, cls: 'p2-mark is-finding', who: 'FINDING', text: `${d.meta[f.node].id}: ${f.note}` });
      }
      if (at !== null && at < d.count) wanted.set('here', { idx: at, cls: `p2-mark is-here${on ? '' : ' is-still'}`, who: 'ARTEMIS', text: note });
    }
    els.current.forEach((el, key) => {
      if (wanted.has(key)) return;
      el.remove();
      els.current.delete(key);
      missing.current.delete(key);
    });
    wanted.forEach((w, key) => {
      let el = els.current.get(key);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<span class="p2-ring"></span><span class="p2-line"></span><span class="p2-text"><span class="p2-who"></span><span class="p2-note"></span></span>';
        el.style.opacity = '0';
        layer.appendChild(el);
        els.current.set(key, el);
      }
      if (el.className !== w.cls) el.className = w.cls;
      el.dataset.node = String(w.idx);
      const who = el.querySelector<HTMLSpanElement>('.p2-who')!;
      const txt = el.querySelector<HTMLSpanElement>('.p2-note')!;
      if (who.textContent !== w.who) who.textContent = w.who;
      if (txt.textContent !== w.text) txt.textContent = w.text;
    });
  }, [at, note, on, findings, stageView, graphVersion, seed]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const pos = controller.hubScreenPositions();
      els.current.forEach((el, key) => {
        const p = pos.get(Number(el.dataset.node));
        let ok = !!p && Number.isFinite(p[0]);
        if (ok) {
          el.style.transform = `translate(${p![0]}px, ${p![1]}px)`;
          missing.current.delete(key);
        } else {
          const n = (missing.current.get(key) ?? 0) + 1;
          missing.current.set(key, n);
          ok = n <= POSITION_GRACE && !!el.style.transform;
        }
        const opacity = ok ? '1' : '0';
        if (el.style.opacity !== opacity) el.style.opacity = opacity;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const current = els.current;
    return () => {
      cancelAnimationFrame(raf);
      current.forEach((el) => el.remove());
      current.clear();
    };
  }, []);

  return <div ref={layerRef} className={`p2-layer${engaged ? ' is-on' : ''}`} aria-hidden />;
}
