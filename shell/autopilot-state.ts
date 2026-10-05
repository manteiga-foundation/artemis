// The shell's side of the autopilot (bundled into main.cjs): the speed the console set (0 off,
// 1 slow, 2 regular, 3 max) and when the autopilot itself is acting in the site. Its own clicks are
// recorded as the autopilot's; the operator's click, wheel or typing in the site while it flies
// disengages it, like a real autopilot when the pilot takes the yoke.

/** The page reports an event a moment after Playwright's click returns. */
const LATE_MS = 600;
const EARLY_MS = 50;
const KEEP_WINDOWS = 50;

export interface AutopilotState {
  speed: 0 | 1 | 2 | 3;
  acting: boolean;
  actingSince: number;
  /** Recent spans of the autopilot's own input, [from, until]. */
  windows: [number, number][];
}

export const createAutopilot = (): AutopilotState => ({ speed: 0, acting: false, actingSince: 0, windows: [] });

export function setSpeed(s: AutopilotState, speed: number): void {
  s.speed = speed === 1 || speed === 2 || speed === 3 ? speed : 0;
}

export function setActing(s: AutopilotState, on: boolean, now: number): void {
  if (on) {
    s.acting = true;
    s.actingSince = now;
    return;
  }
  if (s.acting) s.windows.push([s.actingSince, now + LATE_MS]);
  s.acting = false;
  if (s.windows.length > KEEP_WINDOWS) s.windows.splice(0, s.windows.length - KEEP_WINDOWS);
}

const actingAt = (s: AutopilotState, t: number): boolean =>
  (s.acting && t >= s.actingSince - EARLY_MS) || s.windows.some(([from, until]) => t >= from - EARLY_MS && t <= until);

export const actorAt = (s: AutopilotState, t: number): 'user' | 'autopilot' => (actingAt(s, t) ? 'autopilot' : 'user');

/** The operator touched the site. True when that disengaged the autopilot. */
export function onSiteInput(s: AutopilotState, t: number): boolean {
  if (s.speed === 0 || actingAt(s, t)) return false;
  s.speed = 0;
  return true;
}
