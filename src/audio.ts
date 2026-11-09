// All sound is synthesized with Web Audio (no audio files): engines, wind, surf, birds and one-shots.
// The AudioContext starts on the first user gesture (Start button), as browsers require.

import type { VehicleId } from './vehicles/types';

const MUTE_KEY = 'drivefolio.muted';

interface EngineVoice {
  main: OscillatorNode; // firing frequency, sawtooth
  sub: OscillatorNode; // half the firing frequency: the low "rumble"
  lope: OscillatorNode; // amplitude wobble at the crank rate: the "putt-putt"
  lopeDepth: GainNode;
  shaper: WaveShaperNode; // soft clipping for growl
  filter: BiquadFilterNode;
  intake: BiquadFilterNode; // noise band that opens with throttle
  intakeGain: GainNode;
  gain: GainNode;
}

interface EngineProfile {
  cylinders: number;
  idle: number; // rpm
  redline: number; // rpm
  topSpeed: number; // m/s in top gear
  tone: number; // low-pass base (Hz)
  growl: number; // distortion amount
  lope: number; // 0..1 how lumpy the idle is
}

const GEARS = [0.2, 0.38, 0.57, 0.78, 1]; // fraction of top speed at the top of each gear

const ENGINES: Partial<Record<VehicleId, EngineProfile>> = {
  jeep: { cylinders: 4, idle: 850, redline: 6000, topSpeed: 33, tone: 420, growl: 2.5, lope: 0.25 },
  sports: { cylinders: 8, idle: 1000, redline: 8200, topSpeed: 49, tone: 650, growl: 3.5, lope: 0.3 },
  monster: { cylinders: 8, idle: 650, redline: 4800, topSpeed: 28, tone: 260, growl: 6, lope: 0.6 },
  buggy: { cylinders: 2, idle: 1300, redline: 9500, topSpeed: 37, tone: 900, growl: 3, lope: 0.45 },
};

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

function softClip(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export interface SoundState {
  vehicle: VehicleId;
  speed: number; // m/s
  throttle: number; // 0..1
  grounded: boolean;
  wind: number; // 0..1
  shore: number; // 0..1 how close to the sea
}

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
  let profileId: VehicleId | null = null;
  let gear = 0;
  let rpm = 800;

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

    // car engine: (sawtooth + sub-octave square) → lope wobble → soft clip → low-pass, plus intake noise
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const ef = ctx.createBiquadFilter();
    ef.type = 'lowpass';
    ef.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(3);
    shaper.oversample = '2x';
    const lopeGain = ctx.createGain(); // carrier gain wobbled by the lope LFO
    lopeGain.gain.value = 0.7;
    const lope = ctx.createOscillator();
    const lopeDepth = ctx.createGain();
    lopeDepth.gain.value = 0.25;
    lope.connect(lopeDepth).connect(lopeGain.gain);
    const main = ctx.createOscillator();
    main.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    main.connect(lopeGain);
    sub.connect(subGain).connect(lopeGain);
    lopeGain.connect(shaper).connect(ef).connect(eg).connect(master);
    const intake = ctx.createBiquadFilter();
    intake.type = 'bandpass';
    intake.Q.value = 1.2;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0;
    intake.connect(intakeGain).connect(eg);
    noiseLoop(intake);
    main.start();
    sub.start();
    lope.start();
    engine = { main, sub, lope, lopeDepth, shaper, filter: ef, intake, intakeGain, gain: eg };

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
    const E = ENGINES[s.vehicle];
    if (E) {
      if (profileId !== s.vehicle) {
        profileId = s.vehicle;
        engine.shaper.curve = softClip(E.growl);
        engine.lopeDepth.gain.value = E.lope * 0.5;
        gear = 0;
        rpm = E.idle;
      }
      // gearbox: shift up near the top of each gear, down with a little hysteresis
      const top = (g: number) => GEARS[g] * E.topSpeed;
      while (gear < GEARS.length - 1 && s.speed > top(gear) * 0.97) gear++;
      while (gear > 0 && s.speed < top(gear - 1) * 0.8) gear--;
      const low = gear === 0 ? 0 : top(gear - 1) * 0.8;
      const inGear = clamp((s.speed - low) / (top(gear) - low), 0, 1);
      // on throttle the revs follow the road speed; off throttle they fall toward idle (but stay tied to the wheels)
      const target = E.idle + (E.redline - E.idle) * (0.12 + inGear * 0.88) * (0.55 + s.throttle * 0.45);
      const free = s.grounded ? target : E.idle + (E.redline - E.idle) * s.throttle * 0.9; // in the air the engine free-revs
      rpm += (free - rpm) * (1 - Math.exp(-(s.throttle > 0.1 ? 9 : 4) * dt));
      const fire = (rpm / 60) * (E.cylinders / 2); // firing frequency (4-stroke)
      set(engine.main.frequency, fire, 0.03);
      set(engine.sub.frequency, fire / 2, 0.03);
      set(engine.lope.frequency, rpm / 120, 0.03); // once per two crank turns
      const load = s.throttle;
      set(engine.filter.frequency, E.tone + fire * (1.5 + load * 3), 0.05);
      set(engine.intake.frequency, fire * 3, 0.05);
      set(engine.intakeGain.gain, load * 0.05, 0.05);
      set(engine.gain.gain, 0.045 + load * 0.085 + (rpm / E.redline) * 0.03, 0.06);
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
