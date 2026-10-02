import { describe, expect, test } from 'bun:test';
import { summarizeFrames } from '../src/metrics';
import { cpuBusyPct, parseVmStat, processTreeUsage, type CpuTimes } from '../server/machine';

describe('frame statistics (in the page)', () => {
  test('fps and the worst frame come from the frame deltas of the last window', () => {
    const steady = Array(60).fill(1000 / 60);
    expect(summarizeFrames(steady).fps).toBe(60);
    expect(summarizeFrames(steady).worstMs).toBe(17);

    const stutter = [...Array(30).fill(16.7), 120, ...Array(29).fill(16.7)];
    const s = summarizeFrames(stutter);
    expect(s.fps).toBeLessThan(55);
    expect(s.worstMs).toBe(120);

    expect(summarizeFrames([])).toEqual({ fps: 0, worstMs: 0 });
  });
});

describe('machine statistics (owned browser side)', () => {
  const times = (idle: number, busy: number): CpuTimes => ({ user: busy, nice: 0, sys: 0, irq: 0, idle });

  test('cpu busy is the share of non-idle time between two samples across all cores', () => {
    const before = [times(1000, 1000), times(1000, 1000)];
    const after = [times(1100, 1300), times(1300, 1100)]; // core 0: 300 busy / 400; core 1: 100 / 400
    expect(cpuBusyPct(before, after)).toBe(50);
    expect(cpuBusyPct(before, before)).toBe(0);
  });

  test('vm_stat is read the way Activity Monitor counts memory in use', () => {
    const text = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     5422.
Pages active:                                 126423.
Pages inactive:                               121105.
Pages speculative:                              4726.
Pages throttled:                                   0.
Pages wired down:                            1127750.
Pages purgeable:                                6096.
"Translation faults":                      123456789.
Pages occupied by compressor:                 150000.
`;
    const m = parseVmStat(text);
    expect(m.pageSize).toBe(16384);
    expect(m.usedBytes).toBe((126423 + 1127750 + 150000) * 16384);
  });

  test('process tree usage sums cpu and rss over the browser process and everything under it', () => {
    const ps = `  100     1   0.5  10000 /Applications/Other.app
  200     1   3.0  50000 /chromium --type=browser --user-data-dir=/tmp/artemis-profile
  201   200  12.5  80000 /chromium --type=gpu-process
  202   200   7.0 120000 /chromium --type=renderer
  300   202   1.0   5000 /chromium --type=utility
  400     1  20.0  90000 /chromium --type=browser --user-data-dir=/tmp/someone-else
`;
    const u = processTreeUsage(ps, '/tmp/artemis-profile');
    expect(u.processes).toBe(4);
    expect(u.cpuPct).toBeCloseTo(23.5);
    expect(u.rssBytes).toBe((50000 + 80000 + 120000 + 5000) * 1024);
    expect(processTreeUsage(ps, '/tmp/missing')).toEqual({ processes: 0, cpuPct: 0, rssBytes: 0 });
  });
});
