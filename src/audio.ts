// All sound is synthesized with Web Audio (no audio files): engines, wind, surf, birds and one-shots.
// The AudioContext starts on the first user gesture (Start button), as browsers require.

import type { VehicleId } from './vehicles/types';

const MUTE_KEY = 'drivefolio.muted';

interface EngineVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export interface SoundState {
  vehicle: VehicleId;
  speed: number; // m/s
  throttle: number; // 0..1
  grounded: boolean;
  wind: number; // 0..1
  shore: number; // 0..1 how close to the sea
}

// per-vehicle engine character: [idle Hz, Hz per m/s, filter base, wave]
const ENGINES: Record<VehicleId, [number, number, number, OscillatorType]> = {
  jeep: [48, 2.4, 500, 'sawtooth'],
  sports: [70, 3.4, 900, 'sawtooth'],
  monster: [34, 1.6, 380, 'square'],
  buggy: [80, 3.8, 1100, 'square'],
  heli: [0, 0, 0, 'sine'],
  jet: [0, 0, 0, 'sine'],
};

export function createAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode;
  let noise: AudioBuffer;
  let engine: EngineVoice;
  let roar: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  let whine: { osc: OscillatorNode; gain: GainNode };
  let rotor: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode; depth: GainNode };
  let windV: { gain: GainNode; filter: BiquadFilterNode };
  let surf: { gain: GainNode };
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    /* default: sound on */
  }
  let birdTimer = 3;

  function noiseLoop(dest: AudioNode) {
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.connect(dest);
    src.start(0, Math.random() * 2);
    return src;
  }

  function start() {
    if (ctx) {
      void ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // car engine: two detuned oscillators through a low-pass
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.Q.value = 4;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o2.detune.value = 18;
    o1.connect(ef);
    o2.connect(ef);
    ef.connect(eg).connect(master);
    o1.start();
    o2.start();
    engine = { osc1: o1, osc2: o2, filter: ef, gain: eg };

    // jet: roaring noise + turbine whine
    const rg = ctx.createGain();
    rg.gain.value = 0;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.Q.value = 0.7;
    rf.connect(rg).connect(master);
    roar = { src: noiseLoop(rf), filter: rf, gain: rg };
    const wg = ctx.createGain();
    wg.gain.value = 0;
    const wo = ctx.createOscillator();
    wo.type = 'sine';
    wo.connect(wg).connect(master);
    wo.start();
    whine = { osc: wo, gain: wg };

    // helicopter: low noise chopped by an LFO
    const hg = ctx.createGain();
    hg.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 320;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 10;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chop.gain);
    lfo.start();
    hf.connect(chop).connect(hg).connect(master);
    rotor = { src: noiseLoop(hf), gain: hg, lfo, depth };

    // wind and surf beds
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windFilter.connect(windGain).connect(master);
    noiseLoop(windFilter);
    windV = { gain: windGain, filter: windFilter };

    const sg = ctx.createGain();
    sg.gain.value = 0;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 600;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    const slfo = ctx.createOscillator();
    slfo.frequency.value = 0.12;
    const sdepth = ctx.createGain();
    sdepth.gain.value = 0.4;
    slfo.connect(sdepth).connect(swell.gain);
    slfo.start();
    sf.connect(swell).connect(sg).connect(master);
    noiseLoop(sf);
    surf = { gain: sg };
  }

  const set = (p: AudioParam, v: number, k = 0.08) => ctx && p.setTargetAtTime(v, ctx.currentTime, k);

  function update(s: SoundState, dt: number) {
    if (!ctx) return;
    const [idle, perMs, fbase, wave] = ENGINES[s.vehicle];
    const car = idle > 0;
    if (car) {
      if (engine.osc1.type !== wave) engine.osc1.type = engine.osc2.type = wave;
      // fake gears: pitch climbs then drops every ~12 m/s
      const gearSpeed = s.speed % 12;
      const f = idle + gearSpeed * perMs * 2 + s.speed * perMs * 0.6;
      set(engine.osc1.frequency, f);
      set(engine.osc2.frequency, f * 1.5);
      set(engine.filter.frequency, fbase + s.throttle * 1400 + s.speed * 25);
      set(engine.gain.gain, 0.05 + s.throttle * 0.09);
    } else set(engine.gain.gain, 0);

    if (s.vehicle === 'jet') {
      set(roar.filter.frequency, 300 + s.throttle * 1500 + s.speed * 6);
      set(roar.gain.gain, 0.04 + s.throttle * 0.22);
      set(whine.osc.frequency, 900 + s.throttle * 1800);
      set(whine.gain.gain, 0.008 + s.throttle * 0.025);
    } else {
      set(roar.gain.gain, 0);
      set(whine.gain.gain, 0);
    }

    if (s.vehicle === 'heli') {
      set(rotor.lfo.frequency, 4 + s.throttle * 9);
      set(rotor.gain.gain, s.throttle * 0.5);
    } else set(rotor.gain.gain, 0);

    set(windV.gain.gain, 0.02 + s.wind * 0.05 + Math.min(s.speed / 60, 1) * 0.12, 0.3);
    set(windV.filter.frequency, 350 + s.speed * 18, 0.3);
    set(surf.gain.gain, s.shore * 0.22, 0.5);

    // birds now and then, when it's calm enough to hear them
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 4 + Math.random() * 9;
      if (s.speed < 25 && s.shore < 0.6) bird();
    }
  }

  // ---------- one-shots ----------
  function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, endFreq?: number, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass', endFreq?: number) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
  function bird() {
    const base = 2200 + Math.random() * 1500;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(base, 0.09, 'sine', 0.04, base * 1.4, i * 0.13);
  }

  return {
    start,
    update,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        /* preference just won't persist */
      }
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
      return muted;
    },
    jump: () => tone(220, 0.25, 'triangle', 0.18, 520),
    land: (strength: number) => {
      tone(90, 0.25, 'sine', Math.min(0.35, 0.1 + strength * 0.03), 45);
      burst(0.18, 400, Math.min(0.2, strength * 0.02));
    },
    splash: () => {
      burst(0.9, 2500, 0.35, 'bandpass', 300);
      tone(160, 0.3, 'sine', 0.15, 60);
    },
    crash: () => {
      burst(0.6, 1800, 0.45, 'lowpass', 120);
      tone(70, 0.4, 'square', 0.12, 35);
    },
    checkpoint: () => {
      tone(880, 0.15, 'triangle', 0.14);
      tone(1320, 0.25, 'triangle', 0.12, undefined, 0.09);
    },
    lap: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.15, undefined, i * 0.11)),
    zone: () => {
      tone(660, 0.6, 'sine', 0.1);
      tone(990, 0.8, 'sine', 0.06, undefined, 0.05);
    },
    click: () => tone(1200, 0.05, 'square', 0.05),
  };
}

export type Audio = ReturnType<typeof createAudio>;
