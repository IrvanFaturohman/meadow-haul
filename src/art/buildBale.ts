// Tied bundles of crop. One geometry per tier with its own accent so tiers are readable
// by shape and trim, not colour alone: Meadow = twine straps, Clover = cream blossoms
// on top, Golden = red straps + seed tufts at the ends.

import * as THREE from 'three';
import { TIER_COLORS } from '../config/palette';
import { box, ico, merge, paintGradient, place, rbox, sphere } from './geo';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const BALE_SIZE = { x: 0.62, y: 0.36, z: 0.42 };

export function buildBaleGeometry(tier: 0 | 1 | 2): THREE.BufferGeometry {
  const tc = TIER_COLORS[tier];
  const parts: THREE.BufferGeometry[] = [];
  const body = paintGradient(place(new RoundedBoxGeometry(BALE_SIZE.x, BALE_SIZE.y, BALE_SIZE.z, 3, 0.07), {}), tc.baleDark, tc.bale);
  // Straw texture: jitter vertex colours a little.
  const col = body.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    const j = 0.93 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.12;
    col.setXYZ(i, col.getX(i) * j, col.getY(i) * j, col.getZ(i) * j);
  }
  parts.push(body);
  // Straw ends slightly lighter
  for (const sx of [-1, 1]) parts.push(rbox(0.02, BALE_SIZE.y * 0.8, BALE_SIZE.z * 0.82, 0.01, tc.bale, { x: sx * (BALE_SIZE.x / 2 + 0.002) }));
  const strap = tier === 2 ? '#C9573F' : tier === 1 ? '#EFE3C2' : '#C9A56A';
  const strapXs = tier === 2 ? [-0.18, 0, 0.18] : [-0.15, 0.15];
  for (const x of strapXs) {
    parts.push(box(0.045, BALE_SIZE.y + 0.02, BALE_SIZE.z + 0.02, strap, { x }));
  }
  if (tier === 1) {
    const rnd = [0.1, -0.2, 0.22, -0.05, 0.14];
    for (let k = 0; k < 5; k++)
      parts.push(sphere(0.045, tc.accent, { x: -0.24 + k * 0.12, y: BALE_SIZE.y / 2 + 0.01, z: rnd[k] * 0.7 }, 6, 4));
  }
  if (tier === 2) {
    for (const sx of [-1, 1])
      for (let k = 0; k < 3; k++) parts.push(ico(0.05, '#F0D27A', { x: sx * (BALE_SIZE.x / 2 + 0.03), y: -0.05 + k * 0.07, z: (k - 1) * 0.11, sx: 1.6 }, 0));
  }
  return merge(parts);
}

let _geos: THREE.BufferGeometry[] | null = null;
export function baleGeometries(): THREE.BufferGeometry[] {
  if (!_geos) _geos = [buildBaleGeometry(0), buildBaleGeometry(1), buildBaleGeometry(2)];
  return _geos;
}

/** Scale factor for mini-bales so a 3-unit bundle reads as smaller than a full one. */
export function baleScale(qty: number): number {
  return qty >= 10 ? 1 : 0.62 + qty * 0.03;
}
