// Flexible hose between the machine reel and the tool head.
// Light Verlet chain (visual only — gameplay reach is enforced by Harvester) rendered as a
// tube whose vertices are rewritten in place each frame (no per-frame allocation).

import * as THREE from 'three';
import { PALETTE, TIER_COLORS } from '../config/palette';

const N = 18;
const SAMPLES = 72;
const RADIAL = 8;
const RADIUS = 0.085;
const GROUND = RADIUS * 0.9;

interface Pulse {
  s: number; // 0 = tool end, 1 = machine end
  speed: number;
  color: THREE.Color;
  size: number;
}

export class Hose {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(N * 3);
  private prev = new Float32Array(N * 3);
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private norAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private curvePts: THREE.Vector3[] = [];
  private curve: THREE.CatmullRomCurve3;
  private samples: THREE.Vector3[] = [];
  private pulses: Pulse[] = [];
  private pulsePool: Pulse[] = [];
  private base = new THREE.Color(PALETTE.cool);
  private dark = new THREE.Color('#3A7C78');
  private tautColor = new THREE.Color('#7CC3BD');
  private tmp = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpT = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private pulseCol = new THREE.Color();
  private acc = 0;
  private initialized = false;
  tension = 0;
  /** Current rest length (the reel pays out / reels in). */
  restLength = 2;

  constructor() {
    for (let i = 0; i < N; i++) this.curvePts.push(new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.curvePts, false, 'centripetal', 0.5);
    for (let i = 0; i <= SAMPLES; i++) this.samples.push(new THREE.Vector3());
    const vcount = (SAMPLES + 1) * (RADIAL + 1);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3);
    this.norAttr = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(vcount * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.norAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('normal', this.norAttr);
    this.geo.setAttribute('color', this.colAttr);
    const idx: number[] = [];
    for (let s = 0; s < SAMPLES; s++) {
      for (let r = 0; r < RADIAL; r++) {
        const a = s * (RADIAL + 1) + r;
        const b = (s + 1) * (RADIAL + 1) + r;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.geo.setIndex(idx);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 14), 40);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 24; i++) this.pulsePool.push({ s: 0, speed: 0, color: new THREE.Color(), size: 0 });
  }

  /** Places the chain in a straight line (on load / first frame). */
  reset(a: THREE.Vector3, b: THREE.Vector3): void {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = a.x + (b.x - a.x) * t;
      const y = Math.max(GROUND, a.y + (b.y - a.y) * t);
      const z = a.z + (b.z - a.z) * t;
      this.pos[i * 3] = this.prev[i * 3] = x;
      this.pos[i * 3 + 1] = this.prev[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = this.prev[i * 3 + 2] = z;
    }
    this.initialized = true;
  }

  addPulse(tier: number, size = 1): void {
    const p = this.pulsePool.pop();
    if (!p) return;
    p.s = 0;
    p.speed = 1;
    p.size = size;
    p.color.set(TIER_COLORS[tier]?.tip ?? '#ffffff');
    this.pulses.push(p);
  }

  /** A short decaying "twang" when the hose snaps taut (visual vibration only). */
  pluck(strength: number): void {
    this.twangAmp = Math.max(this.twangAmp, strength * 2.6);
    this.twangPhase = 0;
  }

  get activePulses(): number {
    return this.pulses.length;
  }

  /** 0..1 elastic give past the reach limit (thins and brightens the hose). */
  stretch = 0;
  /** 0..1 how strongly the chain is pulled onto the straight anchor→head line (taut hose). */
  private taut = 0;
  private endV = new THREE.Vector3();
  private twangAmp = 0;
  private twangPhase = 0;
  private perp = new THREE.Vector3();

  /**
   * `closeness` = reach metric / reach (1 at the limit). Far from the limit the reel leaves
   * some slack so the hose curves; near the limit it reels in until the hose is a straight,
   * taut line, and past it (elastic give) the hose is under tension.
   */
  update(dt: number, anchor: THREE.Vector3, end: THREE.Vector3, closeness: number, stretch: number): void {
    if (!this.initialized) this.reset(anchor, end);
    const dist = anchor.distanceTo(end);
    const t = THREE.MathUtils.smoothstep(closeness, 0.8, 0.985);
    const slack = 1 - t;
    const targetRest = slack > 0.001 ? dist * (1 + 0.09 * slack) + 0.35 * slack : dist * (0.995 - 0.02 * stretch);
    // The reel pays out fast; it reels in slowly in open space but snaps taut near the limit.
    const rate = targetRest > this.restLength ? 30 : closeness > 0.85 ? 22 : 6;
    this.restLength += (targetRest - this.restLength) * (1 - Math.exp(-dt * rate));
    this.restLength = Math.max(this.restLength, dist * 0.97);
    this.tension = Math.max(t, THREE.MathUtils.clamp((dist / Math.max(0.01, this.restLength) - 0.93) / 0.07, 0, 1));
    this.stretch += (stretch - this.stretch) * (1 - Math.exp(-dt * 20));
    // A long Verlet chain never fully straightens against gravity by constraints alone, so
    // near the limit the chain is also pulled onto the straight line: taut means straight.
    this.taut = THREE.MathUtils.smoothstep(closeness, 0.9, 0.995);
    this.twangAmp *= Math.exp(-dt * 8);
    this.twangPhase += dt * 48;

    this.acc += Math.min(dt, 0.05);
    const step = 1 / 60;
    while (this.acc >= step) {
      this.simulate(step, anchor, end);
      this.acc -= step;
    }

    // Pulses travel from the tool toward the machine.
    const len = Math.max(1, this.restLength);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.s += (dt * 11) / len;
      if (p.s >= 1) {
        this.pulses.splice(i, 1);
        this.pulsePool.push(p);
      }
    }
    this.rebuild();
  }

  private simulate(dt: number, anchor: THREE.Vector3, end: THREE.Vector3): void {
    const p = this.pos;
    const q = this.prev;
    // A taut hose doesn't sag: gravity fades out as the hose tightens.
    const g = -14 * dt * dt * (1 - 0.95 * this.taut);
    for (let i = 1; i < N - 1; i++) {
      const o = i * 3;
      const onGround = p[o + 1] <= GROUND + 0.01;
      const damp = onGround ? 0.72 : 0.985;
      const vx = (p[o] - q[o]) * damp;
      const vy = (p[o + 1] - q[o + 1]) * 0.985;
      const vz = (p[o + 2] - q[o + 2]) * damp;
      q[o] = p[o];
      q[o + 1] = p[o + 1];
      q[o + 2] = p[o + 2];
      p[o] += vx;
      p[o + 1] += vy + g;
      p[o + 2] += vz;
    }
    const L = this.restLength / (N - 1);
    for (let it = 0; it < 14; it++) {
      p[0] = anchor.x;
      p[1] = anchor.y;
      p[2] = anchor.z;
      const e = (N - 1) * 3;
      p[e] = end.x;
      p[e + 1] = end.y;
      p[e + 2] = end.z;
      for (let i = 0; i < N - 1; i++) {
        const a = i * 3;
        const b = a + 3;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - L) / d;
        const wa = i === 0 ? 0 : 0.5;
        const wb = i + 1 === N - 1 ? 0 : 0.5;
        const sum = wa + wb || 1;
        p[a] += dx * diff * (wa / sum);
        p[a + 1] += dy * diff * (wa / sum);
        p[a + 2] += dz * diff * (wa / sum);
        p[b] -= dx * diff * (wb / sum);
        p[b + 1] -= dy * diff * (wb / sum);
        p[b + 2] -= dz * diff * (wb / sum);
      }
      // Soft bending stiffness (i, i+2) keeps curves smooth instead of kinked.
      for (let i = 1; i < N - 2; i++) {
        const a = (i - 1) * 3;
        const b = (i + 1) * 3;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const target = L * 1.7;
        if (d < target) {
          const diff = ((d - target) / d) * 0.08;
          const wa = i - 1 === 0 ? 0 : 0.5;
          const wb = i + 1 === N - 1 ? 0 : 0.5;
          p[a] += dx * diff * wa;
          p[a + 2] += dz * diff * wa;
          p[b] -= dx * diff * wb;
          p[b + 2] -= dz * diff * wb;
        }
      }
      for (let i = 1; i < N - 1; i++) if (p[i * 3 + 1] < GROUND) p[i * 3 + 1] = GROUND;
    }
    if (this.taut > 0.001) {
      const k = this.taut * this.taut * 0.45;
      const e = this.endV.copy(end);
      for (let i = 1; i < N - 1; i++) {
        const t = i / (N - 1);
        const o = i * 3;
        const dx = (anchor.x + (e.x - anchor.x) * t - p[o]) * k;
        const dy = (anchor.y + (e.y - anchor.y) * t - p[o + 1]) * k;
        const dz = (anchor.z + (e.z - anchor.z) * t - p[o + 2]) * k;
        p[o] += dx;
        p[o + 1] = Math.max(GROUND, p[o + 1] + dy);
        p[o + 2] += dz;
        // Bleed velocity as it tightens so the straight line holds instead of drifting.
        q[o] += (p[o] - q[o]) * this.taut;
        q[o + 1] += (p[o + 1] - q[o + 1]) * this.taut;
        q[o + 2] += (p[o + 2] - q[o + 2]) * this.taut;
      }
    }
  }

  private rebuild(): void {
    for (let i = 0; i < N; i++) this.curvePts[i].set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    // Sample from tool (s=0) to machine (s=1): curve runs anchor→end, so invert.
    for (let s = 0; s <= SAMPLES; s++) this.curve.getPoint(1 - s / SAMPLES, this.samples[s]);
    if (this.twangAmp > 0.002) {
      const first = this.samples[0];
      const last = this.samples[SAMPLES];
      this.perp.set(-(last.z - first.z), 0, last.x - first.x).normalize();
      const w0 = this.twangAmp * Math.sin(this.twangPhase);
      for (let s = 1; s < SAMPLES; s++) {
        const w = Math.sin((Math.PI * s) / SAMPLES) * w0;
        this.samples[s].addScaledVector(this.perp, w);
        this.samples[s].y += Math.abs(w) * 0.4;
      }
    }
    const pos = this.posAttr.array as Float32Array;
    const nor = this.norAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const up = this.tmpB.set(0, 1, 0);
    const baseCol = this.tmpC.copy(this.base).lerp(this.tautColor, this.tension * 0.35 + this.stretch * 0.4);
    const rad = RADIUS * (1 - this.tension * 0.06 - this.stretch * 0.14);
    const pulseCol = this.pulseCol;
    for (let s = 0; s <= SAMPLES; s++) {
      const a = this.samples[Math.max(0, s - 1)];
      const b = this.samples[Math.min(SAMPLES, s + 1)];
      const t = this.tmpT.subVectors(b, a).normalize();
      // Frame: side = t × up (fallback if vertical), normal = side × t.
      const side = this.tmp.crossVectors(t, up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const nrm = this.tmpN.crossVectors(side, t).normalize();
      const u = s / SAMPLES;
      let bulge = 0;
      pulseCol.copy(baseCol);
      for (const p of this.pulses) {
        const d = (u - p.s) * 28;
        const w = Math.exp(-d * d);
        if (w > 0.01) {
          bulge += w * 0.7 * p.size;
          pulseCol.lerp(p.color, w * 0.7);
        }
      }
      // Subtle rib shading along the hose
      const rib = s % 4 === 0 ? 0.88 : 1;
      const r = rad * (1 + bulge);
      const c = this.samples[s];
      for (let k = 0; k <= RADIAL; k++) {
        const ang = (k / RADIAL) * Math.PI * 2;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const nx = side.x * cs + nrm.x * sn;
        const ny = side.y * cs + nrm.y * sn;
        const nz = side.z * cs + nrm.z * sn;
        const o = (s * (RADIAL + 1) + k) * 3;
        pos[o] = c.x + nx * r;
        pos[o + 1] = c.y + ny * r;
        pos[o + 2] = c.z + nz * r;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
        const shade = rib;
        col[o] = (bulge > 0.02 ? pulseCol.r : k % 2 ? baseCol.r : this.dark.r * 0.3 + baseCol.r * 0.7) * shade;
        col[o + 1] = (bulge > 0.02 ? pulseCol.g : k % 2 ? baseCol.g : this.dark.g * 0.3 + baseCol.g * 0.7) * shade;
        col[o + 2] = (bulge > 0.02 ? pulseCol.b : k % 2 ? baseCol.b : this.dark.b * 0.3 + baseCol.b * 0.7) * shade;
      }
    }
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
