import { Animator, Dots, GridLines, MovingLines } from '@arwes/react';
import { useStore } from '../store';
import { PALETTES, rgbaCss } from '../views';

// Arwes background layers: faint grid, cross-shaped dot field (as in the ZKN reference), moving
// scan lines. They draw on canvas, so they take the shown view's palette as literal colours and
// remount (re-entering) when the view changes behind the dive.
export function Background() {
  const view = useStore((s) => s.stageView);
  const p = PALETTES[view];
  return (
    <Animator active duration={{ enter: 1.4, interval: 6 }}>
      <div className="bg-layer" aria-hidden>
        <GridLines key={`grid-${view}`} lineColor={rgbaCss(p.azure, 0.07)} distance={48} />
        <Dots key={`dots-${view}`} type="cross" color={rgbaCss(p.azure, 0.26)} distance={48} size={7} crossSize={1} origin="center" />
        <MovingLines key={`lines-${view}`} lineColor={rgbaCss(p.azure, 0.08)} distance={48} sets={18} />
        <div className="bg-vignette" />
      </div>
    </Animator>
  );
}
