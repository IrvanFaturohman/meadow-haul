// Small helpers for building chunky vertex-coloured props out of primitives and merging
// them into a single geometry (one draw call per prop / material).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  s?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Mulberry32 — deterministic PRNG for decorative variation. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → [0,1). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0,1] (for coherent colour variation). */
export function valueNoise(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const h = (a: number, b: number) => hash01(a * 374761393 + b * 668265263 + seed * 2147483647);
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function place(geo: THREE.BufferGeometry, p: Placement): THREE.BufferGeometry {
  // YXZ: tilt/lay flat first (X), then yaw (Y) — so rotated ground decals stay flat.
  _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  const s = p.s ?? 1;
  _s.set((p.sx ?? 1) * s, (p.sy ?? 1) * s, (p.sz ?? 1) * s);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Converts to non-indexed, strips UVs and bakes a flat colour (optionally with per-vertex jitter). */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const j = jitter > 0 ? 1 + (r() - 0.5) * 2 * jitter : 1;
    col[i * 3] = _c.r * j;
    col[i * 3 + 1] = _c.g * j;
    col[i * 3 + 2] = _c.b * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Paints a vertical gradient (bottom colour → top colour) over the geometry's Y extent. */
export function paintGradient(geo: THREE.BufferGeometry, bottom: THREE.ColorRepresentation, top: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = paint(geo, bottom);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.attributes.position;
  const col = g.attributes.color as THREE.BufferAttribute;
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  const tmp = new THREE.Color();
  const span = Math.max(1e-5, bb.max.y - bb.min.y);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;
    tmp.copy(a).lerp(b, t);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

// ---- Primitive shortcuts (all return painted, non-indexed geometry) -----------------

export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, p: Placement = {}, jitter = 0): THREE.BufferGeometry {
  return paint(place(new THREE.BoxGeometry(w, h, d), p), color, jitter);
}

export function rbox(w: number, h: number, d: number, r: number, color: THREE.ColorRepresentation, p: Placement = {}, seg = 2): THREE.BufferGeometry {
  return paint(place(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), p), color);
}

export function cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, p: Placement = {}, seg = 12, open = false): THREE.BufferGeometry {
  return paint(place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), p), color);
}

export function sphere(r: number, color: THREE.ColorRepresentation, p: Placement = {}, w = 10, h = 8): THREE.BufferGeometry {
  return paint(place(new THREE.SphereGeometry(r, w, h), p), color);
}

export function ico(r: number, color: THREE.ColorRepresentation, p: Placement = {}, detail = 0, jitter = 0): THREE.BufferGeometry {
  return paint(place(new THREE.IcosahedronGeometry(r, detail), p), color, jitter);
}

export function cone(r: number, h: number, color: THREE.ColorRepresentation, p: Placement = {}, seg = 10): THREE.BufferGeometry {
  return paint(place(new THREE.ConeGeometry(r, h, seg), p), color);
}

export function torus(r: number, tube: number, color: THREE.ColorRepresentation, p: Placement = {}, rs = 8, ts = 20, arc = Math.PI * 2): THREE.BufferGeometry {
  return paint(place(new THREE.TorusGeometry(r, tube, rs, ts, arc), p), color);
}

export function capsule(r: number, len: number, color: THREE.ColorRepresentation, p: Placement = {}): THREE.BufferGeometry {
  return paint(place(new THREE.CapsuleGeometry(r, len, 4, 10), p), color);
}

export function disc(r: number, color: THREE.ColorRepresentation, p: Placement = {}, seg = 24): THREE.BufferGeometry {
  return paint(place(new THREE.CircleGeometry(r, seg), { rx: -Math.PI / 2, ...p }), color);
}

export function ring(r0: number, r1: number, color: THREE.ColorRepresentation, p: Placement = {}, seg = 32): THREE.BufferGeometry {
  return paint(place(new THREE.RingGeometry(r0, r1, seg), { rx: -Math.PI / 2, ...p }), color);
}

/** Shared matte material for vertex-coloured props. */
let _vc: THREE.MeshLambertMaterial | null = null;
export function vcMaterial(): THREE.MeshLambertMaterial {
  if (!_vc) _vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  return _vc;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material = vcMaterial(), cast = true, receive = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
