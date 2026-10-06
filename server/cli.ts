// The launcher's arguments: `bun run artemis [website] [--autopilot slow|regular|max]`.
// The website is read like the console's own field (src/target.ts); the autopilot's levels are
// the console's speeds (src/autopilot.ts: 1 slow, 2 regular, 3 max), so the flag only presses D
// for the operator, as many times as the level says.
import { normalizeTarget } from '../src/target';

export type Level = 0 | 1 | 2 | 3;

export interface ArtemisArgs {
  website: string | null;
  autopilot: Level;
  help: boolean;
}

export const LEVELS: Record<Exclude<Level, 0>, { name: string; does: string }> = {
  1: { name: 'slow', does: 'about 10 s a page, scrolling down it' },
  2: { name: 'regular', does: 'about 3 s a page' },
  3: { name: 'max', does: 'the next page as soon as one has loaded' }
};

export const USAGE = `Usage: bun run artemis [website] [--autopilot slow|regular|max]

  website                 the web application to open (example.com, https://app.example.com/login)
  -a, --autopilot <level> fly the site on its own once it has loaded: slow (about 10 s a page,
                          scrolling), regular (about 3 s a page) or max (as fast as pages load);
                          1, 2 and 3 work too. A hand on the site takes the controls back.
  -h, --help              this help

Environment: ARTEMIS_PORT, ARTEMIS_PROFILE_DIR, ARTEMIS_SESSIONS_DIR, ARTEMIS_SHELL_HIDDEN=1, NO_COLOR.`;

const levelOf = (value: string): Level | null => {
  const v = value.trim().toLowerCase();
  for (const [n, l] of Object.entries(LEVELS)) if (v === l.name || v === n) return Number(n) as Level;
  return null;
};

export function parseArtemisArgs(argv: string[]): ArtemisArgs | { error: string } {
  const sites: string[] = [];
  let autopilot: Level = 0;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '-a' || arg === '--autopilot' || arg.startsWith('--autopilot=')) {
      const value = arg.startsWith('--autopilot=') ? arg.slice('--autopilot='.length) : (argv[++i] ?? '');
      const level = levelOf(value);
      if (level === null) return { error: `unknown autopilot level "${value}": use slow, regular or max (or 1, 2, 3)` };
      autopilot = level;
    } else if (arg.startsWith('-')) return { error: `unknown option ${arg}` };
    else sites.push(arg);
  }
  if (help) return { website: null, autopilot, help };
  if (sites.length > 1) return { error: `one website at a time: ${sites.join(', ')}` };
  const website = sites.length ? normalizeTarget(sites[0]) : null;
  if (sites.length && !website) return { error: `not a web address: "${sites[0]}"` };
  if (autopilot && !website) return { error: `the autopilot needs a website to fly: bun run artemis <website> --autopilot ${LEVELS[autopilot as Exclude<Level, 0>].name}` };
  return { website, autopilot, help };
}

/** The flight as the driver tells it (server/autopilot-driver.ts AutopilotEvent). */
export interface FlightEvent {
  event: 'speed' | 'progress' | 'done' | 'disengaged' | 'stuck' | 'note';
  speed: number;
  previous?: number;
  visited?: number;
  pending?: number;
  etaMs?: number;
  reason?: string;
  text?: string;
}

const etaText = (ms: number): string => {
  if (ms <= 0) return 'nothing left';
  if (ms < 60_000) return 'under a minute left';
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `about ${minutes} min left` : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};

const level = (speed: number) => {
  const l = LEVELS[speed as Exclude<Level, 0>];
  return l ? `${l.name} · ${l.does}` : 'off';
};

/**
 * Quick presses of D (three for max, or the launcher's) are one change: a speed counts once it has
 * held for `ms`, said with the speed before the burst. Anything else the flight says goes out at
 * once, after a change still settling.
 */
export function settleSpeeds(emit: (e: FlightEvent) => void, ms = 500): (e: FlightEvent) => void {
  let pending: FlightEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    if (p && p.speed !== (p.previous ?? 0)) emit(p);
  };
  return (e) => {
    if (e.event !== 'speed') {
      flush();
      emit(e);
      return;
    }
    pending = { ...e, previous: pending ? pending.previous : e.previous };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };
}

/**
 * The terminal's words for the flight: engaged, a new speed, off; progress every ten pages (each
 * page would flood an overnight run); covered or stopped; what it did for the site.
 */
export function autopilotNotices(every = 10): (e: FlightEvent) => { kind: 'autopilot' | 'site' | 'warn'; text: string } | null {
  let shown = 0;
  return (e) => {
    switch (e.event) {
      case 'speed':
        if (e.speed === 0) return { kind: 'autopilot', text: 'Off: D in the console, or a hand on the site took the controls' };
        if (!e.previous) {
          shown = 0;
          return { kind: 'autopilot', text: `Engaged at ${level(e.speed)}` };
        }
        return { kind: 'autopilot', text: `Speed: ${level(e.speed)}` };
      case 'progress': {
        const visited = e.visited ?? 0;
        if (visited < shown + every) return null;
        shown = visited - (visited % every);
        return { kind: 'autopilot', text: `${visited} pages visited, ${e.pending ?? 0} to go, ${etaText(e.etaMs ?? 0)}` };
      }
      case 'done':
        return { kind: 'autopilot', text: `The site is covered: ${e.visited ?? 0} page${e.visited === 1 ? '' : 's'} visited, nothing left to open` };
      case 'stuck':
        return { kind: 'warn', text: `Autopilot stopped: ${e.reason ?? 'it could not go on'}` };
      case 'disengaged':
        return { kind: 'autopilot', text: `Disengaged: ${e.reason ?? 'you took the controls'}` };
      case 'note':
        return e.text ? { kind: 'site', text: `Autopilot ${e.text}` } : null;
    }
  };
}
