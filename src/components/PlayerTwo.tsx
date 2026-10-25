import { useEffect, useRef } from 'react';
import { Animated, Animator, FrameKranox } from '@arwes/react';
import { useStore } from '../store';

/**
 * The companion: Player Two's slot in the HUD, the way a StarCraft adjutant sits in it. A panel in
 * the bottom row beside the Scope map, on the same frame as the other panels, with a plain live
 * portrait drawn on a canvas, no library: a breathing core inside two halo rings, in the view's
 * blue at rest and in Artemis's own red while she reads, a beat on every step, a flare on a
 * finding. The slot is the point; a richer companion attaches here later (a 3D goddess head was
 * built and parked on the local branch `player-two-portrait`). It folds with the row (C) and has
 * nothing to click.
 */
export function PlayerTwo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engaged = useStore((s) => s.engaged);
  const stageView = useStore((s) => s.stageView);
  const on = useStore((s) => s.agent.on);
  const at = useStore((s) => s.agent.at);
  const note = useStore((s) => s.agent.note);
  const trail = useStore((s) => s.agent.trail);
  const findings = useStore((s) => s.agent.findings);
  const flare = useRef(0);
  const beat = useRef(0);
  const lastFindings = useRef(findings.length);
  const lastAt = useRef(at);

  if (findings.length !== lastFindings.current) {
    lastFindings.current = findings.length;
    flare.current = 1;
  }
  if (at !== lastAt.current) {
    lastAt.current = at;
    beat.current = 1;
  }

  // Her colours are read from the palette once per state change, never per frame: a computed
  // style each frame forced a style pass on the whole console (2.5 fps against 8 under software
  // rendering, measured in the /debug test's headless mode).
  const colors = useRef({ red: '#ff5a4a', blue: '#7b98f0' });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engaged) return;
    const style = getComputedStyle(canvas);
    colors.current = {
      red: style.getPropertyValue('--player').trim() || colors.current.red,
      blue: style.getPropertyValue('--sky').trim() || colors.current.blue
    };
  }, [engaged, on, stageView]);

  // The portrait draws only once the console is engaged; the entry screen has no companion yet.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engaged) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 124;
    const H = canvas.clientHeight || 124;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let raf = 0;
    let t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const live = canvas.dataset.on === 'true';
      const [cr, cg, cb] = rgb(live ? colors.current.red : colors.current.blue);
      flare.current = Math.max(0, flare.current - 0.025);
      beat.current = Math.max(0, beat.current - 0.05);
      const breathe = reduced ? 0 : Math.sin(t * (live ? 1.9 : 0.9)) * 0.04;
      const R = H * 0.3 * (1 + breathe + beat.current * 0.08 + flare.current * 0.12);
      const cx = W / 2;
      const cy = H / 2;
      ctx.clearRect(0, 0, W, H);
      // Halo.
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.3 + flare.current * 0.4})`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.08 + flare.current * 0.15})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // The core: a soft disc.
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.55 + flare.current * 0.45})`;
      ctx.fill();
      // Two rings, tilted, turning slowly against each other.
      ctx.lineWidth = 1;
      for (let ring = 0; ring < 2; ring++) {
        const spin = reduced ? 0 : t * (live ? 0.9 : 0.35) * (ring === 0 ? 1 : -0.7);
        const tilt = 0.35 + ring * 0.25;
        const rr = R * (0.8 + ring * 0.22);
        ctx.beginPath();
        for (let k = 0; k <= 96; k++) {
          const a = (k / 96) * Math.PI * 2;
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr * Math.cos(tilt);
          const px = cx + x * Math.cos(spin) - y * Math.sin(spin);
          const py = cy + x * Math.sin(spin) + y * Math.cos(spin);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(ring === 0 ? 0.7 : 0.4) + flare.current * 0.3})`;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame((n) => {
      t0 = n;
      draw(n);
    });
    return () => cancelAnimationFrame(raf);
  }, [engaged]);

  const state = on ? 'READING' : trail.length ? 'STANDING BY' : 'IDLE';
  return (
    <Animator>
      <Animated
        as="aside"
        className={`panel companion${engaged ? ' is-on' : ''}${on ? ' is-live' : ''}`}
        animated={['fade', ['x', -18, 0]]}
        aria-label="Artemis, Player Two"
        data-on={on}
      >
        <Animator>
          <FrameKranox className="frame" strokeWidth={1.5} squareSize={10} smallLineLength={10} largeLineLength={36} />
        </Animator>
        <div className="panel-title">
          <span>ARTEMIS</span>
          <span className="panel-title-right p2-state">{state}</span>
        </div>
        <div className="p2-body">
          <canvas ref={canvasRef} className="p2-portrait" data-on={on} aria-hidden />
          <div className="p2-say" aria-live="polite">{note || 'Press D in the Cosmos and I will read it with you.'}</div>
          <div className="p2-stats">
            <span><b>{trail.length + (at !== null ? 1 : 0)}</b> read</span>
            <span><b>{findings.length}</b> found</span>
          </div>
        </div>
      </Animated>
    </Animator>
  );
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return [255, 90, 74];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
