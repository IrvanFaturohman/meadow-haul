// Draws every bale in the world (depot stacks, carried stacks, truck bed, in-flight arcs)
// with one InstancedMesh per tier. Positions are derived from committed state each frame;
// flights only hide the destination slot until they land.

import * as THREE from 'three';
import type { TierId } from '../config/balance';
import { DOCK, PALLETS } from '../config/worldLayout';
import type { Bale } from '../core/GameState';
import { BALE_SIZE, baleGeometries, baleScale } from '../art/buildBale';
import { TRUCK_SLOTS } from '../art/buildTruck';
import { clamp01, ease, popScale } from '../effects/Tweens';
import { hash01 } from '../art/geo';

const CAP_PER_TIER = 220;
/** Visual cap only (4 pallets × 6 × 2 layers); the depot itself is unlimited. */
export const DEPOT_VISUAL_CAP = 48;
export const STACK_VISUAL_CAP = 10;
export const DOCK_VISUAL_CAP = 18;

interface Flight {
  bale: Bale;
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  spin: number;
  onLand?: () => void;
}

export interface StackView {
  anchor: THREE.Object3D;
  bales: readonly Bale[];
  /** Lateral sway angles (radians) from the stack spring. */
  swayX: number;
  swayZ: number;
  bounce: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

export class BaleRenderer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private counts = [0, 0, 0];
  private flights: Flight[] = [];
  private inFlight = new Set<number>();
  private pops = new Map<number, number>();
  private time = 0;

  constructor() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.meshes = baleGeometries().map((g) => {
      const m = new THREE.InstancedMesh(g, mat, CAP_PER_TIER);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    });
  }

  /**
   * World position of depot slot i. Bales spread across all pallets layer by layer
   * (6 per pallet layer, 2 layers) so the pile grows wide before it grows tall.
   */
  depotSlot(i: number, out: THREE.Vector3): THREE.Vector3 {
    const perLayer = PALLETS.length * 6;
    const layer = Math.min(1, Math.floor(i / perLayer));
    const k = i % perLayer;
    const p = PALLETS[Math.floor(k / 6)];
    const j = k % 6;
    // Alternate orientation per layer like real stacked bales.
    const rot = layer % 2 === 1;
    let lx: number;
    let lz: number;
    if (!rot) {
      lx = (j % 2 === 0 ? -1 : 1) * 0.33;
      lz = (Math.floor(j / 2) - 1) * 0.43;
    } else {
      lx = (Math.floor(j / 2) - 1) * 0.43;
      lz = (j % 2 === 0 ? -1 : 1) * 0.33;
    }
    return out.set(p.x + lx, 0.2 + BALE_SIZE.y / 2 + layer * BALE_SIZE.y, p.z + lz);
  }

  /** Loading-dock slot i: 3 × 2 per layer, 3 layers (18 visible); more are counted by label. */
  dockSlot(i: number, out: THREE.Vector3): THREE.Vector3 {
    const k = Math.min(i, DOCK_VISUAL_CAP - 1);
    const layer = Math.floor(k / 6);
    const j = k % 6;
    return out.set(DOCK.x + ((j % 3) - 1) * 0.45, BALE_SIZE.y / 2 + layer * BALE_SIZE.y + 0.02, DOCK.z + (Math.floor(j / 3) - 0.5) * 0.64);
  }

  depotSlotRotated(i: number): boolean {
    return Math.floor(i / (PALLETS.length * 6)) % 2 === 1;
  }

  launch(bale: Bale, from: THREE.Vector3, to: () => THREE.Vector3, dur: number, arc: number, onLand?: () => void): void {
    this.inFlight.add(bale.id);
    this.flights.push({ bale, from: from.clone(), to, t: 0, dur, arc, spin: (Math.random() - 0.5) * 3, onLand });
  }

  pop(baleId: number): void {
    this.pops.set(baleId, this.time);
  }

  isInFlight(id: number): boolean {
    return this.inFlight.has(id);
  }

  clearFlights(): void {
    this.flights.length = 0;
    this.inFlight.clear();
  }

  private write(tier: TierId, pos: THREE.Vector3, rotY: number, rotX: number, rotZ: number, scale: number, id: number): void {
    const n = this.counts[tier];
    if (n >= CAP_PER_TIER) return;
    const popT = this.pops.get(id);
    let s = scale;
    if (popT !== undefined) {
      const age = this.time - popT;
      if (age > 0.3) this.pops.delete(id);
      else s *= popScale(age, 0.24, 1.1);
    }
    _e.set(rotX, rotY, rotZ, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(s, s * (popT !== undefined ? 2 - popScale(this.time - popT, 0.24, 1.1) : 1), s);
    _m.compose(pos, _q, _s);
    this.meshes[tier].setMatrixAt(n, _m);
    this.counts[tier] = n + 1;
  }

  update(dt: number, depot: readonly Bale[], stacks: StackView[], truckBed: THREE.Object3D | null, truckCargo: readonly Bale[], dock: readonly Bale[]): void {
    this.time += dt;
    this.counts[0] = this.counts[1] = this.counts[2] = 0;

    // Loading dock (sold, waiting for the truck)
    for (let i = 0; i < Math.min(dock.length, DOCK_VISUAL_CAP); i++) {
      const b = dock[i];
      if (this.inFlight.has(b.id)) continue;
      this.dockSlot(i, _p);
      this.write(b.tier, _p, Math.PI / 2 + (hash01(b.id) - 0.5) * 0.12, 0, 0, baleScale(b.qty), b.id);
    }

    // Depot
    const nDepot = Math.min(depot.length, DEPOT_VISUAL_CAP);
    for (let i = 0; i < nDepot; i++) {
      const b = depot[i];
      if (this.inFlight.has(b.id)) continue;
      this.depotSlot(i, _p);
      const jitter = (hash01(b.id) - 0.5) * 0.12;
      this.write(b.tier, _p, (this.depotSlotRotated(i) ? Math.PI / 2 : 0) + jitter, 0, 0, baleScale(b.qty), b.id);
    }

    // Carried stacks
    for (const st of stacks) {
      st.anchor.updateWorldMatrix(true, false);
      const n = Math.min(st.bales.length, STACK_VISUAL_CAP);
      for (let i = 0; i < n; i++) {
        const b = st.bales[i];
        if (this.inFlight.has(b.id)) continue;
        const h = i * BALE_SIZE.y * 0.98;
        // Sway grows with height: the top of the stack lags the most.
        const k = (i + 1) / Math.max(3, n);
        _v.set(Math.sin(st.swayZ * k) * h, h + BALE_SIZE.y / 2 + st.bounce * k, -Math.sin(st.swayX * k) * h * 0.6);
        _v.applyMatrix4(st.anchor.matrixWorld);
        const yaw = Math.atan2(st.anchor.matrixWorld.elements[8], st.anchor.matrixWorld.elements[10]);
        this.write(b.tier, _v, yaw + Math.PI / 2 + (hash01(b.id) - 0.5) * 0.15, st.swayX * k * 0.8, -st.swayZ * k * 0.8, baleScale(b.qty) * 0.92, b.id);
      }
    }

    // Truck bed
    if (truckBed) {
      truckBed.updateWorldMatrix(true, false);
      for (let i = 0; i < Math.min(truckCargo.length, TRUCK_SLOTS.length); i++) {
        const b = truckCargo[i];
        if (this.inFlight.has(b.id)) continue;
        _v.copy(TRUCK_SLOTS[i]).applyMatrix4(truckBed.matrixWorld);
        this.write(b.tier, _v, (hash01(b.id) - 0.5) * 0.1, 0, 0, baleScale(b.qty), b.id);
      }
    }

    // Flights
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = clamp01(f.t / f.dur);
      const to = f.to();
      const e = ease.outQuad(k);
      _p.lerpVectors(f.from, to, e);
      _p.y += Math.sin(k * Math.PI) * f.arc;
      this.write(f.bale.tier, _p, f.spin * k, 0, Math.sin(k * Math.PI) * 0.3, baleScale(f.bale.qty) * (0.9 + 0.1 * Math.sin(k * Math.PI)), f.bale.id);
      if (k >= 1) {
        this.flights.splice(i, 1);
        this.inFlight.delete(f.bale.id);
        this.pop(f.bale.id);
        f.onLand?.();
      }
    }

    for (let t = 0; t < 3; t++) {
      const m = this.meshes[t];
      m.count = this.counts[t];
      m.instanceMatrix.needsUpdate = true;
    }
  }

  get flightCount(): number {
    return this.flights.length;
  }

  /** World position of the top of a stack (for flight targets). */
  stackTop(st: StackView, index: number, out: THREE.Vector3): THREE.Vector3 {
    st.anchor.updateWorldMatrix(true, false);
    const i = Math.min(index, STACK_VISUAL_CAP - 1);
    return out.set(0, i * BALE_SIZE.y * 0.98 + BALE_SIZE.y / 2, 0).applyMatrix4(st.anchor.matrixWorld);
  }

  truckSlot(bed: THREE.Object3D, i: number, out: THREE.Vector3): THREE.Vector3 {
    bed.updateWorldMatrix(true, false);
    return out.copy(TRUCK_SLOTS[Math.min(i, TRUCK_SLOTS.length - 1)]).applyMatrix4(bed.matrixWorld);
  }
}
