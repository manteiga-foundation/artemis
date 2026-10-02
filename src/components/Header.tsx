import { Animated, Animator, BleepsOnAnimator, FrameLines, Text } from '@arwes/react';
import { GiSpeaker, GiSpeakerOff } from 'react-icons/gi';
import { useClock, useTelemetry } from '../hooks';
import { setState, useStore } from '../store';
import { useSfx } from '../sfx';
import { VIEW_BY_ID } from '../views';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <Animator>
      <Animated className="stat" title={title} animated={['fade', ['y', -6, 0]]}>
        <Text as="span" className="stat-label" manager="decipher" fixed>
          {label}
        </Text>
        <span className="stat-value">{value}</span>
      </Animated>
    </Animator>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 100;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
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
  const simRunning = useStore((s) => s.simRunning);
  const paused = useStore((s) => s.paused);
  const nodes = useStore((s) => s.nodeCount);
  const links = useStore((s) => s.linkCount);
  const muted = useStore((s) => s.muted);
  const tel = useTelemetry(simRunning);
  const play = useSfx();

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const simLabel = paused ? 'HALTED' : simRunning ? 'ACTIVE' : 'SETTLED';

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
        </div>

        <div className="stats">
          <Stat label="T/S" value={fmt(tel.ts)} title="Throughput per second (placeholder feed)" />
          <Stat label="N/S" value={fmt(tel.ns)} title="Node events per second (placeholder feed)" />
          <Stat label="R/S" value={fmt(tel.rs)} title="Route updates per second (placeholder feed)" />
          <span className="stats-sep" />
          <Stat label="LINKS" value={fmt(links)} />
          <Stat label="NODES" value={fmt(nodes)} />
        </div>

        <div className="wave">
          <Sparkline values={tel.history} />
        </div>

        <div className={`sim-badge ${paused ? 'is-halted' : simRunning ? 'is-active' : ''}`}>
          <span className="dot" /> SIM {simLabel}
        </div>

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
