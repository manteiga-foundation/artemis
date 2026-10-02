import { describe, expect, test } from 'bun:test';
import { GRAPH_BUDGET_MPX, graphPixelRatio } from '../src/quality';

describe('graph pixel ratio', () => {
  test('ordinary stages render at the device pixel ratio: nothing is traded away', () => {
    expect(graphPixelRatio(1440, 900, 2, '')).toBe(2);
    expect(graphPixelRatio(1728, 1117, 2, '')).toBe(2); // 16" laptop, full screen
    expect(graphPixelRatio(2560, 1440, 2, '')).toBe(2); // large external display
    expect(graphPixelRatio(1920, 1080, 1, '')).toBe(1);
  });

  test('beyond the budget the ratio comes down just enough, never below 1', () => {
    const r = graphPixelRatio(5120, 2880, 2, ''); // 5K at 2x = 29.5 Mpx
    expect(r).toBeLessThan(2);
    expect((5120 * 2880 * r * r) / 1e6).toBeCloseTo(GRAPH_BUDGET_MPX, 0);
    expect(graphPixelRatio(8000, 8000, 1, '')).toBe(1);
  });

  test('?gpr= forces a value for measurement and comparison', () => {
    expect(graphPixelRatio(1440, 900, 2, '?gpr=1')).toBe(1);
    expect(graphPixelRatio(1440, 900, 2, '?owned=1&gpr=1.5')).toBe(1.5);
    expect(graphPixelRatio(1440, 900, 2, '?gpr=0')).toBe(2);
  });
});
