// Orthographic camera looking down the field (+Z = screen-up) at a fixed pitch. Follows a
// target with light damping, clamps to bounds and blends between farm and harvest framing.

import * as THREE from 'three';
import { CAMERA } from '../config/worldLayout';
import { clamp01, damp, ease, lerp } from '../effects/Tweens';

export interface Framing {
  x: number;
  z: number;
  width: number;
}

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  private pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
  private aspect = 0.46;
  private cur: Framing = { x: 0, z: -5, width: CAMERA.farmViewWidth };
  private from: Framing = { x: 0, z: 0, width: 10 };
  private transT = -1;
  private transDur = CAMERA.transitionTime;
  private shakeT = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  private widthScale = 1;
  readonly groundRight = new THREE.Vector3();
  readonly groundUp = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-5, 5, 10, -10, 0.1, 200);
    this.apply(0);
    this.computeBasis();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    // Wider-than-portrait frames zoom out a little so landscape stays usable.
    this.widthScale = this.aspect > 0.62 ? Math.sqrt(this.aspect / 0.62) : 1;
    this.apply(0);
  }

  /** Half the visible ground depth (in Z) for a given view width. */
  halfDepth(width: number): number {
    const w = width * this.widthScale;
    const h = w / this.aspect;
    return h / 2 / Math.sin(this.pitch);
  }

  halfWidth(width: number): number {
    return (width * this.widthScale) / 2;
  }

  get framing(): Framing {
    return this.cur;
  }

  get transitioning(): boolean {
    return this.transT >= 0;
  }

  snap(f: Framing): void {
    this.cur = { ...f };
    this.transT = -1;
    this.apply(0);
  }

  /** Starts a smooth 350–550 ms move toward a new framing. */
  transitionTo(f: Framing, dur = CAMERA.transitionTime): void {
    this.from = { ...this.cur };
    this.transT = 0;
    this.transDur = dur;
    this.pendingTarget = { ...f };
  }

  private pendingTarget: Framing = { x: 0, z: 0, width: 10 };

  shake(amp: number, dur: number): void {
    if (amp * dur > this.shakeAmp * Math.max(0, this.shakeDur - this.shakeT)) {
      this.shakeAmp = amp;
      this.shakeDur = dur;
      this.shakeT = 0;
    }
  }

  /** Follow a target framing (after transitions finish). */
  update(dt: number, target: Framing, followTau: number): void {
    if (this.transT >= 0) {
      this.transT += dt;
      // Keep the destination live (the followed object may move a little).
      this.pendingTarget = { ...target };
      const k = ease.inOutCubic(clamp01(this.transT / this.transDur));
      this.cur.x = lerp(this.from.x, this.pendingTarget.x, k);
      this.cur.z = lerp(this.from.z, this.pendingTarget.z, k);
      this.cur.width = lerp(this.from.width, this.pendingTarget.width, k);
      if (this.transT >= this.transDur) this.transT = -1;
    } else {
      const a = damp(followTau, dt);
      this.cur.x += (target.x - this.cur.x) * a;
      this.cur.z += (target.z - this.cur.z) * a;
      this.cur.width += (target.width - this.cur.width) * damp(0.2, dt);
    }
    let sx = 0;
    let sz = 0;
    if (this.shakeT < this.shakeDur) {
      this.shakeT += dt;
      const f = 1 - this.shakeT / this.shakeDur;
      sx = (Math.random() - 0.5) * 2 * this.shakeAmp * f;
      sz = (Math.random() - 0.5) * 2 * this.shakeAmp * f;
    }
    this.apply(0, sx, sz);
  }

  private apply(_dt: number, sx = 0, sz = 0): void {
    const w = this.cur.width * this.widthScale;
    const h = w / this.aspect;
    const cam = this.camera;
    cam.left = -w / 2;
    cam.right = w / 2;
    cam.top = h / 2;
    cam.bottom = -h / 2;
    const d = CAMERA.distance;
    const tx = this.cur.x + sx;
    const tz = this.cur.z + sz;
    cam.position.set(tx, Math.sin(this.pitch) * d, tz - Math.cos(this.pitch) * d);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, 0, tz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private computeBasis(): void {
    // Screen-right and screen-up projected onto the ground plane (used for input mapping).
    const m = this.camera.matrixWorld;
    this.groundRight.setFromMatrixColumn(m, 0).setY(0).normalize();
    this.groundUp.setFromMatrixColumn(m, 1).setY(0).normalize();
  }

  /** Maps a screen-space stick (x right, y up) to a ground direction. */
  screenToGround(x: number, y: number, out: { x: number; z: number }): void {
    out.x = this.groundRight.x * x + this.groundUp.x * y;
    out.z = this.groundRight.z * x + this.groundUp.z * y;
  }
}
