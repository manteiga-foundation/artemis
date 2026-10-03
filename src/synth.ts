// Synthesized console bleeps: short Web Audio gestures generated in code, so Artemis needs no
// licensed sound files. Each preset is a list of steps (oscillator or noise) scheduled together.
//
// Two families. `bright` is the first set: square and sawtooth, instant attacks, the classic
// arcade console. `soft` is the StarCraft-spirit set the user asked for: sine and triangle only,
// everything low-passed under about 3 kHz, a few milliseconds of attack on every step, shaped noise
// for the hiss of a panel sliding, long gentle sweeps for the view dive. Gentle by construction;
// the tests hold the family to those rules.

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';
export type SynthGroup = 'bright' | 'soft';

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
  /** Rise time to the peak, ms (default 2: effectively instant). */
  attackMs?: number;
  /** Lowpass cutoff, Hz; `lowpassTo` sweeps it over the step. */
  lowpass?: number;
  lowpassTo?: number;
  /** Bandpass (centre Hz, sweeping `from` -> `to`, with resonance `q`); shapes noise into a hiss. */
  bandpass?: { from: number; to?: number; q?: number };
  /** Amplitude tremolo, Hz (a slow wobble on held tones). */
  tremoloHz?: number;
}

export interface SynthPreset {
  id: string;
  label: string;
  group: SynthGroup;
  description: string;
  /** Total length, ms. */
  durationMs: number;
  /** Overall level 0..1. */
  level: number;
  steps: SynthStep[];
}

const bright = (p: Omit<SynthPreset, 'group'>): SynthPreset => ({ ...p, group: 'bright' });
const soft = (p: Omit<SynthPreset, 'group'>): SynthPreset => ({ ...p, group: 'soft' });

export const SYNTH_PRESETS: SynthPreset[] = [
  // ------------------------------------------------------------------ bright (first set)
  bright({
    id: 'tick',
    label: 'Tick',
    description: 'Hover: a dry 25 ms square blip, barely there.',
    durationMs: 30,
    level: 0.35,
    steps: [{ wave: 'square', from: 2200, ms: 25, lowpass: 6000 }]
  }),
  bright({
    id: 'tap',
    label: 'Tap',
    description: 'Click: a soft sine knock falling from 1.4 to 0.9 kHz in 60 ms.',
    durationMs: 70,
    level: 0.6,
    steps: [{ wave: 'sine', from: 1400, to: 900, ms: 60 }]
  }),
  bright({
    id: 'confirm',
    label: 'Confirm',
    description: 'Command accepted: two rising tones, 880 then 1320 Hz, 140 ms in all.',
    durationMs: 150,
    level: 0.5,
    steps: [
      { wave: 'triangle', from: 880, ms: 60 },
      { wave: 'triangle', from: 1320, at: 70, ms: 70 }
    ]
  }),
  bright({
    id: 'deny',
    label: 'Deny',
    description: 'Command refused: a sawtooth falling from 440 to 220 Hz over 180 ms.',
    durationMs: 190,
    level: 0.45,
    steps: [{ wave: 'sawtooth', from: 440, to: 220, ms: 180, lowpass: 1800 }]
  }),
  bright({
    id: 'notice',
    label: 'Notice',
    description: 'Information: a held 660 Hz triangle with a fifth above, 240 ms.',
    durationMs: 250,
    level: 0.45,
    steps: [
      { wave: 'triangle', from: 660, ms: 240 },
      { wave: 'sine', from: 990, at: 40, ms: 180, gain: 0.5 }
    ]
  }),
  bright({
    id: 'pull-back',
    label: 'Pull back',
    description: 'View dive outward: a 500 ms sweep down from 1200 to 300 Hz under a lowpass.',
    durationMs: 520,
    level: 0.5,
    steps: [
      { wave: 'sawtooth', from: 1200, to: 300, ms: 500, lowpass: 1400 },
      { wave: 'noise', from: 0, ms: 300, gain: 0.25, lowpass: 900 }
    ]
  }),
  bright({
    id: 'return',
    label: 'Return',
    description: 'View dive inward: the same sweep rising from 300 to 1200 Hz.',
    durationMs: 520,
    level: 0.5,
    steps: [
      { wave: 'sawtooth', from: 300, to: 1200, ms: 500, lowpass: 1600 },
      { wave: 'noise', from: 0, at: 200, ms: 300, gain: 0.25, lowpass: 1200 }
    ]
  }),
  bright({
    id: 'glyph',
    label: 'Glyph',
    description: 'Text deciphering: a filtered noise tick of 30 ms, for letters appearing.',
    durationMs: 35,
    level: 0.4,
    steps: [{ wave: 'noise', from: 0, ms: 30, lowpass: 3200 }]
  }),
  bright({
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
  }),
  bright({
    id: 'alert',
    label: 'Alert',
    description: 'Warning: two 1 kHz square pulses, 80 ms each.',
    durationMs: 260,
    level: 0.4,
    steps: [
      { wave: 'square', from: 1000, ms: 80, lowpass: 4000 },
      { wave: 'square', from: 1000, at: 170, ms: 80, lowpass: 4000 }
    ]
  }),
  bright({
    id: 'toggle-on',
    label: 'Toggle on',
    description: 'Something switched on: a short sine step up, 600 to 900 Hz.',
    durationMs: 90,
    level: 0.5,
    steps: [{ wave: 'sine', from: 600, to: 900, ms: 80 }]
  }),
  bright({
    id: 'toggle-off',
    label: 'Toggle off',
    description: 'Something switched off: the same step down, 900 to 600 Hz.',
    durationMs: 90,
    level: 0.5,
    steps: [{ wave: 'sine', from: 900, to: 600, ms: 80 }]
  }),
  bright({
    id: 'scan',
    label: 'Scan',
    description: 'Focus or search: eight quick ascending sine blips over 320 ms.',
    durationMs: 330,
    level: 0.4,
    steps: Array.from({ length: 8 }, (_, i) => ({ wave: 'sine' as Wave, from: 700 + i * 110, at: i * 40, ms: 30 }))
  }),

  // ------------------------------------------------------------------ soft (StarCraft spirit)
  soft({
    id: 'soft-hover',
    label: 'Soft hover',
    description: 'Hover: a muted 1 kHz sine blip, 8 ms attack, 45 ms, low-passed at 1.8 kHz. Felt more than heard.',
    durationMs: 50,
    level: 0.22,
    steps: [{ wave: 'sine', from: 1050, to: 980, ms: 45, attackMs: 8, lowpass: 1800 }]
  }),
  soft({
    id: 'soft-click',
    label: 'Soft click',
    description: 'Button press: a woody thunk, sine 420 to 300 Hz over 90 ms with a 20 ms dull noise tap for the contact.',
    durationMs: 100,
    level: 0.45,
    steps: [
      { wave: 'sine', from: 420, to: 300, ms: 90, attackMs: 4, lowpass: 1400 },
      { wave: 'noise', from: 0, ms: 20, gain: 0.35, attackMs: 4, lowpass: 1200 }
    ]
  }),
  soft({
    id: 'glass-click',
    label: 'Glass click',
    description: 'Button press, brighter: a glassy triangle 1500 to 1250 Hz with a sine body at 750 Hz, 70 ms, low-passed at 2.8 kHz.',
    durationMs: 80,
    level: 0.35,
    steps: [
      { wave: 'triangle', from: 1500, to: 1250, ms: 70, attackMs: 5, lowpass: 2800 },
      { wave: 'sine', from: 750, ms: 60, gain: 0.6, attackMs: 5, lowpass: 1600 }
    ]
  }),
  soft({
    id: 'soft-confirm',
    label: 'Soft confirm',
    description: 'Command accepted: two mellow sine tones, 520 then 780 Hz, 70 ms each with 6 ms attacks.',
    durationMs: 170,
    level: 0.4,
    steps: [
      { wave: 'sine', from: 520, ms: 70, attackMs: 6, lowpass: 2400 },
      { wave: 'sine', from: 780, at: 85, ms: 80, attackMs: 6, lowpass: 2400 }
    ]
  }),
  soft({
    id: 'soft-deny',
    label: 'Soft deny',
    description: 'Command refused: a muted triangle 330 to 250 Hz over 200 ms with a 110 Hz sine underneath; a low "no", not a buzz.',
    durationMs: 210,
    level: 0.4,
    steps: [
      { wave: 'triangle', from: 330, to: 250, ms: 200, attackMs: 8, lowpass: 1200 },
      { wave: 'sine', from: 110, ms: 180, gain: 0.5, attackMs: 10, lowpass: 600 }
    ]
  }),
  soft({
    id: 'soft-notice',
    label: 'Soft notice',
    description: 'Information: a 528 Hz sine held 220 ms with a slow 5 Hz tremolo, low-passed at 2 kHz.',
    durationMs: 230,
    level: 0.35,
    steps: [{ wave: 'sine', from: 528, ms: 220, attackMs: 12, lowpass: 2000, tremoloHz: 5 }]
  }),
  soft({
    id: 'panel-open',
    label: 'Panel open',
    description: 'Panels slide out: a pneumatic hiss (band-passed noise sweeping 500 to 1600 Hz over 260 ms) over a servo glide, sine 170 to 300 Hz.',
    durationMs: 280,
    level: 0.4,
    steps: [
      { wave: 'noise', from: 0, ms: 260, gain: 0.7, attackMs: 30, bandpass: { from: 500, to: 1600, q: 1.2 } },
      { wave: 'sine', from: 170, to: 300, ms: 220, gain: 0.5, attackMs: 20, lowpass: 900 }
    ]
  }),
  soft({
    id: 'panel-close',
    label: 'Panel close',
    description: 'Panels slide in: the hiss reversed (1600 to 450 Hz), the servo glides down 300 to 170 Hz, and a dull 120 Hz latch lands at the end.',
    durationMs: 300,
    level: 0.4,
    steps: [
      { wave: 'noise', from: 0, ms: 240, gain: 0.7, attackMs: 30, bandpass: { from: 1600, to: 450, q: 1.2 } },
      { wave: 'sine', from: 300, to: 170, ms: 220, gain: 0.5, attackMs: 20, lowpass: 900 },
      { wave: 'sine', from: 120, at: 220, ms: 70, gain: 0.8, attackMs: 4, lowpass: 500 }
    ]
  }),
  soft({
    id: 'view-out',
    label: 'View out',
    description: 'Pull back to a wider view: a 480 ms sine sweep down 520 to 260 Hz under a closing lowpass, with a soft air bed.',
    durationMs: 500,
    level: 0.4,
    steps: [
      { wave: 'sine', from: 520, to: 260, ms: 480, attackMs: 25, lowpass: 1600, lowpassTo: 500 },
      { wave: 'noise', from: 0, ms: 420, gain: 0.3, attackMs: 40, bandpass: { from: 900, to: 400, q: 0.8 } }
    ]
  }),
  soft({
    id: 'view-in',
    label: 'View in',
    description: 'Return to the closer view: the mirror, 260 to 520 Hz with an opening lowpass and the air rising.',
    durationMs: 500,
    level: 0.4,
    steps: [
      { wave: 'sine', from: 260, to: 520, ms: 480, attackMs: 25, lowpass: 500, lowpassTo: 1600 },
      { wave: 'noise', from: 0, ms: 420, gain: 0.3, attackMs: 40, bandpass: { from: 400, to: 900, q: 0.8 } }
    ]
  }),
  soft({
    id: 'soft-engage',
    label: 'Soft engage',
    description: 'Console start: a slow three-note sine arpeggio, 330 / 495 / 660 Hz with 20 ms attacks, 600 ms, low-passed at 2.4 kHz.',
    durationMs: 620,
    level: 0.45,
    steps: [
      { wave: 'sine', from: 330, ms: 240, attackMs: 20, lowpass: 2400 },
      { wave: 'sine', from: 495, at: 180, ms: 240, attackMs: 20, lowpass: 2400 },
      { wave: 'sine', from: 660, at: 360, ms: 260, attackMs: 20, lowpass: 2400 }
    ]
  }),
  soft({
    id: 'soft-glyph',
    label: 'Soft glyph',
    description: 'Text deciphering: a 25 ms puff of noise band-passed at 1.4 kHz, for letters settling.',
    durationMs: 30,
    level: 0.22,
    steps: [{ wave: 'noise', from: 0, ms: 25, attackMs: 4, bandpass: { from: 1400, q: 2 } }]
  })
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
    const attack = Math.min((s.attackMs ?? 2) / 1000, s.ms / 2000);
    const gain = ctx.createGain();
    const peak = Math.max(0.0002, preset.level * level * (s.gain ?? 1));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
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
      f.frequency.setValueAtTime(s.lowpass, start);
      if (s.lowpassTo && s.lowpassTo !== s.lowpass) f.frequency.exponentialRampToValueAtTime(s.lowpassTo, end);
      chain.connect(f);
      chain = f;
    }
    if (s.bandpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = s.bandpass.q ?? 1;
      f.frequency.setValueAtTime(s.bandpass.from, start);
      if (s.bandpass.to && s.bandpass.to !== s.bandpass.from) f.frequency.exponentialRampToValueAtTime(s.bandpass.to, end);
      chain.connect(f);
      chain = f;
    }
    if (s.tremoloHz) {
      // Amplitude wobble: an LFO modulating a second gain stage around 1.
      const trem = ctx.createGain();
      trem.gain.setValueAtTime(1, start);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = s.tremoloHz;
      const depth = ctx.createGain();
      depth.gain.value = 0.35;
      lfo.connect(depth).connect(trem.gain);
      lfo.start(start);
      lfo.stop(end + 0.02);
      chain.connect(trem);
      chain = trem;
    }
    chain.connect(gain).connect(ctx.destination);
    node.start(start);
    node.stop(end + 0.02);
  }
}
