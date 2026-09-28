// Tool head movement with a real reach limit around the hose anchor. The limit is elastic:
// pushing past it gives a little with growing resistance, and the head springs back when
// the push stops — never a hard wall. Pure logic.

import { HARVESTER, REACH_SHAPE } from '../config/balance';
import { FIELD, HOSE_ANCHOR } from '../config/worldLayout';
import type { HarvesterState } from '../core/GameState';
import { reachMetric, reachNormal } from './Reach';

export interface MoveInput {
  /** World-space direction on the ground plane scaled by analog magnitude (length ≤ 1). */
  x: number;
  z: number;
}

export interface HarvesterMoveResult {
  atLimit: boolean;
  /** Input keeps pushing outward while at the limit. */
  pushingLimit: boolean;
  speed: number;
  /** 0..1 how far into the elastic give the head currently is. */
  stretch: number;
  /** Reach metric distance / reach (≈1 at the limit). */
  closeness: number;
}

const n = { x: 0, z: 0 };

function clampToField(h: { x: number; z: number }): void {
  const m = HARVESTER.fieldMargin;
  h.x = Math.min(FIELD.x0 + FIELD.width - m, Math.max(FIELD.x0 + m, h.x));
  h.z = Math.min(FIELD.z0 + FIELD.length - m, Math.max(HARVESTER.minZ, h.z));
}

/** Hard clamp inside the field and within `reach + extra`. Returns true when at the limit. */
export function clampToolPosition(h: { x: number; z: number }, reach: number, extra = 0): boolean {
  clampToField(h);
  const dx = h.x - HOSE_ANCHOR.x;
  const dz = h.z - HOSE_ANCHOR.z;
  const d = reachMetric(dx, dz);
  const lim = reach + extra;
  if (d > lim) {
    const k = lim / d;
    h.x = HOSE_ANCHOR.x + dx * k;
    h.z = HOSE_ANCHOR.z + dz * k;
    return true;
  }
  return d >= reach - 0.02;
}

export function moveHarvester(h: HarvesterState, input: MoveInput, dt: number, reach: number, speed = HARVESTER.baseSpeed): HarvesterMoveResult {
  const S = REACH_SHAPE;
  const mag = Math.hypot(input.x, input.z);
  const tau = mag > 0.01 ? HARVESTER.accelTau : HARVESTER.stopTau;
  const k = 1 - Math.exp(-dt / tau);
  h.vx += (input.x * speed - h.vx) * k;
  h.vz += (input.z * speed - h.vz) * k;
  if (mag <= 0.01 && Math.hypot(h.vx, h.vz) < 0.05) {
    h.vx = 0;
    h.vz = 0;
  }

  // Resistance: past the limit, outward motion fades as the hose "stretches".
  let dx = h.x - HOSE_ANCHOR.x;
  let dz = h.z - HOSE_ANCHOR.z;
  let d = reachMetric(dx, dz);
  if (d > reach - 1e-3) {
    reachNormal(dx, dz, n);
    const r = Math.min(1, Math.max(0, (d - reach) / S.stretchMax));
    const vr = h.vx * n.x + h.vz * n.z;
    if (vr > 0) {
      const keep = (1 - r) * (1 - r);
      h.vx -= n.x * vr * (1 - keep);
      h.vz -= n.z * vr * (1 - keep);
    }
  }

  h.x += h.vx * dt;
  h.z += h.vz * dt;
  clampToField(h);

  dx = h.x - HOSE_ANCHOR.x;
  dz = h.z - HOSE_ANCHOR.z;
  d = reachMetric(dx, dz);
  let pushingLimit = false;
  let over = 0;
  if (d > reach - 0.02) {
    reachNormal(dx, dz, n);
    if (mag > 0.2) pushingLimit = (input.x * n.x + input.z * n.z) / mag > 0.35;
  }
  if (d > reach) {
    // Elastic give: springs back quickly when released, gently while still pushing.
    over = Math.min(S.stretchMax, d - reach);
    over *= Math.exp(-(pushingLimit ? S.pullWhilePushing : S.springBack) * dt);
    const f = (reach + over) / d;
    h.x = HOSE_ANCHOR.x + dx * f;
    h.z = HOSE_ANCHOR.z + dz * f;
    if (!pushingLimit) {
      const vr = h.vx * n.x + h.vz * n.z;
      if (vr > 0) {
        h.vx -= n.x * vr;
        h.vz -= n.z * vr;
      }
    }
    if (over < 1e-3) over = 0;
  }
  // Keep velocity from pushing into the field walls.
  const m = HARVESTER.fieldMargin;
  if ((h.x <= FIELD.x0 + m && h.vx < 0) || (h.x >= FIELD.x0 + FIELD.width - m && h.vx > 0)) h.vx = 0;
  if ((h.z <= HARVESTER.minZ && h.vz < 0) || (h.z >= FIELD.z0 + FIELD.length - m && h.vz > 0)) h.vz = 0;

  const dNow = reachMetric(h.x - HOSE_ANCHOR.x, h.z - HOSE_ANCHOR.z);
  return {
    atLimit: dNow >= reach - 0.02,
    pushingLimit,
    speed: Math.hypot(h.vx, h.vz),
    stretch: over / S.stretchMax,
    closeness: dNow / reach,
  };
}
