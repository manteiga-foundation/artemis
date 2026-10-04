import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getState, setState } from '../src/store';
import { attach, controller, installFakeWindow, restoreWindow } from './harness';
import { commandByKey, commandsFor } from '../src/commands';
import type { SiteEvent } from '../src/site-events';

// In the owned browser the cosmos is the recording, growing live: no emulated network.

const initialState = getState();
const S = 'http://shop.example';
const recording: SiteEvent[] = [
  { type: 'session', target: `${S}/`, scopeHost: 'shop.example' },
  { type: 'visit', id: 1, t: 1, url: `${S}/`, kind: 'document', committed: true },
  { type: 'request', id: 10, visitId: 1, method: 'GET', url: `${S}/api/config`, resourceType: 'fetch', mainDocument: false },
  { type: 'request', id: 11, visitId: 1, method: 'GET', url: 'https://maps.googleapis.com/js', resourceType: 'script', mainDocument: false },
  { type: 'visit', id: 2, t: 2, url: `${S}/contact`, kind: 'document', committed: true },
  { type: 'request', id: 12, visitId: 2, method: 'GET', url: `${S}/api/map`, resourceType: 'fetch', mainDocument: false }
];
const ids = () => controller.data.meta.map((m) => m.id);

beforeEach(() => {
  installFakeWindow();
  controller.main = null;
  controller.mini = null;
  setState({ ...initialState, engaged: true });
});

afterEach(() => {
  setState(initialState);
  controller.useEmulated();
  controller.main = null;
  controller.mini = null;
  setState(initialState);
  restoreWindow();
});

describe('the recorded cosmos', () => {
  test('the first recording events replace the emulated network with the recorded site', () => {
    attach();
    expect(controller.data.count).toBeGreaterThan(1000);
    controller.applySiteEvents(recording);
    expect(ids()).toEqual(['/', 'GET /api/config', 'maps.googleapis.com', '/contact', 'GET /api/map']);
    expect(getState()).toMatchObject({ recorded: true, nodeCount: 5, linkCount: 4 });
    expect(controller.data.meta[getState().currentPage].id).toBe('/contact');
  });

  test('it grows as events arrive, keeping every node it had', () => {
    attach();
    controller.applySiteEvents(recording.slice(0, 2));
    expect(ids()).toEqual(['/']);
    const version = getState().graphVersion;
    controller.applySiteEvents(recording.slice(2));
    expect(ids().slice(0, 1)).toEqual(['/']);
    expect(getState().nodeCount).toBe(5);
    expect(getState().graphVersion).toBeGreaterThan(version);
  });

  test('pulling back from the browser lands on the current page of the recording', () => {
    const { main } = attach();
    controller.applySiteEvents(recording);
    setState({ view: 'browser', stageView: 'browser' });
    controller.cycleView();
    const page = getState().currentPage;
    expect(controller.data.meta[page].id).toBe('/contact');
    expect(getState().selected).toBe(page);
    expect(main.zoomed.at(-1)).toBe(page);
    expect(getState().status).toBe('View: Cosmos. Current page /contact selected.');
  });

  test('with nothing recorded yet, the pull-back shows the (empty) cosmos and says so', () => {
    const { main } = attach();
    controller.applySiteEvents([{ type: 'reset' }]);
    expect(getState().nodeCount).toBe(0);
    setState({ view: 'browser', stageView: 'browser' });
    controller.cycleView();
    expect(main.zoomed).toEqual([]);
    expect(getState().status).toBe('View: Cosmos. Nothing recorded yet.');
  });

  test('Scope hides what lies outside the review host and shows it again; the selection stays on its node', () => {
    attach();
    controller.applySiteEvents(recording);
    setState({ view: 'cosmos', stageView: 'cosmos', selected: 3 });
    const scope = commandByKey('cosmos', 'E', true)!;
    expect(scope.name).toBe('Scope');
    const r = scope.run();
    expect(r.message).toBe('Scope: only shop.example and its subdomains.');
    expect(ids()).toEqual(['/', 'GET /api/config', '/contact', 'GET /api/map']);
    expect(scope.isActive!(getState())).toBe(true);
    expect(controller.data.meta[getState().selected!].id).toBe('/contact');
    scope.run();
    expect(getState().nodeCount).toBe(5);
    expect(controller.data.meta[getState().selected!].id).toBe('/contact');
  });

  test('the recorded cosmos offers Scope where the emulated one had Regenerate, and Regenerate refuses', () => {
    attach();
    const names = (recorded: boolean) => commandsFor('cosmos', recorded).map((c) => c.name);
    expect(names(false)).toContain('Regenerate');
    expect(names(true)).not.toContain('Regenerate');
    expect(commandsFor('cosmos', true)[7].key).toBe('E');
    controller.applySiteEvents(recording);
    const r = controller.regenerate();
    expect(r.ok).toBe(false);
    expect(getState().nodeCount).toBe(5);
  });

  test('a recorded site has a handful of nodes: it gets room (long links, gentle gravity); the emulated network keeps its tuning', () => {
    const { main } = attach();
    controller.applySiteEvents(recording);
    expect(main.config).toMatchObject({ simulationLinkDistance: 45, simulationGravity: 0, simulationCluster: 0 });
    controller.useEmulated();
    expect(main.config).toMatchObject({ simulationLinkDistance: 9, simulationGravity: 0.22, simulationCluster: 0.22 });
  });

  test('the core and every page hold their cells; Hold pins on top of them, Clear releases only the holds', () => {
    const { main } = attach();
    controller.applySiteEvents(recording);
    const pagesAt = ids().flatMap((id, i) => (id.startsWith('/') ? [i] : []));
    expect(main.pinned!.slice().sort()).toEqual(pagesAt);
    setState({ view: 'cosmos', stageView: 'cosmos', selected: 1 });
    controller.hold();
    expect(main.pinned!.slice().sort()).toEqual([...pagesAt, 1].sort());
    controller.clear();
    expect(main.pinned!.slice().sort()).toEqual(pagesAt);
    // Growth keeps the structure pinned, new pages included.
    controller.applySiteEvents([{ type: 'visit', id: 9, t: 9, url: `${S}/thanks`, kind: 'document', committed: true }]);
    expect(main.pinned).toContain(ids().indexOf('/thanks'));
  });

  test('framing the whole recorded site leaves room for the page labels; the emulated cosmos keeps its framing', () => {
    const { main } = attach();
    controller.vision();
    expect(main.fitPadding).toBe(0.18);
    controller.applySiteEvents(recording);
    controller.vision();
    expect(main.fitPadding).toBeGreaterThanOrEqual(0.3);
  });

  test('the core is a hexagon, in the recorded cosmos and the emulated one', () => {
    const { main } = attach();
    const HEXAGON = 5;
    const shapesOf = () => [...main.shapes].map((s, i) => [i === controller.data.core, s]);
    controller.regenerate(); // loads the emulated network into the graph
    expect(main.shapes[controller.data.core]).toBe(HEXAGON);
    expect(shapesOf().filter(([core, s]) => !core && s !== 0)).toEqual([]);
    controller.applySiteEvents(recording);
    expect([...main.shapes]).toEqual([HEXAGON, 0, 0, 0, 0]);
  });

  test('an empty recording never asks the graph for positions or a whole-graph fit (cosmos.gl cannot measure zero points)', () => {
    const { main } = attach();
    controller.applySiteEvents([{ type: 'reset' }]);
    const refuse = () => {
      throw new Error('read from an empty graph');
    };
    main.getPointPositions = refuse;
    main.fitView = refuse;
    (main as unknown as Record<string, unknown>).getTrackedPointPositionsMap = refuse;
    expect(() => {
      controller.fitAll(900, 0.16);
      controller.syncMini(true);
      controller.hubScreenPositions();
      setState({ view: 'browser', stageView: 'browser' });
      controller.cycleView();
      controller.layoutStarted();
      for (let i = 0; i < 300; i++) controller.layoutTick();
      controller.layoutSettled();
      // The first nodes arrive into the empty graph: nothing to carry over, nothing to read.
      controller.applySiteEvents(recording.slice(0, 2));
    }).not.toThrow();
    expect(getState().nodeCount).toBe(1);
  });

  test('the first recorded nodes are framed as their layout unfolds; once the operator aims, growth leaves the camera alone', () => {
    const { main } = attach();
    controller.applySiteEvents(recording.slice(0, 2));
    controller.layoutStarted();
    for (let i = 0; i < 300; i++) controller.layoutTick();
    expect(main.fits).toBe(2);
    setState({ view: 'browser', stageView: 'browser' });
    controller.cycleView();
    controller.applySiteEvents(recording.slice(2));
    controller.layoutStarted();
    for (let i = 0; i < 300; i++) controller.layoutTick();
    controller.layoutSettled();
    expect(main.fits).toBe(2);
  });
});
