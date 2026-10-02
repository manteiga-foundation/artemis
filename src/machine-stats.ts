// Contract between the owned browser's Bun side (server/machine.ts) and the console page
// (src/metrics.ts). Kept free of DOM and Bun types so both sides can import it.

export interface MachineStats {
  /** Machine CPU busy over the sampling interval, all cores, percent. */
  cpuPct: number;
  /** Machine memory in use (active + wired + compressed on macOS), percent and GB. */
  memUsedPct: number;
  memUsedGB: number;
  memTotalGB: number;
  /** CPU of Artemis' own browser process tree as a share of the whole machine (comparable with cpuPct), and its resident memory. */
  artemisCpuPct: number;
  artemisMemMB: number;
  artemisProcesses: number;
  /** Logical cores, for context. */
  cores: number;
  /** Sample time (ms since epoch). */
  at: number;
}

/** Window event the owned browser dispatches with a MachineStats detail. */
export const MACHINE_EVENT = 'artemis:machine';
