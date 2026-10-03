import { Animated, Animator, BleepsOnAnimator, FrameLines, Text } from '@arwes/react';
import { GiSpeaker, GiSpeakerOff } from 'react-icons/gi';
import { useClock } from '../hooks';
import { setState, useStore } from '../store';
import { useSfx } from '../sfx';
import { hostOf } from '../target';
import { VIEW_BY_ID } from '../views';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function Stat({ label, value, title, className, warn }: { label: string; value: string; title?: string; className?: string; warn?: boolean }) {
  return (
    <Animator>
      <Animated className={`stat${className ? ` ${className}` : ''}${warn ? ' is-warn' : ''}`} title={title} animated={['fade', ['y', -6, 0]]}>
        <Text as="span" className="stat-label" manager="decipher" fixed>
          {label}
        </Text>
        <span className="stat-value">{value}</span>
      </Animated>
    </Animator>
  );
}

function Sparkline({ values, floor }: { values: number[]; floor?: number }) {
  const w = 100;
  const h = 24;
  const max = Math.max(...values);
  const min = floor ?? Math.min(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <path d="M16 2 L28 9 V23 L16 30 L4 23 V9 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 2 V16 M16 16 L28 9 M16 16 L4 9 M16 16 V30" stroke="currentColor" strokeWidth="0.8" opacity="0.55" />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

export function Header() {
  const now = useClock();
  const view = useStore((s) => s.stageView);
  const targetUrl = useStore((s) => s.targetUrl);
  const simRunning = useStore((s) => s.simRunning);
  const paused = useStore((s) => s.paused);
  const nodes = useStore((s) => s.nodeCount);
  const links = useStore((s) => s.linkCount);
  const muted = useStore((s) => s.muted);
  const panelsHidden = useStore((s) => s.panelsHidden);
  const perf = useStore((s) => s.perf);
  const machine = useStore((s) => s.machine);
  const play = useSfx();

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const simLabel = paused ? 'HALTED' : simRunning ? 'ACTIVE' : 'SETTLED';

  // Resource readouts. FPS and heap come from the page itself; CPU and MEM need the owned browser.
  const pct = (n: number) => `${Math.round(n)}%`;
  const fpsTitle = perf
    ? `Frames per second Artemis renders (1 s window). Worst frame ${perf.worstMs} ms. Main thread busy ${perf.busyPct}%.`
    : 'Frames per second Artemis renders.';
  const machineOnly = 'Available in the owned browser (bun run artemis).';
  const cpuTitle = machine
    ? `Machine CPU busy over the last 2 s, all ${machine.cores} cores. High here with a low ARTEMIS figure means the machine is the bottleneck.`
    : `Machine CPU. ${machineOnly}`;
  const artTitle = machine
    ? `Share of the machine's CPU used by Artemis' own browser processes (${machine.artemisProcesses} processes, decaying average), ${machine.artemisMemMB} MB resident. Compare with CPU: the rest is other software.`
    : `CPU used by Artemis' own browser processes. ${machineOnly}`;
  const memTitle = machine
    ? `Machine memory in use: ${machine.memUsedGB} of ${machine.memTotalGB} GB.${perf?.heapMB != null ? ` Artemis JS heap ${perf.heapMB} MB.` : ''}`
    : `Machine memory in use. ${machineOnly}${perf?.heapMB != null ? ` Artemis JS heap ${perf.heapMB} MB.` : ''}`;

  return (
    <Animator combine manager="stagger">
      <BleepsOnAnimator transitions={{ entering: 'type' }} />
      <header className="hud-header">
        <Animator>
          <FrameLines className="frame header-frame" largeLineWidth={1} smallLineWidth={2} smallLineLength={24} />
        </Animator>
        <div className="brand">
          <Logo />
          <Animator>
            <Text as="span" className="brand-name" manager="decipher" fixed>
              ARTEMIS
            </Text>
          </Animator>
          <Animator>
            <Text as="span" className="view-badge" manager="decipher" fixed title={VIEW_BY_ID.get(view)!.tagline}>
              {VIEW_BY_ID.get(view)!.label.toUpperCase()}
            </Text>
          </Animator>
          {targetUrl && (
            <Animator>
              <Animated as="span" className="brand-host" title={targetUrl} animated={['fade']}>
                {hostOf(targetUrl)}
              </Animated>
            </Animator>
          )}
        </div>

        <div className="stats">
          <Stat className="stat-fps" label="FPS" value={perf ? String(perf.fps) : '--'} title={fpsTitle} warn={!!perf && perf.fps > 0 && perf.fps < 30} />
          <Stat className="stat-cpu" label="CPU" value={machine ? pct(machine.cpuPct) : '--'} title={cpuTitle} warn={!!machine && machine.cpuPct >= 85} />
          <Stat className="stat-artemis" label="ARTEMIS" value={machine ? pct(machine.artemisCpuPct) : '--'} title={artTitle} />
          <Stat className="stat-mem" label="MEM" value={machine ? pct(machine.memUsedPct) : '--'} title={memTitle} warn={!!machine && machine.memUsedPct >= 90} />
          <span className="stats-sep" />
          <Stat label="LINKS" value={fmt(links)} />
          <Stat label="NODES" value={fmt(nodes)} />
        </div>

        <div className="wave" title="Frame rate, last 60 s">
          <Sparkline values={perf && perf.history.length > 1 ? perf.history : [0, 0]} floor={0} />
        </div>

        <div className={`sim-badge ${paused ? 'is-halted' : simRunning ? 'is-active' : ''}`}>
          <span className="dot" /> SIM {simLabel}
        </div>

        <button
          className={`panel-toggle${panelsHidden ? ' is-off' : ''}`}
          aria-label="Panels (C)"
          aria-pressed={!panelsHidden}
          title={panelsHidden ? 'Show the panels (C)' : 'Hide the panels (C)'}
          onClick={() => {
            setState({ panelsHidden: !panelsHidden });
            play(panelsHidden ? 'panels-open' : 'panels-close');
          }}
        >
          <span className="dot" /> PANELS {panelsHidden ? 'OFF' : 'ON'}
        </button>

        <button
          className={`icon-btn ${muted ? 'is-off' : ''}`}
          title={muted ? 'Unmute (M)' : 'Mute (M)'}
          onClick={() => {
            setState({ muted: !muted });
            if (muted) window.setTimeout(() => play('click'), 80);
          }}
        >
          {muted ? <GiSpeakerOff /> : <GiSpeaker />}
        </button>

        <div className="clock" aria-label="local time">
          {hh}
          <span className="blink">:</span>
          {mm}
        </div>
      </header>
    </Animator>
  );
}
