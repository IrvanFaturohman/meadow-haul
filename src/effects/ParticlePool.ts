// Pooled, instanced particles: flying cut debris, suction pieces, dust puffs, smoke and
// sparkles. Purely decorative — resource amounts never depend on these.

import * as THREE from 'three';
import { buildClippingsGeometry, buildSliverGeometry, createFoliageMaterial } from '../art/grassMaterial';

type Mode = 'fly' | 'suck' | 'puff' | 'spark';

interface Particle {
  mode: Mode;
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vr: number;
  life: number;
  max: number;
  scale: number;
  // suction spiral (polar coordinates around the nozzle at spawn time)
  r0: number;
  a0: number;
  y0: number;
  spinDir: number;
  color: THREE.Color;
  grounded: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private items: Particle[] = [];
  private free: Particle[] = [];
  private live: Particle[] = [];
  capacity: number;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    for (let i = 0; i < capacity; i++) {
      const p: Particle = {
        mode: 'fly', alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, vr: 0,
        life: 0, max: 1, scale: 1, r0: 0, a0: 0, y0: 0, spinDir: 1, color: new THREE.Color(), grounded: false,
      };
      this.items.push(p);
      this.free.push(p);
    }
  }

  setBudget(n: number): void {
    this.capacity = Math.min(this.items.length, n);
  }

  spawn(): Particle | null {
    if (this.live.length >= this.capacity) return null;
    const p = this.free.pop();
    if (!p) return null;
    p.alive = true;
    p.grounded = false;
    this.live.push(p);
    return p;
  }

  get active(): number {
    return this.live.length;
  }

  update(dt: number, target: THREE.Vector3, fn: (p: Particle, dt: number, target: THREE.Vector3) => number): void {
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life += dt;
      const sc = fn(p, dt, target);
      if (p.life >= p.max || sc <= 0) {
        p.alive = false;
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        this.free.push(p);
        continue;
      }
      _e.set(p.rx, p.ry, p.rz);
      _q.setFromEuler(_e);
      _p.set(p.x, p.y, p.z);
      _s.setScalar(sc);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** Spiral into the nozzle: radius shrinks with acceleration, angle winds up, height rises. */
function spiral(p: Particle, dt: number, target: THREE.Vector3): number {
  const t = Math.min(1, p.life / p.max);
  const e = t * t;
  const r = p.r0 * (1 - e);
  const a = p.a0 + p.spinDir * e * 2.6;
  p.x = target.x + Math.cos(a) * r;
  p.z = target.z + Math.sin(a) * r;
  p.y = p.y0 + (target.y - p.y0) * e + Math.sin(t * Math.PI) * 0.14 * Math.min(1, p.r0);
  p.rx += p.vr * dt;
  p.ry += p.vr * 0.7 * dt;
  const shrink = 1 - 0.7 * e;
  return p.scale * shrink * (t > 0.82 ? (1 - t) / 0.18 : 1);
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private debris: Pool;
  private clumps: Pool;
  private puffs: Pool;
  motionScale = 1;
  private nozzle = new THREE.Vector3();

  constructor() {
    const debrisMat = createFoliageMaterial();
    this.debris = new Pool(buildSliverGeometry(), debrisMat, 500);
    this.clumps = new Pool(buildClippingsGeometry(), debrisMat, 220);
    const puffGeo = new THREE.IcosahedronGeometry(0.12, 0);
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.puffs = new Pool(puffGeo, puffMat, 160);
    this.group.add(this.debris.mesh, this.clumps.mesh, this.puffs.mesh);
  }

  setBudget(debris: number): void {
    this.debris.setBudget(debris);
    this.clumps.setBudget(Math.round(debris * 0.45));
    this.puffs.setBudget(Math.round(debris * 0.35));
  }

  get activeCount(): number {
    return this.debris.active + this.clumps.active + this.puffs.active;
  }

  /** Cut pieces flung 0.2–0.6 units along the sweep direction, landing on the soil. */
  cutBurst(x: number, z: number, dirX: number, dirZ: number, color: THREE.Color, height: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const p = this.debris.spawn();
      if (!p) return;
      p.mode = 'fly';
      p.x = x + (Math.random() - 0.5) * 0.2;
      p.y = height * (0.3 + Math.random() * 0.5);
      p.z = z + (Math.random() - 0.5) * 0.2;
      const side = (Math.random() - 0.5) * 2;
      const sp = 0.9 + Math.random() * 1.3;
      p.vx = (dirX * 0.8 + -dirZ * side) * sp;
      p.vz = (dirZ * 0.8 + dirX * side) * sp;
      p.vy = 1.4 + Math.random() * 1.4;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.rz = Math.random() * 6;
      p.vr = (Math.random() - 0.5) * 18;
      p.life = 0;
      p.max = 0.9 + Math.random() * 0.5;
      p.scale = 0.8 + Math.random() * 0.5;
      p.color.copy(color).multiplyScalar(0.85 + Math.random() * 0.3);
    }
  }

  private startSpiral(p: Particle, x: number, y: number, z: number, nx: number, nz: number, dur: number): void {
    p.mode = 'suck';
    p.x = x;
    p.y = y;
    p.z = z;
    p.y0 = y;
    p.r0 = Math.hypot(x - nx, z - nz);
    p.a0 = Math.atan2(z - nz, x - nx);
    p.spinDir = Math.random() > 0.5 ? 1 : -1;
    p.rx = Math.random() * 6;
    p.ry = Math.random() * 6;
    p.rz = Math.random() * 6;
    p.vr = (Math.random() - 0.5) * 24;
    p.life = 0;
    p.max = dur;
  }

  /**
   * A pile of cuttings being sucked in: it spirals toward the nozzle, accelerating, lifting
   * and shrinking into the mouth. One logical unit → one pile (plus a small loose bit).
   */
  suck(x: number, z: number, color: THREE.Color, nx: number, nz: number): void {
    const p = this.clumps.spawn();
    if (p) {
      const d = Math.hypot(x - nx, z - nz);
      this.startSpiral(p, x, 0.03, z, nx, nz, 0.2 + d * 0.09 + Math.random() * 0.06);
      p.scale = 1.05 + Math.random() * 0.35;
      p.color.copy(color);
      p.vr *= 0.5;
    }
    const b = this.debris.spawn();
    if (b) {
      const a = Math.random() * Math.PI * 2;
      this.startSpiral(b, x + Math.cos(a) * 0.15, 0.08, z + Math.sin(a) * 0.15, nx, nz, 0.18 + Math.random() * 0.12);
      b.scale = 0.7 + Math.random() * 0.4;
      b.color.copy(color).multiplyScalar(1.1);
    }
  }

  /** Air being drawn in: faint motes spiral toward the nozzle from beyond its radius. */
  mote(nx: number, nz: number, radius: number, color: THREE.Color): void {
    const p = this.debris.spawn();
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const r = radius * (1.3 + Math.random() * 0.5);
    this.startSpiral(p, nx + Math.cos(a) * r, 0.12 + Math.random() * 0.2, nz + Math.sin(a) * r, nx, nz, 0.3 + Math.random() * 0.15);
    p.scale = 0.35 + Math.random() * 0.25;
    p.color.copy(color);
  }

  dust(x: number, y: number, z: number, color: THREE.Color, count: number, spread = 0.3, rise = 0.6): void {
    for (let k = 0; k < count; k++) {
      const p = this.puffs.spawn();
      if (!p) return;
      p.mode = 'puff';
      p.x = x + (Math.random() - 0.5) * spread;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * spread;
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vz = (Math.random() - 0.5) * 0.6;
      p.vy = rise * (0.6 + Math.random() * 0.6);
      p.rx = Math.random() * 3;
      p.ry = Math.random() * 3;
      p.rz = 0;
      p.vr = 0.5;
      p.life = 0;
      p.max = 0.5 + Math.random() * 0.35;
      p.scale = 0.6 + Math.random() * 0.8;
      p.color.copy(color);
    }
  }

  sparkle(x: number, y: number, z: number, color: THREE.Color, count: number): void {
    for (let k = 0; k < count; k++) {
      const p = this.puffs.spawn();
      if (!p) return;
      p.mode = 'spark';
      p.x = x;
      p.y = y;
      p.z = z;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 1.6;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 2 + Math.random() * 2;
      p.rx = p.ry = p.rz = 0;
      p.vr = 6;
      p.life = 0;
      p.max = 0.6 + Math.random() * 0.3;
      p.scale = 0.35 + Math.random() * 0.3;
      p.color.copy(color);
    }
  }

  update(dt: number, nozzle: THREE.Vector3): void {
    this.nozzle.copy(nozzle);
    const ms = this.motionScale;
    this.debris.update(dt, this.nozzle, (p, dt2, target) => {
      if (p.mode === 'fly') {
        if (!p.grounded) {
          p.vy -= 9.5 * dt2;
          p.x += p.vx * dt2;
          p.y += p.vy * dt2;
          p.z += p.vz * dt2;
          p.rx += p.vr * dt2;
          p.rz += p.vr * 0.6 * dt2;
          if (p.y <= 0.03) {
            p.y = 0.03;
            p.grounded = true;
            p.rx = Math.PI / 2;
          }
        }
        const fade = p.life > p.max - 0.25 ? (p.max - p.life) / 0.25 : 1;
        return p.scale * fade;
      }
      return spiral(p, dt2, target);
    });
    this.clumps.update(dt, this.nozzle, (p, dt2, target) => spiral(p, dt2, target));
    this.puffs.update(dt, this.nozzle, (p, dt2) => {
      p.x += p.vx * dt2;
      p.y += p.vy * dt2;
      p.z += p.vz * dt2;
      if (p.mode === 'spark') {
        p.vy -= 7 * dt2;
        if (p.y < 0.05) p.y = 0.05;
      } else {
        p.vx *= 0.96;
        p.vz *= 0.96;
        p.vy *= 0.97;
      }
      const t = p.life / p.max;
      const grow = p.mode === 'spark' ? 1 - t : Math.sin(Math.min(1, t) * Math.PI) * (0.6 + t);
      return p.scale * grow * (p.mode === 'puff' ? Math.max(0.5, ms) : 1);
    });
  }
}
