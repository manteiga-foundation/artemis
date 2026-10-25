import { useStore } from '../store';

/**
 * While the autopilot flies, a soft glow runs around the edges of the screen (the user's idea):
 * something is going on, wherever the operator looks, in either view. It breathes faster with the
 * speed, holds steady under reduced motion, and never takes a click (the owned browser's click
 * pass-through skips it too).
 */
export function AutopilotGlow() {
  const speed = useStore((s) => s.autopilot);
  // Player Two breathes the same edge in her red while she reads; with the autopilot flying as
  // well the ring wears a third colour, the two mixed, so neither is mistaken for the other.
  const player = useStore((s) => s.agent.on);
  const who = player && speed ? ' is-both' : player ? ' is-player' : '';
  return (
    <div className={`autopilot-glow${speed > 0 || player ? ' is-on' : ''}${who}`} data-speed={speed || (player ? 2 : 0)} aria-hidden>
      <div className="autopilot-glow-ring" />
    </div>
  );
}
