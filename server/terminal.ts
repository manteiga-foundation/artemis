// How `bun run artemis` looks in the terminal: a large ARTEMIS welcome, what this run is, then one
// notification per event (the session's files as soon as they exist, the autopilot, saving).
//
// Colours are the console's palettes (src/views.ts): gold letter faces with Egyptian-blue shadows
// (Cosmos), viridian for the autopilot (Browser), orpiment amber for warnings (Page). Truecolor
// where the terminal says it has it (COLORTERM), the nearest of the 256 colours otherwise, plain
// text when the output is not a terminal or NO_COLOR is set. No dependencies.

export type ColorMode = 'none' | '256' | 'truecolor';

const C = {
  goldLight: '#f3dfa2',
  gold: '#e0b85c',
  amber: '#c88000',
  blue: '#5b7be0', // Egyptian blue #1034a6, lifted to read on a dark terminal
  paleBlue: '#9fb6ff',
  viridian: '#43b48a',
  viridianText: '#8fcfb3',
  text: '#cce9db',
  dim: '#6f8a80',
  red: '#e0705c'
} as const;

export function colorMode(env: Record<string, string | undefined>, isTTY: boolean): ColorMode {
  if (env.NO_COLOR) return 'none';
  if (env.FORCE_COLOR === '0') return 'none';
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || env.FORCE_COLOR === '3';
  if (!isTTY && env.FORCE_COLOR === undefined) return 'none';
  return truecolor ? 'truecolor' : '256';
}

const LEVELS6 = [0, 95, 135, 175, 215, 255];
const nearest6 = (v: number) => LEVELS6.reduce((best, l, i) => (Math.abs(l - v) < Math.abs(LEVELS6[best] - v) ? i : best), 0);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function paint(text: string, hex: string, mode: ColorMode, extra = ''): string {
  if (mode === 'none' || !text) return text;
  const [r, g, b] = rgb(hex);
  const fg = mode === 'truecolor' ? `38;2;${r};${g};${b}` : `38;5;${16 + 36 * nearest6(r) + 6 * nearest6(g) + nearest6(b)}`;
  return `\x1b[${extra}${fg}m${text}\x1b[0m`;
}

/** The text without its colours. */
export const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// The block letters (ANSI Shadow): A R T E M I S. Faces are █, shadows the box-drawing strokes.
const LETTERS: Record<string, string[]> = {
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝']
};
const BANNER = [0, 1, 2, 3, 4, 5].map((row) => [...'ARTEMIS'].map((ch) => LETTERS[ch][row]).join(''));
const BANNER_WIDTH = Math.max(...BANNER.map((r) => r.length));
/** Top to bottom, light gold to amber: the faces catch the light. */
const FACE = ['#f3dfa2', '#ecd088', '#e6c271', '#e0b85c', '#d6a243', '#c88000'];

/** One banner row: faces in the row's gold, shadow strokes in blue. */
const bannerRow = (row: string, i: number, mode: ColorMode) => row.replace(/(█+)|([^█ ]+)/g, (_m, face: string, shadow: string) => (face ? paint(face, FACE[i], mode, '1;') : paint(shadow, C.blue, mode)));

export interface WelcomeInfo {
  version: string;
  consoleUrl: string;
  website: string | null;
  autopilot: 0 | 1 | 2 | 3;
  profile: string;
  sessions: string;
}

const AUTOPILOT_TEXT = {
  1: 'slow · about 10 s a page, scrolling down it',
  2: 'regular · about 3 s a page',
  3: 'max · the next page as soon as one has loaded'
} as const;

export function welcome(info: WelcomeInfo, o: { mode: ColorMode; columns: number }): string {
  const { mode } = o;
  const wide = o.columns >= BANNER_WIDTH + 4;
  const ruleWidth = Math.min(wide ? BANNER_WIDTH : o.columns - 4, 72);
  const rule = '  ' + paint('─'.repeat(ruleWidth), C.blue, mode);
  const field = (label: string, value: string, tone: string = C.text) => `  ${paint(label.padEnd(11), C.viridianText, mode)}${paint(value, tone, mode)}`;
  const title = wide ? BANNER.map((r, i) => '  ' + bannerRow(r, i, mode)) : ['  ' + paint('A R T E M I S', C.gold, mode, '1;')];
  const hint = 'Ctrl+C saves and closes · Ctrl+C twice quits at once';
  const hints = hint.length + 2 <= o.columns ? [hint] : hint.split(' · ');
  return [
    '',
    ...title,
    `  ${paint('WEB APPLICATION INTELLIGENT CONSOLE', C.viridianText, mode)}  ${paint('·', C.dim, mode)}  ${paint(`v${info.version}`, C.dim, mode)}`,
    rule,
    field('Console', info.consoleUrl),
    info.website ? field('Website', info.website, C.goldLight) : field('Website', 'none yet: type one in the console', C.dim),
    info.autopilot ? field('Autopilot', AUTOPILOT_TEXT[info.autopilot], C.viridian) : field('Autopilot', 'off · D in the console, or --autopilot slow|regular|max', C.dim),
    field('Profile', info.profile),
    field('Sessions', info.sessions),
    rule,
    ...hints.map((h) => `  ${paint(h, C.dim, mode)}`),
    ''
  ].join('\n');
}

export type NoticeKind = 'artemis' | 'session' | 'har' | 'autopilot' | 'site' | 'recovered' | 'closing' | 'saved' | 'warn' | 'error';

const KIND: Record<NoticeKind, { tag: string; color: string }> = {
  artemis: { tag: 'ARTEMIS', color: C.paleBlue },
  session: { tag: 'SESSION', color: C.gold },
  har: { tag: 'HAR', color: C.gold },
  autopilot: { tag: 'AUTOPILOT', color: C.viridian },
  site: { tag: 'SITE', color: C.paleBlue },
  recovered: { tag: 'RECOVERED', color: C.amber },
  closing: { tag: 'CLOSING', color: C.amber },
  saved: { tag: 'SAVED', color: C.viridian },
  warn: { tag: 'WARNING', color: C.amber },
  error: { tag: 'ERROR', color: C.red }
};

const two = (n: number) => String(n).padStart(2, '0');

/** One notification: the time, a mark and the kind in its colour, the message; paths stand out. */
export function notice(kind: NoticeKind, message: string, o: { mode: ColorMode; now?: Date }): string {
  const { mode } = o;
  const now = o.now ?? new Date();
  const k = KIND[kind];
  const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const body = message.replace(/(^|\s)(\/\S+)/g, (_m, lead: string, path: string) => lead + paint(path, C.goldLight, mode, '4;'));
  return `  ${paint(time, C.dim, mode)}  ${paint('◆', k.color, mode)} ${paint(k.tag.padEnd(11), k.color, mode, '1;')}${mode === 'none' ? body : paintRest(body, mode)}`;
}

/** The message's own words in the console's text colour, around the highlighted paths. */
const paintRest = (s: string, mode: ColorMode) => s.split(/(\x1b\[[0-9;]*m[^\x1b]*\x1b\[0m)/).map((part) => (part.startsWith('\x1b') ? part : paint(part, C.text, mode))).join('');
