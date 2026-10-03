// The views of the console and their palettes.
//
// A view is the console's mode: what fills the stage, which commands the card offers, which
// palette every Arwes frame and the WebGL graph use. Views are ordered by depth, nearest first:
// the browser (the page itself, the home view), the page (one page and its connections), the
// cosmos (everything). V pulls back one shown step and wraps back in.
//
// Two views are shown for the prototype: V pulls back from the browser straight to the cosmos,
// landing on the current page, and returns. The Page view stays in code (palette, commands,
// behaviour, tests) but is hidden; clearing `hidden` puts it back in the cycle.
//
// Not to be confused with lenses (Overview, Clusters, ...), which are perspectives within a view.

export type ViewId = 'browser' | 'page' | 'cosmos';

export interface ViewSpec {
  id: ViewId;
  label: string;
  /** Short line shown under the brand in the header. */
  tagline: string;
  /** Kept in code (palette, commands, behaviour) but left out of the V cycle. */
  hidden?: boolean;
}

export const VIEWS: readonly ViewSpec[] = [
  { id: 'browser', label: 'Browser', tagline: 'Live page' },
  { id: 'page', label: 'Page', tagline: 'Page and its connections', hidden: true },
  { id: 'cosmos', label: 'Cosmos', tagline: 'Entire network' }
];

/** The views V moves between, nearest first. */
export const SHOWN_VIEWS: readonly ViewSpec[] = VIEWS.filter((v) => !v.hidden);

export const VIEW_BY_ID = new Map(VIEWS.map((v) => [v.id, v]));

/** 0 = nearest (browser), 2 = farthest (cosmos). Hidden views keep their depth. */
export const viewDepth = (id: ViewId): number => VIEWS.findIndex((v) => v.id === id);

/** The view V goes to: the next shown view farther out, wrapping from the cosmos back into the browser. */
export const nextView = (id: ViewId): ViewId =>
  (SHOWN_VIEWS.find((v) => viewDepth(v.id) > viewDepth(id)) ?? SHOWN_VIEWS[0]).id;

/** The next shown view nearer in, wrapping from the browser out to the cosmos. */
export const prevView = (id: ViewId): ViewId =>
  ([...SHOWN_VIEWS].reverse().find((v) => viewDepth(v.id) < viewDepth(id)) ?? SHOWN_VIEWS[SHOWN_VIEWS.length - 1]).id;

// ---------------------------------------------------------------- palettes
// Each ramp was derived from the Egyptian blue ramp by rotating hue in OKLCH at equal lightness
// and chroma (the amber mid-steps lifted so they read as yellow), then checked for contrast.
// Token names keep the blue ramp's vocabulary so one stylesheet serves all three views.

export interface Palette {
  bg: string;
  bg2: string;
  deep: string;
  navy: string;
  base: string;
  royal: string;
  azure: string;
  sky: string;
  mist: string;
  frost: string;
  white: string;
  /** Attention accent: target lock, armed state, anomalies. */
  alert: string;
}

export const PALETTES: Record<ViewId, Palette> = {
  // Egyptian blue, unchanged from the original draft. Gold accent, 9.4:1 on panels.
  cosmos: {
    bg: '#02061a',
    bg2: '#040b26',
    deep: '#071441',
    navy: '#0b1f66',
    base: '#1034a6',
    royal: '#2a4fc4',
    azure: '#4c6fe0',
    sky: '#7b98f0',
    mist: '#a9bdf7',
    frost: '#d6e0fc',
    white: '#eef3ff',
    alert: '#e0b85c'
  },
  // Viridian (OKLCH hue 165). Gold accent stays, 8.9:1 on panels.
  browser: {
    bg: '#000c04',
    bg2: '#001408',
    deep: '#002410',
    navy: '#00381a',
    base: '#005d2c',
    royal: '#007743',
    azure: '#009561',
    sky: '#43b48a',
    mist: '#8fcfb3',
    frost: '#cce9db',
    white: '#eaf7f0',
    alert: '#e0b85c'
  },
  // Orpiment amber (OKLCH hue 80). Pale blue accent, 8.9:1 on panels; gold would vanish here.
  page: {
    bg: '#110500',
    bg2: '#1a0900',
    deep: '#2d1100',
    navy: '#481b00',
    base: '#954c00',
    royal: '#b16600',
    azure: '#c88000',
    sky: '#d8a239',
    mist: '#e3c085',
    frost: '#efdec4',
    white: '#f9f2e7',
    alert: '#9fb6ff'
  }
};

/** CSS custom property declarations for a view's palette, e.g. `--base: #954c00;`. */
export const paletteCss = (id: ViewId): string =>
  Object.entries(PALETTES[id])
    .map(([k, v]) => `--${k}: ${v};`)
    .join(' ');

/** The same palette as a React style object, applied on `.app` so every panel inherits it. */
export const paletteStyle = (id: ViewId): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(PALETTES[id])) out[`--${k}`] = v;
  out['--eg'] = PALETTES[id].base; // legacy alias used by the original stylesheet
  return out;
};

/** `rgba()` string from a palette hex, for canvas-drawn layers that cannot read CSS variables. */
export const rgbaCss = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
