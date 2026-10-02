import { Animator, Dots, GridLines, MovingLines } from '@arwes/react';

// Arwes background layers: faint grid, cross-shaped dot field (as in the ZKN reference), moving scan lines.
export function Background() {
  return (
    <Animator active duration={{ enter: 1.4, interval: 6 }}>
      <div className="bg-layer" aria-hidden>
        <GridLines lineColor="hsla(226, 80%, 55%, 0.05)" distance={48} />
        <Dots type="cross" color="hsla(226, 85%, 62%, 0.22)" distance={48} size={7} crossSize={1} origin="center" />
        <MovingLines lineColor="hsla(226, 85%, 62%, 0.06)" distance={48} sets={18} />
        <div className="bg-vignette" />
      </div>
    </Animator>
  );
}
