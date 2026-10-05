import { describe, expect, test } from 'bun:test';
import { DONE_MS, loadProgress, loadStep, type PageLoad } from '../src/page-load';

// The address field doubles as a soft progress bar while a page loads. Browsers do not know a
// real percentage either: the bar eases toward each phase's cap and jumps on the next signal.
describe('page loading progress', () => {
  test('nothing loading shows no bar', () => {
    expect(loadProgress(null, 1000)).toBeNull();
  });

  test('a load starts low and creeps, never reaching what the document commit will bring', () => {
    const l = loadStep(null, 'start', 0);
    const at = (t: number) => loadProgress(l, t)!;
    expect(at(0)).toBeGreaterThan(0);
    expect(at(0)).toBeLessThan(0.15);
    expect(at(1000)).toBeGreaterThan(at(0));
    expect(at(60_000)).toBeLessThan(0.5);
    for (let t = 0; t < 10_000; t += 250) expect(at(t + 250)).toBeGreaterThanOrEqual(at(t));
  });

  test('each later phase raises it, from where it was, and it never goes back', () => {
    let l = loadStep(null, 'start', 0);
    const beforeCommit = loadProgress(l, 3000)!;
    l = loadStep(l, 'commit', 3000);
    expect(loadProgress(l, 3000)!).toBeGreaterThanOrEqual(beforeCommit);
    expect(loadProgress(l, 3500)!).toBeGreaterThan(0.35);
    l = loadStep(l, 'dom', 4000);
    expect(loadProgress(l, 4000)!).toBeGreaterThanOrEqual(0.7);
    expect(loadProgress(l, 60_000)!).toBeLessThan(1);
    // A signal that would go backwards (a commit after the DOM is ready) changes nothing.
    expect(loadStep(l, 'commit', 4100)).toBe(l);
  });

  test('done fills the field, holds it for a moment, then the bar is gone', () => {
    let l = loadStep(null, 'start', 0);
    l = loadStep(l, 'done', 800);
    expect(loadProgress(l, 800)).toBe(1);
    expect(loadProgress(l, 800 + DONE_MS - 1)).toBe(1);
    expect(loadProgress(l, 800 + DONE_MS)).toBeNull();
  });

  test('a failed load ends like a finished one', () => {
    const l = loadStep(loadStep(null, 'start', 0), 'fail', 500);
    expect(loadProgress(l, 500)).toBe(1);
    expect(loadProgress(l, 500 + DONE_MS)).toBeNull();
  });

  test('late signals of a finished load, or signals with no load started, change nothing', () => {
    const done = loadStep(loadStep(null, 'start', 0), 'done', 500) as PageLoad;
    for (const e of ['commit', 'dom', 'done', 'fail'] as const) expect(loadStep(done, e, 600)).toBe(done);
    for (const e of ['commit', 'dom', 'done', 'fail'] as const) expect(loadStep(null, e, 600)).toBeNull();
  });

  test('a new page starts the bar again from the bottom, even halfway through a load', () => {
    let l = loadStep(loadStep(null, 'start', 0), 'dom', 1000);
    l = loadStep(l, 'start', 1200);
    expect(loadProgress(l, 1200)!).toBeLessThan(0.15);
  });
});
