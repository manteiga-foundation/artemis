import { useStore } from '../store';

/**
 * While the autopilot flies, a soft glow runs around the edges of the screen (the user's idea):
 * something is going on, wherever the operator looks, in either view. It breathes faster with the
 * speed, holds steady under reduced motion, and never takes a click (the owned browser's click
 * pass-through skips it too).
 */
export function AutopilotGlow() {
  const speed = useStore((s) => s.autopilot);
  return (
    <div className={`autopilot-glow${speed > 0 ? ' is-on' : ''}`} data-speed={speed} aria-hidden>
      <div className="autopilot-glow-ring" />
    </div>
  );
}
