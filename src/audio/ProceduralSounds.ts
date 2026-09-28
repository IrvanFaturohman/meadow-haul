/**
 * ProceduralSounds — Web Audio synthesis recipes for Meadow Haul.
 *
 * This module is stateless graph construction only (no timers, no context
 * ownership). It provides:
 *   - a shared noise bank (white / pink / brown), built once and reused;
 *   - `Voice`, a tiny builder that records every node a one-shot creates so
 *     the AudioManager can disconnect them when the sources end;
 *   - one-shot recipes (`Recipe`) for every SFX, bird calls and music notes;
 *   - builders for the persistent loops (blade, vacuum, truck, wind) that
 *     return the AudioParams the manager drives with smoothing.
 *
 * Gain staging (noise buffers are normalised to RMS 0.3 so filter maths is
 * predictable; values below are at the bus input, before user volume):
 *   one-shot peaks ~0.2–0.35 (UI/footsteps ~0.1–0.15), loops ~0.05–0.15,
 *   wind ~0.06, birds ~0.03–0.04, music ~0.03–0.05 per voice.
 *
 * Small phone speakers roll off below ~250 Hz, so every "thump" also carries
 * a mid-band component (knock / straw / harmonics) to stay audible there.
 */

export type NoiseKind = 'white' | 'pink' | 'brown';
export type NoiseBank = Readonly<Record<NoiseKind, AudioBuffer>>;

/** RMS every noise buffer is normalised to. */
export const NOISE_RMS = 0.3;
/** Base frequency (Hz) of the blade motor hum at level 1, no load. */
export const BLADE_F0 = 88;
/** Truck engine base frequency (Hz) at idle. */
export const TRUCK_F0 = 34;
/** Centre (Hz) of the airy "grass hiss" wind layer. */
export const WIND_WHISTLE_HZ = 1700;

const SILENT = 1e-4;

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** MIDI note number to frequency (A4 = 69 = 440 Hz). */
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------------------
// Noise bank
// ---------------------------------------------------------------------------

/**
 * Renders a mono noise buffer that loops seamlessly (the continuation past the
 * end is equal-power crossfaded into the head) with DC removed and RMS
 * normalised to NOISE_RMS.
 */
function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, next: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(2048, Math.floor(sr * seconds));
  const xf = Math.floor(Math.min(sr * 0.05, len / 4));
  const raw = new Float32Array(len + xf);
  for (let i = 0; i < 4096; i++) next(); // let IIR-based generators settle
  let mean = 0;
  for (let i = 0; i < raw.length; i++) {
    const s = next();
    raw[i] = s;
    mean += s;
  }
  mean /= raw.length;

  const buffer = ctx.createBuffer(1, len, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = raw[i] - mean;
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    data[i] = data[i] * Math.sqrt(a) + (raw[len + i] - mean) * Math.sqrt(1 - a);
  }
  let sum = 0;
  for (let i = 0; i < len; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / len);
  const k = rms > 0 ? NOISE_RMS / rms : 0;
  for (let i = 0; i < len; i++) data[i] *= k;
  return buffer;
}

/** Builds the shared noise buffers. Call ONCE per AudioContext. */
export function createNoiseBank(ctx: BaseAudioContext): NoiseBank {
  const white = makeNoiseBuffer(ctx, 2, () => Math.random() * 2 - 1);

  // Paul Kellet's refined pink noise filter.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const pink = makeNoiseBuffer(ctx, 4, () => {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out;
  });

  // Leaky-integrated ("brown"/red) noise.
  let last = 0;
  const brown = makeNoiseBuffer(ctx, 4, () => {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    return last;
  });

  return { white, pink, brown };
}

// ---------------------------------------------------------------------------
// Low-level graph helpers
// ---------------------------------------------------------------------------

function isParam(d: AudioNode | AudioParam): d is AudioParam {
  return typeof (d as AudioNode).connect !== 'function';
}

function link(src: AudioNode, dest: AudioNode | AudioParam): void {
  if (isParam(dest)) src.connect(dest);
  else src.connect(dest);
}

function mkGain(ctx: BaseAudioContext, value: number, dest: AudioNode | AudioParam): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  link(g, dest);
  return g;
}

function mkFilter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  freq: number,
  q: number,
  dest: AudioNode | AudioParam,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  link(f, dest);
  return f;
}

/** Persistent oscillator (started immediately, never stopped). */
function mkOsc(ctx: BaseAudioContext, type: OscillatorType, freq: number, dest: AudioNode | AudioParam): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  link(o, dest);
  o.start();
  return o;
}

/** Persistent looping noise source at a random offset. */
function mkNoiseLoop(ctx: BaseAudioContext, buf: AudioBuffer, dest: AudioNode, rate: number): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  s.start(0, Math.random() * buf.duration * 0.95);
  return s;
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** Linear attack, exponential decay to silence. Returns the end time. */
export function perc(p: AudioParam, t: number, attack: number, peak: number, decay: number): number {
  const a = Math.max(0.0005, attack);
  const end = t + a + Math.max(0.004, decay);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(peak, SILENT * 2), t + a);
  p.exponentialRampToValueAtTime(SILENT, end);
  p.linearRampToValueAtTime(0, end + 0.005);
  return end + 0.005;
}

/** Linear attack, hold, linear release (whooshes, rustles). Returns the end time. */
export function swell(p: AudioParam, t: number, attack: number, peak: number, hold: number, release: number): number {
  const a = Math.max(0.002, attack);
  const relStart = t + a + Math.max(0, hold);
  const end = relStart + Math.max(0.01, release);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, relStart);
  p.linearRampToValueAtTime(0, end);
  return end;
}

/**
 * Several short percussive spikes on ONE gain param (grains, micro-bursts),
 * so a single noise source can render a whole cluster. `times` must be sorted
 * and spaced at least `attack + 6 ms` apart. Returns the end time.
 */
export function spikes(p: AudioParam, times: number[], peaks: number[], attack: number, decay: number): number {
  if (times.length === 0) return 0;
  let end = times[0];
  p.setValueAtTime(0, times[0]);
  for (let i = 0; i < times.length; i++) {
    const ti = times[i];
    const next = i + 1 < times.length ? times[i + 1] : Number.POSITIVE_INFINITY;
    const d = Math.max(0.003, Math.min(decay, next - ti - attack - 0.002));
    const pk = Math.max(peaks[Math.min(i, peaks.length - 1)], SILENT * 2);
    if (i > 0) p.setValueAtTime(SILENT, ti);
    p.linearRampToValueAtTime(pk, ti + attack);
    p.exponentialRampToValueAtTime(SILENT, ti + attack + d);
    end = ti + attack + d;
  }
  p.linearRampToValueAtTime(0, end + 0.005);
  return end + 0.005;
}

/** Exponential frequency glide. */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(from, 0.001), t);
  p.exponentialRampToValueAtTime(Math.max(to, 0.001), t + Math.max(0.001, dur));
}

// ---------------------------------------------------------------------------
// Voice builder
// ---------------------------------------------------------------------------

/**
 * Collects every node a one-shot creates. Sources are started immediately at
 * their scheduled time; every source MUST get a stop time (`osc(..., stop)`,
 * `noise(...)` or `stopAt`). `end` tracks the latest stop time.
 */
export class Voice {
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  end = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    /** Voice output (the manager's per-voice gain / panner chain). */
    readonly out: AudioNode,
    private readonly bank: NoiseBank,
  ) {}

  gain(value: number, dest: AudioNode | AudioParam): GainNode {
    const g = mkGain(this.ctx, value, dest);
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode | AudioParam): BiquadFilterNode {
    const f = mkFilter(this.ctx, type, freq, q, dest);
    this.nodes.push(f);
    return f;
  }

  osc(type: OscillatorType, freq: number, dest: AudioNode | AudioParam, start: number, stop?: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    link(o, dest);
    this.nodes.push(o);
    this.sources.push(o);
    o.start(start);
    if (stop !== undefined) this.stopAt(o, stop);
    return o;
  }

  /** Noise burst from the shared bank at a random offset (no allocation of new buffers). */
  noise(kind: NoiseKind, dest: AudioNode, start: number, stop: number, rate = 1): AudioBufferSourceNode {
    const buf = this.bank[kind];
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    this.nodes.push(s);
    this.sources.push(s);
    s.start(start, Math.random() * buf.duration * 0.95);
    this.stopAt(s, stop);
    return s;
  }

  stopAt(src: AudioScheduledSourceNode, time: number): void {
    src.stop(time);
    if (time > this.end) this.end = time;
  }

  /** Stereo panner inside the voice (for pan sweeps). Falls back to `dest`. */
  panner(pan: number, dest: AudioNode): { node: AudioNode; param: AudioParam | null } {
    if (typeof this.ctx.createStereoPanner !== 'function') return { node: dest, param: null };
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dest);
    this.nodes.push(p);
    return { node: p, param: p.pan };
  }
}

export interface RecipeOpts {
  /** Sound-specific intensity (cut: cells, vacuumTick: units, cash: 0..1 size). */
  intensity: number;
  /** Pitch multiplier, already including random variation. */
  pitch: number;
  /** Rotating variant counter; recipes use `variant % n` to pick a flavour. */
  variant: number;
}

export type Recipe = (v: Voice, t: number, o: RecipeOpts) => void;

// ---------------------------------------------------------------------------
// Shared timbres
// ---------------------------------------------------------------------------

/** Soft pitched thump: triangle with falling pitch, low-passed. */
function thump(v: Voice, t: number, f0: number, f1: number, dur: number, peak: number): void {
  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', f0 * 5, 0.7, g);
  const end = perc(g.gain, t, 0.004, peak, dur);
  const o = v.osc('triangle', f0, lp, t, end + 0.02);
  glide(o.frequency, t, f0, f1, dur * 0.7);
}

/** Woody knock: short sine ping + inharmonic partial + resonant noise transient. */
function knock(v: Voice, t: number, freq: number, peak: number, decay: number): void {
  const g = v.gain(0, v.out);
  const e1 = perc(g.gain, t, 0.001, peak, decay);
  const o = v.osc('sine', freq * 1.04, g, t, e1 + 0.02);
  glide(o.frequency, t, freq * 1.04, freq, 0.02);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, 0.001, peak * 0.35, decay * 0.5);
  v.osc('sine', freq * 2.31, g2, t, e2 + 0.02);

  const g3 = v.gain(0, v.out);
  const bp = v.filter('bandpass', freq * 1.5, 3, g3);
  const e3 = perc(g3.gain, t, 0.0008, peak * 4, 0.012);
  v.noise('white', bp, t, e3 + 0.01);
}

/** Straw rustle: band-passed pink noise sweeping from `from` to `to`. */
function straw(v: Voice, t: number, from: number, to: number, dur: number, peak: number): void {
  const g = v.gain(0, v.out);
  const bp = v.filter('bandpass', from, 1.3, g);
  glide(bp.frequency, t, from, to, dur);
  const end = perc(g.gain, t, dur * 0.2, peak, dur * 0.8);
  v.noise('pink', bp, t, end + 0.01, rnd(0.9, 1.1));
}

/** Mechanical latch click: falling triangle blip + bright noise tick. */
function latchClick(v: Voice, t: number, freq: number, peak: number): void {
  const g = v.gain(0, v.out);
  const e1 = perc(g.gain, t, 0.001, peak * 0.55, 0.035);
  const o = v.osc('triangle', freq, g, t, e1 + 0.02);
  glide(o.frequency, t, freq, freq * 0.6, 0.03);

  const g2 = v.gain(0, v.out);
  const bp = v.filter('bandpass', freq * 2.6, 2.5, g2);
  const e2 = perc(g2.gain, t, 0.0005, peak * 3, 0.01);
  v.noise('white', bp, t, e2 + 0.01);
}

/** Soft mallet tone: low-passed triangle plus a quiet octave sine. */
function tone(v: Voice, t: number, freq: number, peak: number, attack: number, decay: number, cutoff = 3000): void {
  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', cutoff, 0.6, g);
  const e1 = perc(g.gain, t, attack, peak, decay);
  v.osc('triangle', freq, lp, t, e1 + 0.02);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, attack, peak * 0.2, decay * 0.5);
  v.osc('sine', freq * 2, g2, t, e2 + 0.02);
}

type BellPartial = readonly [ratio: number, amp: number, decayScale: number];
const BELL: readonly BellPartial[] = [[1, 1, 1], [2, 0.28, 0.5], [2.76, 0.08, 0.3]];
const CHIME: readonly BellPartial[] = [[1, 1, 1], [2, 0.3, 0.55], [3.01, 0.1, 0.35]];

/** Additive sine bell. */
function bell(v: Voice, t: number, f: number, peak: number, decay: number, partials: readonly BellPartial[]): void {
  for (const [ratio, amp, dk] of partials) {
    const g = v.gain(0, v.out);
    const e = perc(g.gain, t, 0.002, peak * amp, decay * dk);
    v.osc('sine', f * ratio, g, t, e + 0.02);
  }
}

/** Dull, low "thunk" (muffled square). */
function dullThunk(v: Voice, t: number, f: number, peak: number, decay: number): void {
  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', 620, 0.6, g);
  const e = perc(g.gain, t, 0.003, peak, decay);
  const o = v.osc('square', f, lp, t, e + 0.02);
  glide(o.frequency, t, f, f * 0.72, decay * 0.8);
}

// ---------------------------------------------------------------------------
// Harvest one-shots
// ---------------------------------------------------------------------------

/**
 * Grass cut: fibre "tsk / zip". 35–90 ms high-passed + band-passed white-noise
 * burst (1–3 micro-bursts on one source) plus a short mid "stem crunch".
 * intensity = cells in batch (1..30): log-scaled gain and brightness.
 */
export const grassCut: Recipe = (v, t, o) => {
  const n = clamp(o.intensity, 1, 30);
  const k = Math.log2(1 + n) / Math.log2(31); // 0.2 (1 cell) .. 1 (30 cells)
  const level = 0.62 + 0.38 * k;
  const bright = o.pitch * (0.9 + 0.35 * k);
  const variant = o.variant % 3;
  const len = rnd(0.035, 0.06) + 0.03 * k;

  const g = v.gain(0, v.out);
  const f = 4300 * bright;
  const bp = v.filter('bandpass', f, rnd(1.3, 2.1), g);
  const hp = v.filter('highpass', 1700 * bright, 0.7, bp);
  if (variant === 1) glide(bp.frequency, t, f * 0.7, f * 1.25, len); // "zip"
  else glide(bp.frequency, t, f * 1.1, f * 0.88, len); // "tsk"

  const bursts = variant === 2 ? 2 : 1 + (k > 0.55 ? 1 : 0) + (k > 0.85 ? 1 : 0);
  const times = [t];
  const peaks = [1.15 * level];
  for (let i = 1; i < bursts; i++) {
    times.push(times[i - 1] + rnd(0.012, 0.022));
    peaks.push(peaks[i - 1] * rnd(0.55, 0.75));
  }
  const end = spikes(g.gain, times, peaks, 0.002, len);
  v.noise('white', hp, t, end + 0.01);

  // Stem crunch grows with batch size.
  const g2 = v.gain(0, v.out);
  const bp2 = v.filter('bandpass', rnd(900, 1400) * o.pitch, 1.1, g2);
  const e2 = perc(g2.gain, t, 0.002, 0.42 * (0.35 + 0.65 * k), rnd(0.022, 0.04));
  v.noise('pink', bp2, t, e2 + 0.01);
};

/**
 * Vacuum intake grains: 2–7 tiny resonant ticks (one noise source, filter
 * frequency hops per grain) plus a soft low-pass "gulp".
 * intensity = units taken in this batch.
 */
export const vacuumGrains: Recipe = (v, t, o) => {
  const n = clamp(o.intensity, 1, 40);
  const k = Math.log2(1 + n) / Math.log2(41);
  const count = 2 + Math.round(k * 5);
  const span = 0.045 + 0.09 * k;

  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(t + Math.random() * span);
  times.sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] < 0.009) times[i] = times[i - 1] + 0.009;
  }
  const peaks = times.map(() => rnd(1.0, 1.6) * (0.75 + 0.25 * k));

  const g = v.gain(0, v.out);
  const bp = v.filter('bandpass', 3500, o.variant % 2 ? rnd(4, 5.5) : rnd(5.5, 7), g);
  for (const ti of times) bp.frequency.setValueAtTime(rnd(2300, 5200) * o.pitch, ti);
  const end = spikes(g.gain, times, peaks, 0.0015, rnd(0.007, 0.014));
  v.noise('white', bp, t, end + 0.01);

  const g2 = v.gain(0, v.out);
  const lp = v.filter('lowpass', 450, 0.8, g2);
  glide(lp.frequency, t, 450 * o.pitch, 2400 * o.pitch, span + 0.04);
  const e2 = perc(g2.gain, t, 0.02, 0.1 + 0.06 * k, span + 0.04);
  v.noise('pink', lp, t, e2 + 0.01);
};

/** Tool swap: two latch clicks (release + lock), a small body thunk and a swoosh. */
export const toolSwap: Recipe = (v, t, o) => {
  const p = o.pitch;
  latchClick(v, t, 1350 * p, 0.3);
  latchClick(v, t + rnd(0.07, 0.095), 980 * p, 0.2);
  thump(v, t + 0.01, 190 * p, 120 * p, 0.07, 0.12);

  const g = v.gain(0, v.out);
  const bp = v.filter('bandpass', 480 * p, 1.1, g);
  bp.frequency.setValueAtTime(480 * p, t);
  bp.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.12);
  bp.frequency.exponentialRampToValueAtTime(900 * p, t + 0.28);
  const end = swell(g.gain, t, 0.07, 0.42, 0.02, 0.19);
  v.noise('pink', bp, t, end + 0.01);
};

// ---------------------------------------------------------------------------
// Bale family (woody / straw): pack, pickup, drop
// ---------------------------------------------------------------------------

/** Bale formed: soft packing thump, compressing straw "shff", twine tick. */
export const balePack: Recipe = (v, t, o) => {
  const p = o.pitch;
  thump(v, t, 150 * p, 72 * p, 0.14, 0.24);
  thump(v, t, 330 * p, 240 * p, 0.06, 0.08); // mid "tock" for small speakers
  straw(v, t, 3300 * p, 1100 * p, 0.17, 0.34);
  knock(v, t + rnd(0.12, 0.15), (o.variant % 2 ? 760 : 690) * p, 0.07, 0.05);
  straw(v, t + 0.13, 1900 * p, 1500 * p, 0.1, 0.12);
};

/** Bale picked up: light rising pop + straw flick + tiny knock. `pitch` rises per stack step. */
export const balePickup: Recipe = (v, t, o) => {
  const p = clamp(o.pitch, 0.5, 2.5);
  const g = v.gain(0, v.out);
  const e1 = perc(g.gain, t, 0.003, 0.2, 0.08);
  const s = v.osc('sine', 330 * p, g, t, e1 + 0.02);
  glide(s.frequency, t, 330 * p, 580 * p, 0.05);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, 0.002, 0.04, 0.05);
  const tri = v.osc('triangle', 660 * p, g2, t, e2 + 0.02);
  glide(tri.frequency, t, 660 * p, 1150 * p, 0.05);

  straw(v, t, 2900 * p, 3600 * p, 0.07, 0.2);
  knock(v, t, (o.variant % 2 ? 980 : 880) * p, 0.045, 0.03);
};

/** Bale dropped into the truck: heavy thud + dull impact + truck-bed tick. */
export const baleDrop: Recipe = (v, t, o) => {
  const p = o.pitch;
  thump(v, t, 125 * p, 58 * p, 0.17, 0.24);
  thump(v, t, 280 * p, 190 * p, 0.07, 0.11);

  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', 420 * p, 0.7, g);
  const e = perc(g.gain, t, 0.002, 0.3, 0.08);
  v.noise('brown', lp, t, e + 0.01);

  straw(v, t, 2100 * p, 1500 * p, 0.09, 0.2);
  knock(v, t + rnd(0.04, 0.06), (o.variant % 2 ? 1180 : 1060) * p, 0.07, 0.04);
};

// ---------------------------------------------------------------------------
// Economy / progression
// ---------------------------------------------------------------------------

/** Cash: short sine chime (A5 base) + coin tick. intensity 0..1 = size (adds a fifth). */
export const cashTick: Recipe = (v, t, o) => {
  const size = clamp(o.intensity, 0, 1);
  const f = 880 * o.pitch;
  const lvl = 0.85 + 0.3 * size;
  bell(v, t, f, 0.15 * lvl, 0.2, CHIME);
  if (size > 0.5) bell(v, t + 0.04, f * 1.5, 0.07 * lvl, 0.18, CHIME);

  const g = v.gain(0, v.out);
  const hp = v.filter('highpass', o.variant % 2 ? 5200 : 6000, 0.7, g);
  const e = perc(g.gain, t, 0.0008, 0.16, 0.007);
  v.noise('white', hp, t, e + 0.01);
};

const UPGRADE_CHORDS: readonly (readonly number[])[] = [
  [65, 69, 72], // F A C
  [69, 72, 77], // A C F
  [60, 65, 69], // C F A
];

/** Upgrade: rolled 3-note F-major chord (~0.55 s) with a soft octave sparkle. */
export const upgradeChord: Recipe = (v, t, o) => {
  const chord = UPGRADE_CHORDS[o.variant % UPGRADE_CHORDS.length];
  chord.forEach((m, i) => tone(v, t + i * 0.055, mtof(m) * o.pitch, 0.14, 0.008, 0.42, 2800));
  const top = chord[chord.length - 1];
  const g = v.gain(0, v.out);
  const e = perc(g.gain, t + 0.12, 0.004, 0.04, 0.3);
  v.osc('sine', mtof(top + 12) * o.pitch, g, t + 0.12, e + 0.02);
};

/** Level up: quick F-A-C run into a held F-major chord with airy shimmer (~0.8 s). */
export const levelUpFanfare: Recipe = (v, t, o) => {
  const p = o.pitch;
  [65, 69, 72].forEach((m, i) => tone(v, t + i * 0.08, mtof(m) * p, 0.09, 0.005, 0.15, 3200));
  const tc = t + 0.25;
  for (const m of [65, 72, 77, 81]) tone(v, tc, mtof(m) * p, 0.07, 0.014, 0.55, 3400);

  const g = v.gain(0, v.out);
  const hp = v.filter('highpass', 6500, 0.7, g);
  const e = swell(g.gain, tc, 0.08, 0.06, 0.08, 0.38);
  v.noise('white', hp, tc, e + 0.01);
};

const GOAL_PAIRS: readonly (readonly [number, number])[] = [
  [72, 77], // C5 -> F5
  [69, 74], // A4 -> D5
];

/** Goal reached: two soft bell tones, a rising fourth. */
export const goalDing: Recipe = (v, t, o) => {
  const [a, b] = GOAL_PAIRS[o.variant % GOAL_PAIRS.length];
  bell(v, t, mtof(a) * o.pitch, 0.145, 0.45, BELL);
  bell(v, t + 0.12, mtof(b) * o.pitch, 0.16, 0.6, BELL);
};

/** Worker hired: bouncy 4-note pluck jingle with a friendly bass and wood-block taps. */
export const hireJingle: Recipe = (v, t, o) => {
  const p = o.pitch;
  const notes = [72, 74, 77, 81];
  const at = [0, 0.09, 0.18, 0.29];
  notes.forEach((m, i) => tone(v, t + at[i], mtof(m) * p, 0.11, 0.006, i === 3 ? 0.42 : 0.13, 3000));
  tone(v, t, mtof(53) * p, 0.09, 0.006, 0.18, 900);
  tone(v, t + 0.18, mtof(60) * p, 0.08, 0.006, 0.3, 900);
  knock(v, t, 1250 * p, 0.03, 0.025);
  knock(v, t + 0.18, 1320 * p, 0.028, 0.025);
};

// ---------------------------------------------------------------------------
// UI / feedback
// ---------------------------------------------------------------------------

/** UI press: soft falling sine "tock" + faint tick. */
export const uiClick: Recipe = (v, t, o) => {
  const f = (o.variant % 2 ? 1180 : 1320) * o.pitch;
  const g = v.gain(0, v.out);
  const e1 = perc(g.gain, t, 0.001, 0.11, 0.035);
  const s = v.osc('sine', f, g, t, e1 + 0.02);
  glide(s.frequency, t, f, f * 0.55, 0.022);

  const g2 = v.gain(0, v.out);
  const hp = v.filter('highpass', 3800, 0.7, g2);
  const e2 = perc(g2.gain, t, 0.0005, 0.1, 0.006);
  v.noise('white', hp, t, e2 + 0.01);
};

/** UI disabled / error: two dull, low muffled thunks ("bup-bup"). */
export const uiDisabled: Recipe = (v, t, o) => {
  const p = o.pitch;
  dullThunk(v, t, 200 * p, 0.12, 0.09);
  dullThunk(v, t + 0.085, 160 * p, 0.075, 0.08);
};

/** Reach limit: soft rubbery tap of a hose pulling taut. */
export const reachTap: Recipe = (v, t, o) => {
  const p = o.pitch;
  const g = v.gain(0, v.out);
  const e1 = perc(g.gain, t, 0.002, 0.11, 0.08);
  const s = v.osc('sine', 440 * p, g, t, e1 + 0.02);
  glide(s.frequency, t, 440 * p, 300 * p, 0.06);
  thump(v, t, 210 * p, 160 * p, 0.07, 0.06);

  const g2 = v.gain(0, v.out);
  const lp = v.filter('lowpass', 1600, 0.7, g2);
  const e2 = perc(g2.gain, t, 0.001, 0.18, 0.02);
  v.noise('pink', lp, t, e2 + 0.01);
};

/** Storage / carry full: low short tick with a woody click. */
export const fullTick: Recipe = (v, t, o) => {
  const p = o.pitch;
  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', 900, 0.7, g);
  const e1 = perc(g.gain, t, 0.002, 0.16, 0.075);
  const s = v.osc('triangle', 262 * p, lp, t, e1 + 0.02);
  glide(s.frequency, t, 262 * p, 235 * p, 0.06);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, 0.002, 0.08, 0.08);
  v.osc('sine', 131 * p, g2, t, e2 + 0.02);
  knock(v, t, 520 * p, 0.05, 0.03);
};

/** Footstep on soft dirt: 4 variants of pink "thud" + gritty grains + faint low thump. */
const FOOT_VARIANTS: readonly { c: number; cr: number; d: number }[] = [
  { c: 650, cr: 1900, d: 0.06 },
  { c: 800, cr: 2300, d: 0.07 },
  { c: 950, cr: 1700, d: 0.055 },
  { c: 720, cr: 2600, d: 0.075 },
];

export const footstep: Recipe = (v, t, o) => {
  const fv = FOOT_VARIANTS[o.variant % FOOT_VARIANTS.length];
  const p = o.pitch;
  const g = v.gain(0, v.out);
  const bp = v.filter('bandpass', fv.c * p, 0.9, g);
  const e1 = perc(g.gain, t, 0.004, 0.3, fv.d);
  v.noise('pink', bp, t, e1 + 0.01);

  const g2 = v.gain(0, v.out);
  const bp2 = v.filter('bandpass', fv.cr * p, 2.2, g2);
  const times = [t + 0.002, t + rnd(0.012, 0.02), t + rnd(0.028, 0.04)];
  const e2 = spikes(g2.gain, times, [0.35, 0.25, 0.15], 0.001, 0.01);
  v.noise('white', bp2, t, e2 + 0.01);

  thump(v, t, 95 * p, 62 * p, 0.045, 0.06);
};

// ---------------------------------------------------------------------------
// World / transitions
// ---------------------------------------------------------------------------

/** Replant: ~1 s rising, fluttering rustle with a faint rising tone and sparkles. */
export const replantRustle: Recipe = (v, t, o) => {
  const p = o.pitch;
  const dur = 1.0;

  const g = v.gain(0, v.out);
  const flutter = v.gain(0.65, g);
  // Two detuned LFOs make the rustle irregular.
  const d1 = v.gain(0.22, flutter.gain);
  v.osc('sawtooth', 13 * rnd(0.9, 1.1), d1, t, t + dur + 0.05);
  const d2 = v.gain(0.13, flutter.gain);
  v.osc('square', 17.3 * rnd(0.9, 1.1), d2, t, t + dur + 0.05);
  const bp = v.filter('bandpass', 450 * p, 0.9, flutter);
  glide(bp.frequency, t, 450 * p, 3800 * p, dur * 0.95);
  const e1 = swell(g.gain, t, 0.35, 0.5, 0.3, 0.3);
  v.noise('pink', bp, t, e1 + 0.01);

  const g2 = v.gain(0, v.out);
  const e2 = swell(g2.gain, t, 0.3, 0.022, 0.3, 0.35);
  const s = v.osc('sine', mtof(65) * p, g2, t, e2 + 0.02);
  glide(s.frequency, t, mtof(65) * p, mtof(72) * p, 0.8);

  [84, 89, 93].forEach((m, i) => {
    const ts = t + 0.55 + i * 0.15;
    const gs = v.gain(0, v.out);
    const es = perc(gs.gain, ts, 0.002, 0.022, 0.18);
    v.osc('sine', mtof(m) * p, gs, ts, es + 0.02);
  });
};

/** Camera mode transition: soft band-passed whoosh panning left to right, plus air. */
export const transitionWhoosh: Recipe = (v, t, o) => {
  const p = o.pitch;
  const pan = v.panner(-0.45, v.out);

  const g = v.gain(0, pan.node);
  const bp = v.filter('bandpass', 340 * p, 0.8, g);
  bp.frequency.setValueAtTime(340 * p, t);
  bp.frequency.exponentialRampToValueAtTime(1900 * p, t + 0.22);
  bp.frequency.exponentialRampToValueAtTime(650 * p, t + 0.52);
  const e1 = swell(g.gain, t, 0.2, 0.42, 0.04, 0.3);
  v.noise('pink', bp, t, e1 + 0.01, 0.9);

  const g2 = v.gain(0, pan.node);
  const hp = v.filter('highpass', 4200, 0.7, g2);
  const e2 = swell(g2.gain, t + 0.05, 0.18, 0.05, 0.02, 0.25);
  v.noise('white', hp, t, e2 + 0.01);

  if (pan.param) {
    pan.param.setValueAtTime(-0.45, t);
    pan.param.linearRampToValueAtTime(0.45, t + 0.5);
  }
};

/** Truck suspension creak: stick-slip sawtooth through two resonances + spring settle. */
export const truckCreak: Recipe = (v, t, o) => {
  const p = o.pitch;
  const dur = rnd(0.22, 0.3);
  const g = v.gain(0, v.out);
  const bp1 = v.filter('bandpass', 900 * p, 8, g);
  const bp2 = v.filter('bandpass', 1650 * p, 10, g);
  const e1 = swell(g.gain, t, 0.03, 0.5, dur * 0.5, dur * 0.4);
  const saw = v.osc('sawtooth', 26 * p, bp1, t, e1 + 0.02);
  saw.connect(bp2);
  saw.frequency.setValueAtTime(26 * p, t);
  saw.frequency.linearRampToValueAtTime(44 * p, t + dur * 0.45);
  saw.frequency.linearRampToValueAtTime(30 * p, t + dur);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, 0.01, 0.08, 0.28);
  const s = v.osc('triangle', 150 * p, g2, t, e2 + 0.02);
  glide(s.frequency, t, 150 * p, 120 * p, 0.25);

  knock(v, t + 0.01, 2100 * p, 0.03, 0.02);
};

// ---------------------------------------------------------------------------
// Ambience + music one-shots
// ---------------------------------------------------------------------------

/**
 * Distant songbird. variant % 4 picks the species pattern: "tsee-tsee",
 * "fee-bee" whistle, descending trill, "chirrup". One oscillator per call.
 */
export const birdCall: Recipe = (v, t, o) => {
  const s = o.pitch;
  const lp = v.filter('lowpass', 5200, 0.5, v.out);
  const g = v.gain(0, lp);
  const osc = v.osc('sine', 3000 * s, g, t);
  const f = osc.frequency;
  let end: number;

  switch (o.variant % 4) {
    case 0: {
      const count = Math.random() < 0.5 ? 2 : 3;
      const times: number[] = [];
      const peaks: number[] = [];
      let ti = t;
      for (let i = 0; i < count; i++) {
        f.setValueAtTime(3100 * s, ti);
        f.exponentialRampToValueAtTime(4300 * s, ti + 0.07);
        times.push(ti);
        peaks.push(0.036 * rnd(0.8, 1));
        ti += rnd(0.12, 0.16);
      }
      end = spikes(g.gain, times, peaks, 0.012, 0.075);
      break;
    }
    case 1: {
      f.setValueAtTime(3350 * s, t);
      f.linearRampToValueAtTime(3200 * s, t + 0.2);
      f.setValueAtTime(2700 * s, t + 0.26);
      f.linearRampToValueAtTime(2580 * s, t + 0.5);
      const gg = g.gain;
      gg.setValueAtTime(0, t);
      gg.linearRampToValueAtTime(0.03, t + 0.04);
      gg.linearRampToValueAtTime(0.024, t + 0.17);
      gg.linearRampToValueAtTime(0, t + 0.22);
      gg.setValueAtTime(0, t + 0.26);
      gg.linearRampToValueAtTime(0.028, t + 0.3);
      gg.linearRampToValueAtTime(0.02, t + 0.44);
      gg.linearRampToValueAtTime(0, t + 0.52);
      end = t + 0.53;
      const vib = v.gain(20 * s, f);
      v.osc('sine', rnd(20, 28), vib, t, end + 0.02);
      break;
    }
    case 2: {
      const count = 5 + Math.floor(Math.random() * 3);
      const times: number[] = [];
      const peaks: number[] = [];
      for (let i = 0; i < count; i++) {
        const ti = t + i * 0.055;
        const k = 1 - 0.025 * i;
        f.setValueAtTime(4300 * s * k, ti);
        f.exponentialRampToValueAtTime(3400 * s * k, ti + 0.04);
        times.push(ti);
        peaks.push(0.03 * (1 - 0.06 * i));
      }
      end = spikes(g.gain, times, peaks, 0.004, 0.04);
      break;
    }
    default: {
      const reps = Math.random() < 0.5 ? 2 : 1;
      const times: number[] = [];
      const peaks: number[] = [];
      for (let r = 0; r < reps; r++) {
        const ti = t + r * 0.22;
        f.setValueAtTime(2600 * s, ti);
        f.exponentialRampToValueAtTime(3600 * s, ti + 0.06);
        f.exponentialRampToValueAtTime(2900 * s, ti + 0.15);
        times.push(ti);
        peaks.push(0.034);
      }
      end = spikes(g.gain, times, peaks, 0.02, 0.14);
      break;
    }
  }
  v.stopAt(osc, end + 0.02);
};

/**
 * Music pad voice: triangle + slightly detuned sine through a warm low-pass,
 * 2.4 s attack, hold for `length`, 3.2 s release (overlaps the next chord).
 */
export function padNote(v: Voice, t: number, freq: number, length: number, peak: number): void {
  const attack = 2.4;
  const release = 3.2;
  const hold = Math.max(0.1, length - attack);
  const end = t + attack + hold + release;

  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', 1000, 0.5, g);
  v.osc('triangle', freq, v.gain(0.6, lp), t, end + 0.05);
  const s = v.osc('sine', freq, v.gain(0.4, lp), t, end + 0.05);
  s.detune.value = rnd(4, 9) * (Math.random() < 0.5 ? -1 : 1);

  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.linearRampToValueAtTime(0, end);
}

/** Music arpeggio note: soft triangle pluck with a faint octave, long decay. */
export function pluckNote(v: Voice, t: number, freq: number, peak: number): void {
  const g = v.gain(0, v.out);
  const lp = v.filter('lowpass', 1900, 0.5, g);
  const e1 = perc(g.gain, t, 0.035, peak, 2.3);
  v.osc('triangle', freq, lp, t, e1 + 0.02);

  const g2 = v.gain(0, v.out);
  const e2 = perc(g2.gain, t, 0.02, peak * 0.18, 0.9);
  v.osc('sine', freq * 2, g2, t, e2 + 0.02);
}

// ---------------------------------------------------------------------------
// Persistent loops (built once after unlock; the manager drives the params)
// ---------------------------------------------------------------------------

export interface ParamRatio {
  param: AudioParam;
  ratio: number;
}

export interface BladeLoop {
  /** Motor hum level (0 = silent). */
  motorAmp: AudioParam;
  /** Motor oscillator frequencies; set each to f0 * ratio. */
  motorFreqs: ParamRatio[];
  /** Motor brightness (low-pass cutoff, Hz). */
  motorCutoff: AudioParam;
  /** Cutting load rasp level (0 = silent). */
  loadAmp: AudioParam;
  /** Rasp band centre (Hz). */
  loadCenter: AudioParam;
  /** Rasp amplitude-modulation rate (Hz), roughly the blade-pass rate. */
  raspRate: AudioParam;
}

/**
 * Blade motor: sawtooth + detuned triangle octave through a low-pass, sub sine,
 * a faint disc "whirr" partial and a slow mechanical flutter.
 * Blade load: pink noise high-passed/band-passed (rasp) + a mid "chew" band,
 * amplitude-modulated at the blade-pass rate.
 */
export function buildBladeLoop(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode): BladeLoop {
  const motorAmp = mkGain(ctx, 0, dest);
  const flutter = mkGain(ctx, 0.88, motorAmp);
  const lp = mkFilter(ctx, 'lowpass', 700, 0.8, flutter);
  const saw = mkOsc(ctx, 'sawtooth', BLADE_F0, mkGain(ctx, 0.45, lp));
  const tri = mkOsc(ctx, 'triangle', BLADE_F0 * 2, mkGain(ctx, 0.3, lp));
  tri.detune.value = 6;
  const sub = mkOsc(ctx, 'sine', BLADE_F0 * 0.5, mkGain(ctx, 0.35, flutter));
  const whirr = mkOsc(ctx, 'sine', BLADE_F0 * 7.5, mkGain(ctx, 0.035, flutter));
  mkOsc(ctx, 'triangle', 8.5, mkGain(ctx, 0.1, flutter.gain));

  const loadAmp = mkGain(ctx, 0, dest);
  const rasp = mkGain(ctx, 0.7, loadAmp);
  const raspLfo = mkOsc(ctx, 'sawtooth', 32, mkGain(ctx, 0.3, rasp.gain));
  const hp = mkFilter(ctx, 'highpass', 900, 0.7, rasp);
  const bp = mkFilter(ctx, 'bandpass', 2600, 0.9, hp);
  mkNoiseLoop(ctx, bank.pink, bp, 1);
  const chew = mkFilter(ctx, 'bandpass', 520, 1.2, mkGain(ctx, 0.5, rasp));
  mkNoiseLoop(ctx, bank.pink, chew, 0.93);

  return {
    motorAmp: motorAmp.gain,
    motorFreqs: [
      { param: saw.frequency, ratio: 1 },
      { param: tri.frequency, ratio: 2 },
      { param: sub.frequency, ratio: 0.5 },
      { param: whirr.frequency, ratio: 7.5 },
    ],
    motorCutoff: lp.frequency,
    loadAmp: loadAmp.gain,
    loadCenter: bp.frequency,
    raspRate: raspLfo.frequency,
  };
}

export interface VacuumLoop {
  whooshAmp: AudioParam;
  whooshCenter: AudioParam;
  hissAmp: AudioParam;
  humAmp: AudioParam;
  humFreq: AudioParam;
}

/**
 * Vacuum: wobbling band-passed pink "whoosh", a high white-noise hiss that
 * grows with intake, and a quiet fan-motor hum.
 */
export function buildVacuumLoop(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode): VacuumLoop {
  const whooshAmp = mkGain(ctx, 0, dest);
  const wobble = mkGain(ctx, 1, whooshAmp);
  mkOsc(ctx, 'sine', 0.23, mkGain(ctx, 0.09, wobble.gain));
  const lp = mkFilter(ctx, 'lowpass', 4200, 0.5, wobble);
  const bp = mkFilter(ctx, 'bandpass', 750, 0.65, lp);
  mkOsc(ctx, 'sine', 0.37, mkGain(ctx, 80, bp.frequency));
  mkNoiseLoop(ctx, bank.pink, bp, 1.03);

  const hissAmp = mkGain(ctx, 0, dest);
  const hp = mkFilter(ctx, 'highpass', 3600, 0.6, hissAmp);
  mkNoiseLoop(ctx, bank.white, hp, 1);

  const humAmp = mkGain(ctx, 0, dest);
  const humLp = mkFilter(ctx, 'lowpass', 480, 0.7, humAmp);
  const hum = mkOsc(ctx, 'sawtooth', 140, humLp);

  return {
    whooshAmp: whooshAmp.gain,
    whooshCenter: bp.frequency,
    hissAmp: hissAmp.gain,
    humAmp: humAmp.gain,
    humFreq: hum.frequency,
  };
}

export interface TruckLoop {
  amp: AudioParam;
  /** Null when StereoPannerNode is unavailable. */
  pan: AudioParam | null;
  freqs: ParamRatio[];
  cutoff: AudioParam;
}

/**
 * Truck engine: low-passed sawtooth + half-rate square, amplitude "chug" at the
 * firing rate, brown-noise rumble and a touch of mid rattle, through a panner.
 */
export function buildTruckLoop(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode): TruckLoop {
  let out: AudioNode = dest;
  let pan: AudioParam | null = null;
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.connect(dest);
    out = p;
    pan = p.pan;
  }
  const amp = mkGain(ctx, 0, out);
  const chug = mkGain(ctx, 0.7, amp);
  const lp = mkFilter(ctx, 'lowpass', 300, 1.1, chug);
  const saw = mkOsc(ctx, 'sawtooth', TRUCK_F0, mkGain(ctx, 0.5, lp));
  const sq = mkOsc(ctx, 'square', TRUCK_F0 * 0.5, mkGain(ctx, 0.25, lp));
  const firing = mkOsc(ctx, 'sine', TRUCK_F0 * 0.5, mkGain(ctx, 0.3, chug.gain));
  const rumble = mkFilter(ctx, 'lowpass', 240, 0.7, mkGain(ctx, 0.45, chug));
  mkNoiseLoop(ctx, bank.brown, rumble, 1);
  const rattle = mkFilter(ctx, 'bandpass', 1300, 1.6, mkGain(ctx, 0.2, amp));
  mkNoiseLoop(ctx, bank.pink, rattle, 0.97);

  return {
    amp: amp.gain,
    pan,
    freqs: [
      { param: saw.frequency, ratio: 1 },
      { param: sq.frequency, ratio: 0.5 },
      { param: firing.frequency, ratio: 0.5 },
    ],
    cutoff: lp.frequency,
  };
}

export interface WindLoop {
  /** Gust multiplier (1 = calm). */
  gust: AudioParam;
  /** Centre of the airy grass-hiss layer (base WIND_WHISTLE_HZ). */
  whistleCenter: AudioParam;
}

/**
 * Gentle wind: broad band-passed pink body + airy grass hiss + low brown body,
 * each with slow, incommensurate LFOs on level and filter so it never loops
 * audibly. Gusts are scheduled by the manager on `gust`.
 */
export function buildWindLoop(ctx: BaseAudioContext, bank: NoiseBank, dest: AudioNode): WindLoop {
  const gust = mkGain(ctx, 1, dest);

  const aAmp = mkGain(ctx, 0.11, gust);
  mkOsc(ctx, 'sine', 0.071, mkGain(ctx, 0.035, aAmp.gain));
  const aBp = mkFilter(ctx, 'bandpass', 520, 0.7, aAmp);
  mkOsc(ctx, 'sine', 0.113, mkGain(ctx, 170, aBp.frequency));
  mkNoiseLoop(ctx, bank.pink, aBp, 0.97);

  const bAmp = mkGain(ctx, 0.07, gust);
  mkOsc(ctx, 'sine', 0.052, mkGain(ctx, 0.035, bAmp.gain));
  const bBp = mkFilter(ctx, 'bandpass', WIND_WHISTLE_HZ, 1.8, bAmp);
  mkOsc(ctx, 'sine', 0.083, mkGain(ctx, 280, bBp.frequency));
  mkNoiseLoop(ctx, bank.pink, bBp, 1.06);

  const low = mkFilter(ctx, 'lowpass', 170, 0.6, mkGain(ctx, 0.035, gust));
  mkNoiseLoop(ctx, bank.brown, low, 1);

  return { gust: gust.gain, whistleCenter: bBp.frequency };
}

/**
 * Music send: dry path plus a damped feedback echo (0.43 s) for a sense of
 * space. Returns the input node music voices should connect to.
 */
export function buildEchoSend(ctx: BaseAudioContext, dest: AudioNode): AudioNode {
  const input = mkGain(ctx, 1, dest);
  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = 0.43;
  input.connect(delay);
  const damp = mkFilter(ctx, 'lowpass', 1600, 0.5, mkGain(ctx, 0.3, delay));
  delay.connect(damp);
  delay.connect(mkGain(ctx, 0.28, dest));
  return input;
}
