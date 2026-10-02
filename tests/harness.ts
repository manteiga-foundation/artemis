// Shared test harness: import the real controller without a WebGL renderer, and fake only the
// GPU boundary. Data model and controller behaviour stay real.
import type { Graph } from '@cosmos.gl/graph';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
export const fakeWindow = { setInterval: () => 1, setTimeout: () => 1, clearTimeout: () => undefined };
export const installFakeWindow = () => Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
export const restoreWindow = () => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
};

installFakeWindow();
export const { controller } = await import('../src/graph/controller').finally(restoreWindow);

export class Renderer {
  config: Record<string, unknown> = {};
  renders = 0;
  fits = 0;
  zoomed: number[] = [];
  tracked: number[] = [];
  colors: Float32Array<ArrayBufferLike> = new Float32Array();
  linkColors: Float32Array<ArrayBufferLike> = new Float32Array();
  setPointPositions() {}
  setLinks() {}
  setPointColors(c: Float32Array) { this.colors = c; }
  setLinkColors(c: Float32Array) { this.linkColors = c; }
  setPointSizes() {}
  setLinkWidths() {}
  setPointClusters() {}
  setClusterPositions() {}
  setPinnedPoints() {}
  trackPointPositionsByIndices(t: number[]) { this.tracked = t; }
  setConfigPartial(c: Record<string, unknown>) { this.config = { ...this.config, ...c }; }
  getNeighboringPointIndices(index: number) {
    const { links } = controller.data;
    const out: number[] = [];
    for (let l = 0; l < links.length; l += 2) {
      if (links[l] === index) out.push(links[l + 1]);
      else if (links[l + 1] === index) out.push(links[l]);
    }
    return out;
  }
  render() { this.renders++; }
  start() {}
  fitView() { this.fits++; }
  getZoomLevel() { return 1; }
  zoomToPointByIndex(i: number) { this.zoomed.push(i); }
}

export const attach = () => {
  const main = new Renderer();
  const mini = new Renderer();
  controller.main = main as unknown as Graph;
  controller.mini = mini as unknown as Graph;
  return { main, mini };
};
