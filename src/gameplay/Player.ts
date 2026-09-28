// Farm character movement: smoothed velocity, circle-vs-AABB collision, facing.

import { PLAYER } from '../config/balance';
import { PLAYER_BOUNDS, type Aabb } from '../config/worldLayout';
import type { PlayerState } from '../core/GameState';
import type { MoveInput } from './Harvester';

export interface Mover {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
}

export function resolveCircleAabb(p: { x: number; z: number }, r: number, b: Aabb): boolean {
  const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
  } else {
    // Centre inside the box: push out along the shallowest axis.
    const left = p.x - b.minX;
    const right = b.maxX - p.x;
    const down = p.z - b.minZ;
    const up = b.maxZ - p.z;
    const m = Math.min(left, right, down, up);
    if (m === left) p.x = b.minX - r;
    else if (m === right) p.x = b.maxX + r;
    else if (m === down) p.z = b.minZ - r;
    else p.z = b.maxZ + r;
  }
  return true;
}

export function clampToBounds(p: { x: number; z: number }, r: number, b: Aabb = PLAYER_BOUNDS): void {
  p.x = Math.min(b.maxX - r, Math.max(b.minX + r, p.x));
  p.z = Math.min(b.maxZ - r, Math.max(b.minZ + r, p.z));
}

export function movePlayer(p: PlayerState, input: MoveInput, speed: number, dt: number, colliders: readonly Aabb[]): number {
  const mag = Math.hypot(input.x, input.z);
  const tau = mag > 0.01 ? PLAYER.accelTau : PLAYER.stopTau;
  const k = 1 - Math.exp(-dt / tau);
  p.vx += (input.x * speed - p.vx) * k;
  p.vz += (input.z * speed - p.vz) * k;
  if (mag <= 0.01 && Math.hypot(p.vx, p.vz) < 0.03) {
    p.vx = 0;
    p.vz = 0;
  }
  const px = p.x;
  const pz = p.z;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) resolveCircleAabb(p, PLAYER.radius, c);
    clampToBounds(p, PLAYER.radius);
  }
  // Velocity after collision reflects actual displacement so walking into a wall doesn't build speed.
  if (dt > 0) {
    const ax = (p.x - px) / dt;
    const az = (p.z - pz) / dt;
    if (Math.hypot(ax, az) < Math.hypot(p.vx, p.vz) * 0.5) {
      p.vx = ax;
      p.vz = az;
    }
  }
  const sp = Math.hypot(p.vx, p.vz);
  if (mag > 0.05 && sp > 0.1) p.facing = turnToward(p.facing, Math.atan2(input.x, input.z), dt * 14);
  return sp;
}

export function turnToward(current: number, target: number, maxStep: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Straight-line walk toward a point; returns true on arrival. */
export function walkToward(m: Mover, tx: number, tz: number, speed: number, dt: number, arriveR = 0.08): boolean {
  const dx = tx - m.x;
  const dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  if (d <= arriveR) {
    m.vx = 0;
    m.vz = 0;
    return true;
  }
  const step = Math.min(d, speed * dt);
  m.vx = (dx / d) * speed;
  m.vz = (dz / d) * speed;
  m.x += (dx / d) * step;
  m.z += (dz / d) * step;
  m.facing = turnToward(m.facing, Math.atan2(dx, dz), dt * 10);
  return step >= d - 1e-6;
}
