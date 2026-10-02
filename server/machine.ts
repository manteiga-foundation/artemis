// Machine-side resource figures for the owned browser (Bun). Pure parsers are exported for tests;
// `startMachineFeed` samples every couple of seconds and pushes a MachineStats into the console.
import os from 'node:os';
import type { Page } from 'playwright';
import { MACHINE_EVENT, type MachineStats } from '../src/machine-stats';

export type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number };

/** Share of non-idle CPU time between two `os.cpus()` samples, all cores, percent. */
export function cpuBusyPct(before: CpuTimes[], after: CpuTimes[]): number {
  let idle = 0;
  let total = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const b = before[i];
    const a = after[i];
    const dIdle = a.idle - b.idle;
    const dTotal = a.user - b.user + (a.nice - b.nice) + (a.sys - b.sys) + (a.irq - b.irq) + dIdle;
    idle += dIdle;
    total += dTotal;
  }
  if (total <= 0) return 0;
  return Math.round(((total - idle) / total) * 100);
}

/** macOS `vm_stat`: memory in use the way Activity Monitor counts it (active + wired + compressed). */
export function parseVmStat(text: string): { pageSize: number; usedBytes: number } {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 4096);
  const pages = (label: string) => Number(new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1] ?? 0);
  const used = pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor');
  return { pageSize, usedBytes: used * pageSize };
}

/**
 * From `ps -axo pid=,ppid=,%cpu=,rss=,command=` output: the browser process launched with the given
 * profile directory and every process beneath it (GPU, renderers, utilities). rss is in KiB.
 */
export function processTreeUsage(psText: string, userDataDir: string): { processes: number; cpuPct: number; rssBytes: number } {
  type Row = { pid: number; ppid: number; cpu: number; rss: number; cmd: string };
  const rows: Row[] = [];
  for (const line of psText.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rss: Number(m[4]), cmd: m[5] });
  }
  const marker = `--user-data-dir=${userDataDir}`;
  const tree = new Set(rows.filter((r) => r.cmd.includes(marker)).map((r) => r.pid));
  if (tree.size === 0) return { processes: 0, cpuPct: 0, rssBytes: 0 };
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (!tree.has(r.pid) && tree.has(r.ppid)) {
        tree.add(r.pid);
        grew = true;
      }
    }
  }
  let cpu = 0;
  let rss = 0;
  for (const r of rows) {
    if (tree.has(r.pid)) {
      cpu += r.cpu;
      rss += r.rss;
    }
  }
  return { processes: tree.size, cpuPct: Math.round(cpu * 10) / 10, rssBytes: rss * 1024 };
}

const cpuTimes = (): CpuTimes[] => os.cpus().map((c) => c.times);

async function run(cmd: string[]): Promise<string> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out;
  } catch {
    return '';
  }
}

async function memoryInUse(): Promise<number> {
  if (process.platform === 'darwin') {
    const text = await run(['vm_stat']);
    if (text) return parseVmStat(text).usedBytes;
  }
  return os.totalmem() - os.freemem();
}

/** One sample; `prev` is the previous CPU-times snapshot (pass the one returned last time). */
export async function sampleMachine(prev: CpuTimes[], userDataDir: string): Promise<{ stats: MachineStats; cpu: CpuTimes[] }> {
  const cpu = cpuTimes();
  const [used, ps] = await Promise.all([memoryInUse(), run(['ps', '-axo', 'pid=,ppid=,%cpu=,rss=,command='])]);
  const tree = processTreeUsage(ps, userDataDir);
  const total = os.totalmem();
  const gb = (b: number) => Math.round((b / 1073741824) * 10) / 10;
  return {
    cpu,
    stats: {
      cpuPct: cpuBusyPct(prev, cpu),
      memUsedPct: Math.round((used / total) * 100),
      memUsedGB: gb(used),
      memTotalGB: gb(total),
      artemisCpuPct: Math.round(tree.cpuPct / Math.max(1, cpu.length)),
      artemisMemMB: Math.round(tree.rssBytes / 1048576),
      artemisProcesses: tree.processes,
      cores: cpu.length,
      at: Date.now()
    }
  };
}

/** Push machine stats into the console page every `intervalMs`. Returns a stop function. */
export function startMachineFeed(page: Page, userDataDir: string, intervalMs = 2000): () => void {
  let prev = cpuTimes();
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      await Bun.sleep(intervalMs);
      if (stopped) break;
      try {
        const { stats, cpu } = await sampleMachine(prev, userDataDir);
        prev = cpu;
        await page.evaluate(`window.dispatchEvent(new CustomEvent(${JSON.stringify(MACHINE_EVENT)}, { detail: ${JSON.stringify(stats)} }))`);
      } catch {
        // Page navigating or closed: try again next round.
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
