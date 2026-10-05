import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { setState, useStore } from '../store';
import { GraphCanvas } from './GraphCanvas';
import { HubLabels } from './HubLabels';
import { BrowserSurface } from './BrowserSurface';
import { SettingsSurface } from './SettingsSurface';

// The stage is the centre of the console: the cosmos / page graph or the browser surface.
// A view switch is a dive along the camera's axis. The outgoing view rushes past the camera
// (dive in) or falls away into depth (dive out); at the midpoint the stage swaps what it shows
// and the incoming view arrives from the opposite side. The HUD folds away during the first half
// and reassembles, recoloured, during the second.

export const DIVE_MS = 1200;
/** Fraction of the dive at which the stage swaps what it shows (inside the dark gap). */
const SWAP_AT = 0.47;
const P = 'perspective(1400px)';
const LEAVE = 'cubic-bezier(0.55, 0, 0.85, 0.35)';
const ARRIVE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

const DIVE_IN: Keyframe[] = [
  { transform: `${P} translateZ(0) rotateX(0deg)`, opacity: 1, filter: 'blur(0px)', offset: 0, easing: LEAVE },
  { transform: `${P} translateZ(560px) rotateX(2.5deg)`, opacity: 0, filter: 'blur(10px)', offset: 0.44 },
  { transform: `${P} translateZ(-1000px) rotateX(-2.5deg)`, opacity: 0, filter: 'blur(10px)', offset: 0.5, easing: ARRIVE },
  { transform: `${P} translateZ(0) rotateX(0deg)`, opacity: 1, filter: 'blur(0px)', offset: 1 }
];

const DIVE_OUT: Keyframe[] = [
  { transform: `${P} translateZ(0) rotateX(0deg)`, opacity: 1, filter: 'blur(0px)', offset: 0, easing: LEAVE },
  { transform: `${P} translateZ(-1000px) rotateX(-2.5deg)`, opacity: 0, filter: 'blur(10px)', offset: 0.44 },
  { transform: `${P} translateZ(560px) rotateX(2.5deg)`, opacity: 0, filter: 'blur(10px)', offset: 0.5, easing: ARRIVE },
  { transform: `${P} translateZ(0) rotateX(0deg)`, opacity: 1, filter: 'blur(0px)', offset: 1 }
];

const FADE: Keyframe[] = [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }];

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const transition = useStore((s) => s.viewTransition);
  const shown = useStore((s) => s.stageView);
  const settingsOpen = useStore((s) => s.settingsOpen);

  useEffect(() => {
    if (!transition) return;
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 240 : DIVE_MS;
    const frames = reduced ? FADE : transition.dir === 'in' ? DIVE_IN : DIVE_OUT;

    const swap = () => {
      setState({ stageView: transition.to });
      controller.applyLens(); // graph colours follow the shown view
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      swap();
      controller.endViewTransition(transition.id);
    };

    const anim = el.animate(frames, { duration, fill: 'none' });
    const swapTimer = window.setTimeout(swap, duration * SWAP_AT);
    // Guard: if the animation never reports completion (tab hidden, cancelled), still finish.
    const guard = window.setTimeout(finish, duration + 300);
    anim.finished.then(finish).catch(() => {});

    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(guard);
      anim.cancel();
    };
  }, [transition]);

  return (
    <div
      ref={ref}
      className="stage"
      data-shown={shown}
      data-dir={transition ? transition.dir : undefined}
    >
      <GraphCanvas />
      <HubLabels />
      {shown === 'browser' && <BrowserSurface />}
      {settingsOpen && <SettingsSurface />}
    </div>
  );
}
