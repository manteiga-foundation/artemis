// Synthesized console bleeps: short Web Audio gestures generated in code, so Artemis needs no
// licensed sound files. Each preset is a list of steps (oscillator or noise) scheduled together.

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface SynthStep {
  wave: Wave;
  /** Start frequency, Hz (ignored for noise). */
  from: number;
  /** End frequency, Hz; the pitch glides exponentially from `from` to `to`. */
  to?: number;
  /** Offset from the preset start, ms. */
  at?: number;
  /** Length of this step, ms. */
  ms: number;
  /** Peak gain 0..1 relative to the preset. */
  gain?: number;
  /** Lowpass cutoff, Hz (noise and sawtooth benefit). */
  lowpass?: number;
}

export interface SynthPreset {
  id: string;
  label: string;
  description: string;
  /** Total length, ms. */
  durationMs: number;
  /** Overall level 0..1. */
  level: number;
  steps: SynthStep[];
}

export const SYNTH_PRESETS: SynthPreset[] = [
  {
    id: 'tick',
    label: 'Tick',
    description: 'Hover: a dry 25 ms square blip, barely there.',
    durationMs: 30,
    level: 0.35,
    steps: [{ wave: 'square', from: 2200, ms: 25, lowpass: 6000 }]
  },
  {
    id: 'tap',
    label: 'Tap',
    description: 'Click: a soft sine knock falling from 1.4 to 0.9 kHz in 60 ms.',
    durationMs: 70,
    level: 0.6,
    steps: [{ wave: 'sine', from: 1400, to: 900, ms: 60 }]
  },
  {
    id: 'confirm',
    label: 'Confirm',
    description: 'Command accepted: two rising tones, 880 then 1320 Hz, 140 ms in all.',
    durationMs: 150,
    level: 0.5,
    steps: [
      { wave: 'triangle', from: 880, ms: 60 },
      { wave: 'triangle', from: 1320, at: 70, ms: 70 }
    ]
  },
  {
    id: 'deny',
    label: 'Deny',
    description: 'Command refused: a sawtooth falling from 440 to 220 Hz over 180 ms.',
    durationMs: 190,
    level: 0.45,
    steps: [{ wave: 'sawtooth', from: 440, to: 220, ms: 180, lowpass: 1800 }]
  },
  {
    id: 'notice',
    label: 'Notice',
    description: 'Information: a held 660 Hz triangle with a fifth above, 240 ms.',
    durationMs: 250,
    level: 0.45,
    steps: [
      { wave: 'triangle', from: 660, ms: 240 },
      { wave: 'sine', from: 990, at: 40, ms: 180, gain: 0.5 }
    ]
  },
  {
    id: 'pull-back',
    label: 'Pull back',
    description: 'View dive outward: a 500 ms sweep down from 1200 to 300 Hz under a lowpass.',
    durationMs: 520,
    level: 0.5,
    steps: [
      { wave: 'sawtooth', from: 1200, to: 300, ms: 500, lowpass: 1400 },
      { wave: 'noise', from: 0, ms: 300, gain: 0.25, lowpass: 900 }
    ]
  },
  {
    id: 'return',
    label: 'Return',
    description: 'View dive inward: the same sweep rising from 300 to 1200 Hz.',
    durationMs: 520,
    level: 0.5,
    steps: [
      { wave: 'sawtooth', from: 300, to: 1200, ms: 500, lowpass: 1600 },
      { wave: 'noise', from: 0, at: 200, ms: 300, gain: 0.25, lowpass: 1200 }
    ]
  },
  {
    id: 'glyph',
    label: 'Glyph',
    description: 'Text deciphering: a filtered noise tick of 30 ms, for letters appearing.',
    durationMs: 35,
    level: 0.4,
    steps: [{ wave: 'noise', from: 0, ms: 30, lowpass: 3200 }]
  },
  {
    id: 'engage',
    label: 'Engage',
    description: 'Console start: a three-note rising arpeggio, 440 / 660 / 880 Hz, 420 ms.',
    durationMs: 430,
    level: 0.55,
    steps: [
      { wave: 'triangle', from: 440, ms: 140 },
      { wave: 'triangle', from: 660, at: 120, ms: 140 },
      { wave: 'triangle', from: 880, at: 240, ms: 180 }
    ]
  },
  {
    id: 'alert',
    label: 'Alert',
    description: 'Warning: two 1 kHz square pulses, 80 ms each.',
    durationMs: 260,
    level: 0.4,
    steps: [
      { wave: 'square', from: 1000, ms: 80, lowpass: 4000 },
      { wave: 'square', from: 1000, at: 170, ms: 80, lowpass: 4000 }
    ]
  },
  {
    id: 'toggle-on',
    label: 'Toggle on',
    description: 'Something switched on: a short sine step up, 600 to 900 Hz.',
    durationMs: 90,
    level: 0.5,
    steps: [{ wave: 'sine', from: 600, to: 900, ms: 80 }]
  },
  {
    id: 'toggle-off',
    label: 'Toggle off',
    description: 'Something switched off: the same step down, 900 to 600 Hz.',
    durationMs: 90,
    level: 0.5,
    steps: [{ wave: 'sine', from: 900, to: 600, ms: 80 }]
  },
  {
    id: 'scan',
    label: 'Scan',
    description: 'Focus or search: eight quick ascending sine blips over 320 ms.',
    durationMs: 330,
    level: 0.4,
    steps: Array.from({ length: 8 }, (_, i) => ({ wave: 'sine' as Wave, from: 700 + i * 110, at: i * 40, ms: 30 }))
  }
];

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = b;
  return b;
}

/** Schedule a preset on an audio context, starting now. `level` scales the preset's own level. */
export function playSynth(ctx: BaseAudioContext, preset: SynthPreset, level = 1): void {
  const t0 = ctx.currentTime + 0.01;
  for (const s of preset.steps) {
    const start = t0 + (s.at ?? 0) / 1000;
    const end = start + s.ms / 1000;
    const gain = ctx.createGain();
    const peak = preset.level * level * (s.gain ?? 1);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + Math.min(0.008, s.ms / 4000));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    let node: AudioScheduledSourceNode;
    if (s.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noise(ctx);
      node = src;
    } else {
      const osc = ctx.createOscillator();
      osc.type = s.wave;
      osc.frequency.setValueAtTime(s.from, start);
      if (s.to && s.to !== s.from) osc.frequency.exponentialRampToValueAtTime(s.to, end);
      node = osc;
    }

    let chain: AudioNode = node;
    if (s.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = s.lowpass;
      chain.connect(f);
      chain = f;
    }
    chain.connect(gain).connect(ctx.destination);
    node.start(start);
    node.stop(end + 0.02);
  }
}
