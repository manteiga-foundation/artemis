// Egyptian blue design tokens. Base hue: Egyptian blue #1034A6.
// Shared between CSS (via custom properties in styles.css) and the WebGL graph.

export const EG = {
  bg: '#02061a',
  bg2: '#040b26',
  deep: '#071441',
  navy: '#0b1f66',
  egyptian: '#1034a6',
  royal: '#2a4fc4',
  azure: '#4c6fe0',
  sky: '#7b98f0',
  mist: '#a9bdf7',
  frost: '#d6e0fc',
  white: '#eef3ff',
  // Alert accent (gold, used sparingly for anomalies/warnings).
  alert: '#e0b85c'
} as const;

// Per-sector hues for the "Clusters" view: blue / faience-turquoise / indigo family.
export const SECTOR_HUES = ['#4f7bff', '#39b6e6', '#7d6cf2', '#5fd6e8', '#2f5ed9', '#a6b9ff'];

export type RGBA = [number, number, number, number];

export const rgba = (hex: string, a = 1): RGBA => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

export const mix = (a: RGBA, b: RGBA, t: number): RGBA => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t
];
