/**
 * AudioManager — owns the single AudioContext, the bus graph, the persistent
 * loops, one-shot voice bookkeeping (polyphony cap + cleanup), rate limiting
 * and the ambience / music schedulers. Synthesis lives in ProceduralSounds.
 *
 * Graph:
 *   one-shots ──────────────┐
 *   loopBus (harvest+truck) ┴→ sfx ──────┐
 *   wind + birds ─────────────→ ambience ─┼→ master → headroom(0.8) → compressor → fade → out
 *   music voices → echo send ─→ music ────┘
 *
 * `loopBus` fades harvest loops + truck on pause; `fade` handles unlock /
 * tab-hidden fades. Nothing public ever throws; everything is a no-op until
 * `unlock()` succeeds.
 */
import * as PS from './ProceduralSounds';

export type AudioBus = 'master' | 'sfx' | 'ambience' | 'music';

export type SfxName =
  | 'cut' | 'toolSwap' | 'vacuumTick' | 'pack' | 'pickup' | 'drop' | 'cash'
  | 'upgrade' | 'levelUp' | 'uiClick' | 'uiDisabled' | 'footstep' | 'reachTap'
  | 'full' | 'replant' | 'goal' | 'transition' | 'hire' | 'truckLoad';

export interface AudioSettings {
  master: number; // 0..1
  sfx: number; // 0..1
  ambience: number; // 0..1
  music: number; // 0..1
  muted: boolean;
}

export type AudioState = 'uninitialized' | 'running' | 'suspended' | 'failed';

export interface PlayOptions {
  intensity?: number; // meaning depends on sound (cut: cells in batch; vacuumTick: units in batch; cash: 0..1 size)
  pitch?: number; // multiplier, default 1 (pickup uses it for rising steps)
  pan?: number; // -1..1
  volume?: number; // extra multiplier, default 1
}

export interface HarvestLoopParams {
  inHarvest: boolean; // false => all harvest loops fade out
  bladeActive: boolean; // blade mode active (not while switching)
  bladeLoad: number; // 0..1 smoothed cutting density
  bladeLevel: number; // 1..6 upgrade level: slightly stronger/brighter motor at higher levels
  vacuumActive: boolean;
  vacuumIntake: number; // 0..1 how much is actually being sucked right now
  vacuumLevel: number; // 1..6
  toolSpeed: number; // 0..1 tool movement speed (motor revs up slightly with motion)
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const MAX_VOICES = 24;
const MASTER_HEADROOM = 0.8;
const START_LATENCY = 0.008; // schedule one-shots slightly ahead to avoid past-time jumps

const BUS_TAU = 0.03; // settings changes
const LOOP_TAU = 0.06; // loop gains (tool crossfade)
const PARAM_TAU = 0.045; // pitch / filter smoothing
const FADE_TAU = 0.04; // pause / hide fade: ~120 ms to -26 dB
const HIDE_SUSPEND_DELAY_MS = 180;

const PAUSED_AMBIENCE = 0.55;
const PAUSED_MUSIC = 0.8;

// Grass-cut burst limiter: ~15/s; excess folds into the blade-load loop.
const CUT_MIN_GAP = 1 / 18;
const CUT_MAX_PER_SEC = 16;
// Vacuum grain limiter; excess folds into the vacuum intake level.
const VAC_MIN_GAP = 1 / 16;
const VAC_MAX_PER_SEC = 14;
const OVERFLOW_DECAY = 2.6; // 1/s
const OVERFLOW_MAX = 0.6;

// Cash stacking: rapid calls climb an F-major pentatonic ladder from A5.
const CASH_STACK_WINDOW = 0.4;
const CASH_LADDER = [0, 3, 5, 8, 10, 12];

// Music: F-major, one pad chord every MUSIC_CHORD_LEN s, sparse pentatonic plucks.
const MUSIC_CHORD_LEN = 9.6;
const MUSIC_CHORDS: readonly (readonly number[])[] = [
  [53, 60, 69], // F  (F3 C4 A4)
  [50, 57, 65], // Dm (D3 A3 F4)
  [46, 53, 62], // Bb (Bb2 F3 D4)
  [48, 55, 65], // Csus4 (C3 G3 F4)
];
const ARP_POOL = [65, 67, 69, 72, 74, 77, 79, 81]; // F G A C D F G A
const ARP_STEPS = [-2, -1, -1, 1, 1, 2];

interface SfxDef {
  recipe: PS.Recipe;
  /** 0 = footsteps/birds, 1 = continuous-ish gameplay, 2 = discrete feedback, 3 = celebrations. */
  priority: number;
  /** Minimum seconds between accepted triggers of this sound (debounce). */
  minGap: number;
  /** Random pitch spread (± fraction). Musical cues use 0 and vary by voicing instead. */
  pitchVar: number;
  /** Mix trim. */
  trim: number;
  /** Default intensity when the caller passes none. */
  intensity: number;
}

const SFX_DEFS: Record<SfxName, SfxDef> = {
  cut: { recipe: PS.grassCut, priority: 1, minGap: 0, pitchVar: 0.08, trim: 1, intensity: 1 },
  vacuumTick: { recipe: PS.vacuumGrains, priority: 1, minGap: 0, pitchVar: 0.08, trim: 1, intensity: 1 },
  toolSwap: { recipe: PS.toolSwap, priority: 2, minGap: 0.1, pitchVar: 0.05, trim: 1, intensity: 1 },
  pack: { recipe: PS.balePack, priority: 2, minGap: 0.08, pitchVar: 0.06, trim: 1, intensity: 1 },
  pickup: { recipe: PS.balePickup, priority: 2, minGap: 0.06, pitchVar: 0.025, trim: 1, intensity: 1 },
  drop: { recipe: PS.baleDrop, priority: 2, minGap: 0.05, pitchVar: 0.06, trim: 1, intensity: 1 },
  cash: { recipe: PS.cashTick, priority: 2, minGap: 0.035, pitchVar: 0, trim: 1, intensity: 0.3 },
  upgrade: { recipe: PS.upgradeChord, priority: 3, minGap: 0.15, pitchVar: 0, trim: 1, intensity: 1 },
  levelUp: { recipe: PS.levelUpFanfare, priority: 3, minGap: 0.3, pitchVar: 0, trim: 1, intensity: 1 },
  uiClick: { recipe: PS.uiClick, priority: 2, minGap: 0.03, pitchVar: 0.05, trim: 0.9, intensity: 1 },
  uiDisabled: { recipe: PS.uiDisabled, priority: 2, minGap: 0.08, pitchVar: 0.04, trim: 0.9, intensity: 1 },
  footstep: { recipe: PS.footstep, priority: 0, minGap: 0.09, pitchVar: 0.1, trim: 0.9, intensity: 1 },
  reachTap: { recipe: PS.reachTap, priority: 1, minGap: 0.4, pitchVar: 0.05, trim: 1, intensity: 1 },
  full: { recipe: PS.fullTick, priority: 2, minGap: 0.45, pitchVar: 0.03, trim: 1, intensity: 1 },
  replant: { recipe: PS.replantRustle, priority: 2, minGap: 0.3, pitchVar: 0.05, trim: 1, intensity: 1 },
  goal: { recipe: PS.goalDing, priority: 3, minGap: 0.2, pitchVar: 0, trim: 1, intensity: 1 },
  transition: { recipe: PS.transitionWhoosh, priority: 2, minGap: 0.2, pitchVar: 0.06, trim: 1, intensity: 1 },
  hire: { recipe: PS.hireJingle, priority: 3, minGap: 0.3, pitchVar: 0, trim: 1, intensity: 1 },
  truckLoad: { recipe: PS.truckCreak, priority: 1, minGap: 0.12, pitchVar: 0.08, trim: 1, intensity: 1 },
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type VoicePool = 'sfx' | 'music';

interface LiveVoice {
  out: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  start: number;
  end: number;
  priority: number;
  pool: VoicePool;
  stolen: boolean;
  done: boolean;
}

/** setTargetAtTime wrapper that skips redundant per-frame automation. */
class Smoother {
  private last = Number.NaN;

  constructor(
    private readonly param: AudioParam,
    private readonly tau: number,
    private readonly eps: number,
    private readonly relative: boolean,
  ) {}

  set(ctx: BaseAudioContext, target: number): void {
    const tol = this.relative ? this.eps * Math.max(1, Math.abs(target)) : this.eps;
    const forceZero = target === 0 && this.last !== 0;
    if (!forceZero && Math.abs(target - this.last) <= tol) return;
    this.last = target;
    this.param.setTargetAtTime(target, ctx.currentTime, this.tau);
  }
}

interface ScaledSmoother {
  s: Smoother;
  ratio: number;
}

interface LoopSmoothers {
  motorAmp: Smoother;
  motorFreqs: ScaledSmoother[];
  motorCutoff: Smoother;
  loadAmp: Smoother;
  loadCenter: Smoother;
  raspRate: Smoother;
  vacAmp: Smoother;
  vacCenter: Smoother;
  vacHiss: Smoother;
  vacHum: Smoother;
  vacHumFreq: Smoother;
  truckAmp: Smoother;
  truckFreqs: ScaledSmoother[];
  truckCutoff: Smoother;
  truckPan: Smoother | null;
}

interface Graph {
  ctx: AudioContext;
  bank: PS.NoiseBank;
  fade: GainNode;
  master: GainNode;
  sfx: GainNode;
  ambience: GainNode;
  music: GainNode;
  musicIn: AudioNode;
  loopBus: GainNode;
  wind: PS.WindLoop;
  sm: LoopSmoothers;
  hasPanner: boolean;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const c01 = (x: unknown): number => clamp(num(x, 0), 0, 1);
const nowSec = (): number => performance.now() / 1000;

function sanitize(s: AudioSettings | null | undefined): AudioSettings {
  if (!s) return { master: 1, sfx: 1, ambience: 1, music: 1, muted: false };
  return { master: c01(s.master), sfx: c01(s.sfx), ambience: c01(s.ambience), music: c01(s.music), muted: !!s.muted };
}

function pruneWindow(times: number[], now: number): void {
  while (times.length > 0 && now - times[0] > 1) times.shift();
}

function newContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

/** Resolves after resume settles or `ms` elapses; never rejects. */
function resumeWithTimeout(ctx: AudioContext, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    try {
      ctx.resume().then(done, done);
    } catch {
      done();
    }
  });
}

/** Plays one silent sample inside the gesture (unlocks output on iOS Safari). */
function primeOutput(ctx: AudioContext): void {
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.onended = () => s.disconnect();
    s.start(0);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  /** Called whenever `state` changes (e.g. to show/hide an "Enable audio" button). */
  onStateChange: ((s: AudioState) => void) | null = null;
  /** Not implemented on purpose: footsteps are triggered via play('footstep'). */
  setFootstepRate?: never;

  private settings: AudioSettings;
  private readonly busMuted: Record<AudioBus, boolean> = { master: false, sfx: false, ambience: false, music: false };
  private lastState: AudioState = 'uninitialized';
  private creationFailed = false;
  private g: Graph | null = null;
  private paused = false;
  private hidden = false;
  private visibilityGen = 0;

  private readonly sfxVoices: LiveVoice[] = [];
  private readonly musicVoices: LiveVoice[] = [];
  private droppedVoices = 0;

  private readonly lastPlayed: Partial<Record<SfxName, number>> = {};
  private readonly variants: Partial<Record<SfxName, number>> = {};
  private readonly cutTimes: number[] = [];
  private readonly vacTimes: number[] = [];
  private lastCut = Number.NEGATIVE_INFINITY;
  private lastVac = Number.NEGATIVE_INFINITY;
  private cutOverflow = 0;
  private vacOverflow = 0;
  private cashStep = 0;
  private lastCash = Number.NEGATIVE_INFINITY;
  private footLeft = false;

  private birdTimer = rnd(4, 9);
  private gustTimer = rnd(5, 10);
  private readonly music = { active: false, chordAt: 0, noteAt: 0, chord: 0, arp: 3 };

  constructor(settings: AudioSettings) {
    this.settings = sanitize(settings);
  }

  get state(): AudioState {
    return this.computeState();
  }

  // ----- lifecycle ---------------------------------------------------------

  /** Create/resume the context. Call from a user gesture. Resolves true if running. */
  async unlock(): Promise<boolean> {
    try {
      if (!this.g) {
        this.g = this.createGraph();
        this.creationFailed = this.g === null;
      }
      const g = this.g;
      if (g && g.ctx.state !== 'running') {
        primeOutput(g.ctx);
        // resume() is invoked synchronously here, i.e. still inside the gesture.
        await resumeWithTimeout(g.ctx, 900);
      }
    } catch {
      /* never throw */
    }
    this.refreshState();
    const g = this.g;
    if (g && g.ctx.state === 'running') {
      if (!this.hidden) this.fadeIn(g);
      return true;
    }
    return false;
  }

  applySettings(s: AudioSettings): void {
    this.settings = sanitize(s);
    const g = this.g;
    if (!g) return;
    try {
      this.applyBusGains(g, false);
    } catch {
      /* ignore */
    }
  }

  setBusMuted(bus: AudioBus, muted: boolean): void {
    this.busMuted[bus] = !!muted;
    const g = this.g;
    if (!g) return;
    try {
      this.applyBusGains(g, false);
    } catch {
      /* ignore */
    }
  }

  /** Game paused (modal): harvest loops + truck fade out, ambience ducks, music continues softly. */
  setPaused(paused: boolean): void {
    this.paused = !!paused;
    const g = this.g;
    if (!g) return;
    try {
      g.loopBus.gain.setTargetAtTime(this.paused ? 0 : 1, g.ctx.currentTime, this.paused ? FADE_TAU : 0.06);
      this.applyBusGains(g, false);
    } catch {
      /* ignore */
    }
  }

  /** Tab hidden: fade master out, then suspend. Visible again: resume + fade in. */
  setHidden(hidden: boolean): void {
    const h = !!hidden;
    if (h === this.hidden) return;
    this.hidden = h;
    const g = this.g;
    if (!g) return;
    const gen = ++this.visibilityGen;
    const ctx = g.ctx;
    try {
      if (h) {
        g.fade.gain.setTargetAtTime(0, ctx.currentTime, FADE_TAU);
        setTimeout(() => {
          if (gen !== this.visibilityGen || !this.hidden || ctx.state !== 'running') return;
          ctx.suspend().then(
            () => this.refreshState(),
            () => this.refreshState(),
          );
        }, HIDE_SUSPEND_DELAY_MS);
      } else if (ctx.state === 'running') {
        this.fadeIn(g);
      } else {
        // May be refused without a gesture; state stays 'suspended' so the UI can offer a button.
        ctx.resume().then(
          () => this.refreshState(),
          () => this.refreshState(),
        );
      }
    } catch {
      this.refreshState();
    }
  }

  // ----- one-shots ---------------------------------------------------------

  play(name: SfxName, opts?: PlayOptions): void {
    const g = this.g;
    if (!g || this.hidden || g.ctx.state !== 'running') return;
    if (!this.busAudible('sfx')) return;
    const def = SFX_DEFS[name];
    if (!def) return;
    try {
      this.playInner(g, name, def, opts);
    } catch {
      /* audio must never break gameplay */
    }
  }

  private playInner(g: Graph, name: SfxName, def: SfxDef, opts: PlayOptions | undefined): void {
    const now = nowSec();
    let intensity = num(opts?.intensity, def.intensity);
    let pitch = clamp(num(opts?.pitch, 1), 0.25, 4);
    let volume = clamp(num(opts?.volume, 1), 0, 2);
    let pan = clamp(num(opts?.pan, 0), -1, 1);
    if (volume <= 0) return;

    if (name === 'cut') {
      intensity = clamp(intensity, 1, 30);
      pruneWindow(this.cutTimes, now);
      if (now - this.lastCut < CUT_MIN_GAP || this.cutTimes.length >= CUT_MAX_PER_SEC) {
        // Too many bursts: thicken the continuous blade-load layer instead.
        this.cutOverflow = Math.min(OVERFLOW_MAX, this.cutOverflow + 0.035 + 0.02 * Math.log2(1 + intensity));
        return;
      }
      this.lastCut = now;
      this.cutTimes.push(now);
    } else if (name === 'vacuumTick') {
      intensity = clamp(intensity, 1, 40);
      pruneWindow(this.vacTimes, now);
      if (now - this.lastVac < VAC_MIN_GAP || this.vacTimes.length >= VAC_MAX_PER_SEC) {
        this.vacOverflow = Math.min(OVERFLOW_MAX, this.vacOverflow + 0.03 + 0.015 * Math.log2(1 + intensity));
        return;
      }
      this.lastVac = now;
      this.vacTimes.push(now);
    } else {
      const last = this.lastPlayed[name];
      if (last !== undefined && now - last < def.minGap) return;
      this.lastPlayed[name] = now;
    }

    if (name === 'cash') {
      this.cashStep = now - this.lastCash < CASH_STACK_WINDOW ? this.cashStep + 1 : 0;
      this.lastCash = now;
      const step = this.cashStep;
      const semis = step < CASH_LADDER.length ? CASH_LADDER[step] : step % 2 === 0 ? 12 : 8;
      pitch *= Math.pow(2, semis / 12);
      volume *= 1 / (1 + 0.07 * Math.min(step, 6)); // long count-ups get gentler
    } else if (name === 'footstep' && opts?.pan === undefined) {
      this.footLeft = !this.footLeft;
      pan = this.footLeft ? -0.08 : 0.08;
    }

    const variant = this.nextVariant(name);
    const p = pitch * (1 + (Math.random() * 2 - 1) * def.pitchVar);
    const gain = def.trim * volume * (1 + (Math.random() * 2 - 1) * 0.1);
    const recipeOpts: PS.RecipeOpts = { intensity, pitch: p, variant };
    this.spawn(g, g.sfx, (v, t) => def.recipe(v, t, recipeOpts), gain, pan, def.priority, 'sfx');
  }

  /** Rotating variant counter: +1 usually, occasionally +2, so `variant % n` rarely repeats. */
  private nextVariant(name: SfxName): number {
    const last = this.variants[name] ?? Math.floor(Math.random() * 12);
    const next = (last + 1 + (Math.random() < 0.35 ? 1 : 0)) % 1_000_000;
    this.variants[name] = next;
    return next;
  }

  /**
   * Builds a voice into `dest` and tracks it until all its sources end, then
   * disconnects everything. SFX voices obey the polyphony cap.
   */
  private spawn(
    g: Graph,
    dest: AudioNode,
    build: (v: PS.Voice, t: number) => void,
    gain: number,
    pan: number,
    priority: number,
    pool: VoicePool,
    at?: number,
  ): boolean {
    if (pool === 'sfx' && this.activeSfxCount() >= MAX_VOICES && !this.stealFor(g, priority)) {
      this.droppedVoices++;
      return false;
    }
    const ctx = g.ctx;
    const t = Math.max(ctx.currentTime + START_LATENCY, at ?? 0);
    const out = ctx.createGain();
    out.gain.value = gain;
    const nodes: AudioNode[] = [out];
    let tail: AudioNode = out;
    if (pan !== 0 && g.hasPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      nodes.push(p);
      tail = p;
    }
    tail.connect(dest);

    const v = new PS.Voice(ctx, out, g.bank);
    const live: LiveVoice = {
      out,
      nodes,
      sources: v.sources,
      start: t,
      end: t,
      priority,
      pool,
      stolen: false,
      done: false,
    };
    try {
      build(v, t);
    } catch {
      for (const s of v.sources) {
        try {
          s.stop();
        } catch {
          /* ignore */
        }
      }
      live.nodes = nodes.concat(v.nodes);
      this.release(live);
      return false;
    }
    live.nodes = nodes.concat(v.nodes);
    live.end = v.end;
    if (v.sources.length === 0) {
      this.release(live);
      return false;
    }

    let pending = v.sources.length;
    const onEnded = (): void => {
      pending -= 1;
      if (pending <= 0) this.release(live);
    };
    for (const s of v.sources) s.onended = onEnded;
    (pool === 'sfx' ? this.sfxVoices : this.musicVoices).push(live);
    return true;
  }

  private activeSfxCount(): number {
    let n = 0;
    for (const v of this.sfxVoices) if (!v.stolen) n++;
    return n;
  }

  /** Steals the oldest voice with strictly lower priority. Returns false if none. */
  private stealFor(g: Graph, priority: number): boolean {
    let victim: LiveVoice | null = null;
    for (const v of this.sfxVoices) {
      if (v.stolen || v.priority >= priority) continue;
      if (!victim || v.start < victim.start) victim = v;
    }
    if (!victim) return false;
    victim.stolen = true;
    const now = g.ctx.currentTime;
    victim.out.gain.setTargetAtTime(0, now, 0.012);
    const stopAt = now + 0.07;
    if (victim.end > stopAt) {
      for (const s of victim.sources) {
        try {
          s.stop(stopAt);
        } catch {
          /* ignore */
        }
      }
      victim.end = stopAt;
    }
    return true;
  }

  private release(v: LiveVoice): void {
    if (v.done) return;
    v.done = true;
    for (const s of v.sources) s.onended = null;
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    const list = v.pool === 'sfx' ? this.sfxVoices : this.musicVoices;
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1);
  }

  /** Safety net: force-release voices whose onended never arrived. */
  private reap(g: Graph): void {
    const now = g.ctx.currentTime;
    for (const list of [this.sfxVoices, this.musicVoices]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const v = list[i];
        if (now <= v.end + 1.5) continue;
        for (const s of v.sources) {
          try {
            s.stop();
          } catch {
            /* ignore */
          }
        }
        this.release(v);
      }
    }
  }

  // ----- continuous loops --------------------------------------------------

  setHarvestLoops(p: HarvestLoopParams): void {
    const g = this.g;
    if (!g || !p) return;
    try {
      const ctx = g.ctx;
      const sm = g.sm;
      const speed = c01(p.toolSpeed);

      // Blade motor + load rasp.
      const bladeOn = !!p.inHarvest && !!p.bladeActive;
      const bl = c01((num(p.bladeLevel, 1) - 1) / 5);
      const load = c01(num(p.bladeLoad, 0) + this.cutOverflow);
      const f0 = PS.BLADE_F0 * (1 + 0.06 * bl) * (1 + 0.07 * speed) * (1 - 0.035 * load);
      for (const m of sm.motorFreqs) m.s.set(ctx, f0 * m.ratio);
      sm.motorAmp.set(ctx, bladeOn ? 0.06 + 0.02 * bl + 0.02 * speed + 0.012 * load : 0);
      sm.motorCutoff.set(ctx, 520 + 380 * bl + 260 * speed + 300 * load);
      sm.loadAmp.set(ctx, bladeOn ? 0.34 * Math.pow(load, 0.8) : 0);
      sm.loadCenter.set(ctx, 1900 + 2100 * load + 400 * bl);
      sm.raspRate.set(ctx, f0 * 0.36);

      // Vacuum whoosh / hiss / hum.
      const vacOn = !!p.inHarvest && !!p.vacuumActive;
      const vl = c01((num(p.vacuumLevel, 1) - 1) / 5);
      const intake = c01(num(p.vacuumIntake, 0) + this.vacOverflow);
      sm.vacAmp.set(ctx, vacOn ? 0.16 + 0.03 * vl + 0.02 * speed + 0.08 * intake : 0);
      sm.vacCenter.set(ctx, 650 + 150 * vl + 220 * speed + 950 * intake);
      sm.vacHiss.set(ctx, vacOn ? 0.012 + 0.045 * intake + 0.008 * vl : 0);
      sm.vacHum.set(ctx, vacOn ? 0.03 + 0.01 * vl : 0);
      sm.vacHumFreq.set(ctx, 140 * (1 + 0.05 * vl) * (1 + 0.05 * speed + 0.04 * intake));
    } catch {
      /* ignore */
    }
  }

  setTruckEngine(level: number, pan = 0): void {
    const g = this.g;
    if (!g) return;
    try {
      const ctx = g.ctx;
      const sm = g.sm;
      const lv = c01(level);
      sm.truckAmp.set(ctx, lv > 0.001 ? 0.2 * Math.pow(lv, 0.6) : 0);
      const f = PS.TRUCK_F0 * (1 + 0.75 * lv);
      for (const m of sm.truckFreqs) m.s.set(ctx, f * m.ratio);
      sm.truckCutoff.set(ctx, 220 + 650 * lv);
      sm.truckPan?.set(ctx, clamp(num(pan, 0), -1, 1));
    } catch {
      /* ignore */
    }
  }

  // ----- per-frame ---------------------------------------------------------

  update(dt: number): void {
    const d = clamp(num(dt, 0), 0, 0.25);
    const decay = Math.exp(-d * OVERFLOW_DECAY);
    this.cutOverflow *= decay;
    this.vacOverflow *= decay;
    const now = nowSec();
    pruneWindow(this.cutTimes, now);
    pruneWindow(this.vacTimes, now);

    const g = this.g;
    if (!g || this.hidden || g.ctx.state !== 'running') return;
    try {
      this.reap(g);
      this.updateAmbience(g, d);
      this.updateMusic(g);
    } catch {
      /* ignore */
    }
  }

  getDebugInfo(): { state: AudioState; activeVoices: number; droppedVoices: number; cutBurstsLastSecond: number } {
    pruneWindow(this.cutTimes, nowSec());
    return {
      state: this.computeState(),
      activeVoices: this.activeSfxCount(),
      droppedVoices: this.droppedVoices,
      cutBurstsLastSecond: this.cutTimes.length,
    };
  }

  // ----- ambience & music --------------------------------------------------

  private updateAmbience(g: Graph, dt: number): void {
    const audible = this.busAudible('ambience');

    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = rnd(7, 15);
      if (audible) {
        const now = g.ctx.currentTime;
        const rise = rnd(0.7, 1.3);
        const hold = rnd(1.6, 3.0);
        g.wind.gust.setTargetAtTime(rnd(1.25, 1.7), now, rise);
        g.wind.gust.setTargetAtTime(1, now + hold, rnd(1.1, 1.8));
        g.wind.whistleCenter.setTargetAtTime(PS.WIND_WHISTLE_HZ * rnd(1.12, 1.35), now, rise);
        g.wind.whistleCenter.setTargetAtTime(PS.WIND_WHISTLE_HZ, now + hold, 1.5);
      }
    }

    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rnd(6, 18);
      if (audible) {
        this.spawnBird(g, 0);
        if (Math.random() < 0.3) this.spawnBird(g, rnd(0.5, 1.3)); // another bird answers
      }
    }
  }

  private spawnBird(g: Graph, delay: number): void {
    const opts: PS.RecipeOpts = { intensity: 1, pitch: rnd(0.88, 1.14), variant: Math.floor(Math.random() * 4) };
    this.spawn(
      g,
      g.ambience,
      (v, t) => PS.birdCall(v, t, opts),
      rnd(0.8, 1.1),
      rnd(-0.8, 0.8),
      0,
      'sfx',
      g.ctx.currentTime + START_LATENCY + delay,
    );
  }

  /** Look-ahead scheduler; schedules nothing while music is silent/muted. */
  private updateMusic(g: Graph): void {
    const m = this.music;
    if (!this.busAudible('music')) {
      m.active = false;
      return;
    }
    const now = g.ctx.currentTime;
    if (!m.active) {
      m.active = true;
      m.chordAt = now + 0.3;
      m.noteAt = now + rnd(1.8, 3.2);
    }
    // After a stall, restart instead of catching up.
    if (m.chordAt < now - 1) m.chordAt = now + 0.1;
    if (m.noteAt < now - 1) m.noteAt = now + 0.5;
    const horizon = now + 0.25;

    if (m.chordAt <= horizon) {
      const chord = MUSIC_CHORDS[m.chord % MUSIC_CHORDS.length];
      for (const note of chord) {
        const f = PS.mtof(note);
        const at = m.chordAt + rnd(0, 0.25);
        this.spawn(g, g.musicIn, (v, t) => PS.padNote(v, t, f, MUSIC_CHORD_LEN, 0.03), 1, rnd(-0.25, 0.25), 0, 'music', at);
      }
      m.chord = (m.chord + 1) % MUSIC_CHORDS.length;
      m.chordAt += MUSIC_CHORD_LEN;
    }

    if (m.noteAt <= horizon) {
      if (Math.random() < 0.8) {
        m.arp = clamp(m.arp + ARP_STEPS[Math.floor(Math.random() * ARP_STEPS.length)], 0, ARP_POOL.length - 1);
        const f = PS.mtof(ARP_POOL[m.arp]);
        const peak = rnd(0.04, 0.055);
        this.spawn(g, g.musicIn, (v, t) => PS.pluckNote(v, t, f, peak), 1, rnd(-0.4, 0.4), 0, 'music', m.noteAt);
      }
      m.noteAt += rnd(1.1, 2.9);
    }
  }

  // ----- graph / state -----------------------------------------------------

  private createGraph(): Graph | null {
    const ctx = newContext();
    if (!ctx) return null;
    try {
      const g = this.buildGraph(ctx);
      ctx.onstatechange = () => this.refreshState();
      return g;
    } catch {
      ctx.close().catch(() => undefined);
      return null;
    }
  }

  private buildGraph(ctx: AudioContext): Graph {
    const bank = PS.createNoiseBank(ctx);

    const fade = ctx.createGain();
    fade.gain.value = 0; // faded in once running
    fade.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(fade);
    const headroom = ctx.createGain();
    headroom.gain.value = MASTER_HEADROOM;
    headroom.connect(comp);

    const master = ctx.createGain();
    master.connect(headroom);
    const sfx = ctx.createGain();
    sfx.connect(master);
    const ambience = ctx.createGain();
    ambience.connect(master);
    const music = ctx.createGain();
    music.connect(master);
    const loopBus = ctx.createGain();
    loopBus.gain.value = this.paused ? 0 : 1;
    loopBus.connect(sfx);
    const musicIn = PS.buildEchoSend(ctx, music);

    const blade = PS.buildBladeLoop(ctx, bank, loopBus);
    const vac = PS.buildVacuumLoop(ctx, bank, loopBus);
    const truck = PS.buildTruckLoop(ctx, bank, loopBus);
    const wind = PS.buildWindLoop(ctx, bank, ambience);

    const gainS = (p: AudioParam, tau = LOOP_TAU): Smoother => new Smoother(p, tau, 0.0006, false);
    const freqS = (p: AudioParam): Smoother => new Smoother(p, PARAM_TAU, 0.002, true);
    const sm: LoopSmoothers = {
      motorAmp: gainS(blade.motorAmp),
      motorFreqs: blade.motorFreqs.map((m) => ({ s: freqS(m.param), ratio: m.ratio })),
      motorCutoff: freqS(blade.motorCutoff),
      loadAmp: gainS(blade.loadAmp, 0.05),
      loadCenter: freqS(blade.loadCenter),
      raspRate: freqS(blade.raspRate),
      vacAmp: gainS(vac.whooshAmp),
      vacCenter: freqS(vac.whooshCenter),
      vacHiss: gainS(vac.hissAmp, 0.05),
      vacHum: gainS(vac.humAmp),
      vacHumFreq: freqS(vac.humFreq),
      truckAmp: gainS(truck.amp, 0.08),
      truckFreqs: truck.freqs.map((m) => ({ s: freqS(m.param), ratio: m.ratio })),
      truckCutoff: freqS(truck.cutoff),
      truckPan: truck.pan ? new Smoother(truck.pan, 0.08, 0.005, false) : null,
    };

    const g: Graph = {
      ctx,
      bank,
      fade,
      master,
      sfx,
      ambience,
      music,
      musicIn,
      loopBus,
      wind,
      sm,
      hasPanner: typeof ctx.createStereoPanner === 'function',
    };
    this.applyBusGains(g, true);
    return g;
  }

  private applyBusGains(g: Graph, immediate: boolean): void {
    const s = this.settings;
    const m = this.busMuted;
    const targets: [AudioParam, number][] = [
      [g.master.gain, s.muted || m.master ? 0 : s.master],
      [g.sfx.gain, m.sfx ? 0 : s.sfx],
      [g.ambience.gain, m.ambience ? 0 : s.ambience * (this.paused ? PAUSED_AMBIENCE : 1)],
      [g.music.gain, m.music ? 0 : s.music * (this.paused ? PAUSED_MUSIC : 1)],
    ];
    const now = g.ctx.currentTime;
    for (const [param, value] of targets) {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, BUS_TAU);
    }
  }

  private busAudible(bus: 'sfx' | 'ambience' | 'music'): boolean {
    const s = this.settings;
    if (s.muted || s.master <= 0.001 || this.busMuted.master || this.busMuted[bus]) return false;
    return s[bus] > 0.001;
  }

  private fadeIn(g: Graph): void {
    try {
      g.fade.gain.setTargetAtTime(1, g.ctx.currentTime, 0.05);
    } catch {
      /* ignore */
    }
  }

  private computeState(): AudioState {
    const g = this.g;
    if (!g) return this.creationFailed ? 'failed' : 'uninitialized';
    const st = g.ctx.state as string;
    if (st === 'running') return 'running';
    if (st === 'closed') return 'failed';
    return 'suspended'; // 'suspended' or iOS 'interrupted'
  }

  private refreshState(): void {
    const next = this.computeState();
    if (next === this.lastState) return;
    this.lastState = next;
    if (next === 'running' && this.g && !this.hidden) this.fadeIn(this.g);
    const cb = this.onStateChange;
    if (!cb) return;
    try {
      cb(next);
    } catch (err) {
      console.warn('[audio] onStateChange handler threw', err);
    }
  }
}
