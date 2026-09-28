// Reach boundary shape around the hose anchor: a rounded ellipse, wider than deep, so the
// near rows are reachable across the whole field width and Hose Length upgrades mainly
// add depth, while the far edge still curves like a hose paying out from a reel.
// The metric is homogeneous (D(k·v) = k·D(v)), so projecting along the ray from the
// anchor lands exactly on the boundary.

import { REACH_SHAPE } from '../config/balance';
import { HOSE_ANCHOR } from '../config/worldLayout';

export function reachMetric(dx: number, dz: number): number {
  const p = REACH_SHAPE.power;
  const ax = Math.abs(dx) / REACH_SHAPE.sideStretch;
  const az = Math.abs(dz);
  if (ax === 0 && az === 0) return 0;
  return Math.pow(Math.pow(ax, p) + Math.pow(az, p), 1 / p);
}

export function reachDistance(x: number, z: number): number {
  return reachMetric(x - HOSE_ANCHOR.x, z - HOSE_ANCHOR.z);
}

/** Outward unit normal of the boundary through (dx, dz) (gradient of the metric). */
export function reachNormal(dx: number, dz: number, out: { x: number; z: number }): { x: number; z: number } {
  const p = REACH_SHAPE.power;
  const s = REACH_SHAPE.sideStretch;
  const gx = (Math.sign(dx) * Math.pow(Math.abs(dx) / s, p - 1)) / s;
  const gz = Math.sign(dz) * Math.pow(Math.abs(dz), p - 1);
  const l = Math.hypot(gx, gz) || 1;
  out.x = gx / l;
  out.z = gz / l;
  return out;
}

/** Half width of the reachable band at a given depth from the anchor. */
export function reachHalfWidth(dz: number, reach: number): number {
  const p = REACH_SHAPE.power;
  const az = Math.abs(dz);
  if (az >= reach) return 0;
  return REACH_SHAPE.sideStretch * Math.pow(Math.pow(reach, p) - Math.pow(az, p), 1 / p);
}
