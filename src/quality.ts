// Rendering quality knobs. The HUD is DOM and always crisp; these only affect the WebGL graph.

/** Megapixels (CSS px x pixel ratio squared) above which the graph is rendered at a lower pixel ratio.
 *  16 Mpx leaves every laptop screen and a 2560x1440 display at full ratio; a 5K display at 2x (29 Mpx) comes down. */
export const GRAPH_BUDGET_MPX = 16;

/**
 * Pixel ratio for the WebGL graph canvas. Points and links are tiny glowing shapes, so rendering
 * them at a lower ratio on very large high-DPI stages is not visible, while the GPU fill work
 * falls with the square of the ratio. `?gpr=<n>` forces a value (measurement and comparison).
 */
export function graphPixelRatio(cssWidth: number, cssHeight: number, devicePixelRatio: number, search = typeof location !== 'undefined' ? location.search : ''): number {
  const forced = Number(new URLSearchParams(search).get('gpr'));
  if (forced > 0) return forced;
  const dpr = devicePixelRatio || 1;
  const mpx = (cssWidth * cssHeight * dpr * dpr) / 1e6;
  if (mpx <= GRAPH_BUDGET_MPX) return dpr;
  // Scale the ratio down just enough to meet the budget, never below 1.
  return Math.max(1, Math.round(Math.sqrt((GRAPH_BUDGET_MPX * 1e6) / (cssWidth * cssHeight)) * 100) / 100);
}
