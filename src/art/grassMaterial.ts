// Procedural crop clumps (one geometry per tier) and the instanced grass material with
// wind sway, tool bend and cut/regrow transitions done in the vertex shader.

import * as THREE from 'three';
import { PALETTE, TIER_COLORS } from '../config/palette';
import { REACH_SHAPE } from '../config/balance';
import { HOSE_ANCHOR } from '../config/worldLayout';
import { rng } from './geo';

interface Builder {
  pos: number[];
  nor: number[];
  col: number[];
  /** 0 = leaf/blade, 1 = clover blossom (shown on a subset of clumps), 2 = seed head. */
  kind: number[];
  curKind?: number;
}

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function gradient(t: number, base: THREE.Color, mid: THREE.Color, tip: THREE.Color, out: THREE.Color): THREE.Color {
  if (t < 0.5) return out.copy(base).lerp(mid, t * 2);
  return out.copy(mid).lerp(tip, (t - 0.5) * 2);
}

function pushV(b: Builder, x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color) {
  b.pos.push(x, y, z);
  b.nor.push(nx, ny, nz);
  b.col.push(c.r, c.g, c.b);
  b.kind.push(b.curKind ?? 0);
}

/** A tapered, curving blade. `yaw` = lean direction. */
function blade(
  b: Builder,
  ox: number,
  oz: number,
  yaw: number,
  height: number,
  width: number,
  lean: number,
  colors: [THREE.Color, THREE.Color, THREE.Color],
  segs = 3,
  colorScale = 1,
) {
  const lx = Math.sin(yaw);
  const lz = Math.cos(yaw);
  // Width axis perpendicular to lean direction.
  const wx = lz;
  const wz = -lx;
  const nlen = Math.hypot(lx * 0.4, 1, lz * 0.4);
  const nx = (lx * 0.4) / nlen;
  const ny = 1 / nlen;
  const nz = (lz * 0.4) / nlen;
  const rows: { l: [number, number, number]; r: [number, number, number]; t: number }[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const y = t * height;
    const off = lean * height * t * t;
    const cx = ox + lx * off;
    const cz = oz + lz * off;
    const w = s === segs ? 0 : width * Math.pow(1 - t, 0.8) * 0.5;
    rows.push({ l: [cx - wx * w, y, cz - wz * w], r: [cx + wx * w, y, cz + wz * w], t });
  }
  const c0 = new THREE.Color();
  const c1 = new THREE.Color();
  for (let s = 0; s < segs; s++) {
    const a = rows[s];
    const c = rows[s + 1];
    gradient(a.t, colors[0], colors[1], colors[2], c0).multiplyScalar(colorScale);
    gradient(c.t, colors[0], colors[1], colors[2], c1).multiplyScalar(colorScale);
    if (s === segs - 1) {
      pushV(b, ...a.l, nx, ny, nz, c0);
      pushV(b, ...a.r, nx, ny, nz, c0);
      pushV(b, ...c.l, nx, ny, nz, c1);
    } else {
      pushV(b, ...a.l, nx, ny, nz, c0);
      pushV(b, ...a.r, nx, ny, nz, c0);
      pushV(b, ...c.r, nx, ny, nz, c1);
      pushV(b, ...a.l, nx, ny, nz, c0);
      pushV(b, ...c.r, nx, ny, nz, c1);
      pushV(b, ...c.l, nx, ny, nz, c1);
    }
  }
}

/** Small flat leaf (diamond) centred at (x,y,z), pointing along yaw, tilted up by `tilt`. */
function leaf(b: Builder, x: number, y: number, z: number, yaw: number, len: number, wid: number, tilt: number, c: THREE.Color, cTip: THREE.Color) {
  const dx = Math.sin(yaw) * Math.cos(tilt);
  const dy = Math.sin(tilt);
  const dz = Math.cos(yaw) * Math.cos(tilt);
  const wx = Math.cos(yaw);
  const wz = -Math.sin(yaw);
  const p0: [number, number, number] = [x, y, z];
  const p1: [number, number, number] = [x + dx * len * 0.5 + wx * wid, y + dy * len * 0.5, z + dz * len * 0.5 + wz * wid];
  const p2: [number, number, number] = [x + dx * len, y + dy * len, z + dz * len];
  const p3: [number, number, number] = [x + dx * len * 0.5 - wx * wid, y + dy * len * 0.5, z + dz * len * 0.5 - wz * wid];
  const n: [number, number, number] = [0, 1, 0];
  pushV(b, ...p0, ...n, c);
  pushV(b, ...p1, ...n, c);
  pushV(b, ...p2, ...n, cTip);
  pushV(b, ...p0, ...n, c);
  pushV(b, ...p2, ...n, cTip);
  pushV(b, ...p3, ...n, c);
}

/** Low-poly blob (octahedron-ish) used for flowers and seed heads. */
function blob(b: Builder, x: number, y: number, z: number, rx: number, ry: number, c: THREE.Color, cTop: THREE.Color, kind = 1) {
  b.curKind = kind;
  const top: [number, number, number] = [x, y + ry, z];
  const bot: [number, number, number] = [x, y - ry, z];
  const seg = 6;
  const ring: [number, number, number][] = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2 + 0.4;
    ring.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rx]);
  }
  for (let k = 0; k < seg; k++) {
    const a = ring[k];
    const d = ring[(k + 1) % seg];
    pushV(b, ...a, 0, 1, 0, c);
    pushV(b, ...top, 0, 1, 0, cTop);
    pushV(b, ...d, 0, 1, 0, c);
    pushV(b, ...a, 0, 0.3, 0, c);
    pushV(b, ...d, 0, 0.3, 0, c);
    pushV(b, ...bot, 0, 0.3, 0, c);
  }
  b.curKind = 0;
}

function finish(b: Builder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(b.kind.length ? b.kind : new Array(b.pos.length / 3).fill(0), 1));
  g.computeBoundingSphere();
  return g;
}

export type GrassDetail = 'low' | 'normal' | 'rich';

export function buildClumpGeometry(tier: 0 | 1 | 2, detail: GrassDetail): THREE.BufferGeometry {
  const r = rng(101 + tier * 17);
  const b: Builder = { pos: [], nor: [], col: [], kind: [] };
  const tc = TIER_COLORS[tier];
  const cols: [THREE.Color, THREE.Color, THREE.Color] = [new THREE.Color(tc.base), new THREE.Color(tc.mid), new THREE.Color(tc.tip)];
  const segs = detail === 'low' ? 2 : 3;
  if (tier === 0) {
    const n = detail === 'low' ? 4 : detail === 'rich' ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + r() * 0.8;
      const rad = 0.02 + r() * 0.05;
      const h = 0.72 + r() * 0.3;
      blade(b, Math.sin(yaw) * rad, Math.cos(yaw) * rad, yaw, h, 0.075 + r() * 0.025, 0.18 + r() * 0.2, cols, segs, 0.92 + r() * 0.16);
    }
  } else if (tier === 1) {
    const leafC = new THREE.Color(PALETTE.clover);
    const leafTip = new THREE.Color(PALETTE.cloverTip);
    const flower = new THREE.Color(PALETTE.cloverFlower);
    const flowerTop = new THREE.Color('#FFF0F6');
    const stems = detail === 'low' ? 3 : 4;
    for (let i = 0; i < stems; i++) {
      const yaw = (i / stems) * Math.PI * 2 + r() * 0.7;
      const rad = 0.05 + r() * 0.06;
      const sx = Math.sin(yaw) * rad;
      const sz = Math.cos(yaw) * rad;
      const h = 0.34 + r() * 0.14;
      blade(b, sx, sz, yaw, h, 0.035, 0.12, cols, 2);
      const tx = sx + Math.sin(yaw) * 0.12 * h * 0.1;
      const tz = sz + Math.cos(yaw) * 0.12 * h * 0.1;
      // Trefoil
      for (let k = 0; k < 3; k++) {
        const ly = yaw + (k / 3) * Math.PI * 2 + r() * 0.3;
        leaf(b, tx, h, tz, ly, 0.13 + r() * 0.03, 0.055, 0.15 + r() * 0.2, tmpA.copy(leafC).multiplyScalar(0.9 + r() * 0.2), tmpB.copy(leafTip));
      }
    }
    const flowers = 1;
    for (let i = 0; i < flowers; i++) {
      const yaw = r() * Math.PI * 2;
      const rad = 0.03 + r() * 0.05;
      const fx = Math.sin(yaw) * rad;
      const fz = Math.cos(yaw) * rad;
      const h = 0.5 + r() * 0.12;
      blade(b, fx, fz, yaw, h, 0.025, 0.05, cols, 2);
      blob(b, fx + Math.sin(yaw) * 0.0025, h + 0.02, fz + Math.cos(yaw) * 0.0025, 0.065, 0.055, flower, flowerTop, 1);
    }
  } else {
    const seed = new THREE.Color(PALETTE.goldTip);
    const seedTop = new THREE.Color('#F7E3A0');
    const n = detail === 'low' ? 3 : detail === 'rich' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + r() * 0.8;
      const rad = 0.02 + r() * 0.05;
      const h = 0.9 + r() * 0.3;
      blade(b, Math.sin(yaw) * rad, Math.cos(yaw) * rad, yaw, h, 0.07 + r() * 0.02, 0.12 + r() * 0.16, cols, segs, 0.92 + r() * 0.16);
    }
    const heads = detail === 'low' ? 1 : 2;
    for (let i = 0; i < heads; i++) {
      const yaw = r() * Math.PI * 2;
      const rad = 0.02 + r() * 0.04;
      const hx = Math.sin(yaw) * rad;
      const hz = Math.cos(yaw) * rad;
      const h = 1.12 + r() * 0.16;
      blade(b, hx, hz, yaw, h, 0.03, 0.06, cols, 2);
      const tx = hx + Math.sin(yaw) * 0.06 * h;
      const tz = hz + Math.cos(yaw) * 0.06 * h;
      blob(b, tx, h + 0.06, tz, 0.045, 0.12, seed, seedTop, 2);
    }
  }
  return finish(b);
}

/**
 * Loose cuttings: a soft mound of short cut blades (a ring leaning outward plus a few
 * upright bits), tinted per tier by instance colour. Neighbouring mounds overlap into a
 * fluffy carpet so the cut swath reads as "something to vacuum up".
 */
export function buildClippingsGeometry(): THREE.BufferGeometry {
  const r = rng(77);
  const b: Builder = { pos: [], nor: [], col: [], kind: [] };
  const c = new THREE.Color();
  const cTip = new THREE.Color();
  const ring = 13;
  for (let i = 0; i < ring; i++) {
    const yaw = (i / ring) * Math.PI * 2 + r() * 0.45;
    const start = r() * 0.05;
    const len = 0.13 + r() * 0.1;
    const tilt = 0.2 + r() * 0.45;
    c.setScalar(0.72 + r() * 0.22);
    cTip.copy(c).multiplyScalar(1.18);
    leaf(b, Math.sin(yaw) * start, 0.015 + r() * 0.03, Math.cos(yaw) * start, yaw, len, 0.032 + r() * 0.016, tilt, c, cTip);
  }
  // Crossing bits on top give the pile some height.
  for (let i = 0; i < 6; i++) {
    const yaw = r() * Math.PI * 2;
    const len = 0.12 + r() * 0.08;
    c.setScalar(0.85 + r() * 0.25);
    cTip.copy(c).multiplyScalar(1.12);
    leaf(b, (r() - 0.5) * 0.08, 0.05 + r() * 0.05, (r() - 0.5) * 0.08, yaw, len, 0.03, (r() - 0.5) * 0.6, c, cTip);
  }
  for (let i = 0; i < 5; i++) {
    const yaw = r() * Math.PI * 2;
    const col: [THREE.Color, THREE.Color, THREE.Color] = [new THREE.Color().setScalar(0.7), new THREE.Color().setScalar(0.9), new THREE.Color().setScalar(1.08)];
    blade(b, (r() - 0.5) * 0.1, (r() - 0.5) * 0.1, yaw, 0.08 + r() * 0.07, 0.035, 0.9, col, 2);
  }
  return finish(b);
}

/** Single flying sliver for debris particles. */
export function buildSliverGeometry(): THREE.BufferGeometry {
  const b: Builder = { pos: [], nor: [], col: [], kind: [] };
  const c = new THREE.Color(1, 1, 1);
  const c2 = new THREE.Color(0.85, 0.85, 0.85);
  leaf(b, 0, 0, -0.08, 0, 0.16, 0.03, 0, c, c2);
  // Second crossed plane so it reads from every angle.
  const n = b.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = b.pos[i * 3];
    const y = b.pos[i * 3 + 1];
    const z = b.pos[i * 3 + 2];
    b.pos.push(y, x, z);
    b.nor.push(0, 1, 0);
    b.col.push(b.col[i * 3], b.col[i * 3 + 1], b.col[i * 3 + 2]);
  }
  return finish(b);
}

export interface GrassUniforms {
  uTime: { value: number };
  uWind: { value: number };
  uToolPos: { value: THREE.Vector3 };
  uToolRadius: { value: number };
  uToolVel: { value: THREE.Vector2 };
  uToolPush: { value: number };
  uStubble: { value: THREE.Color };
  uAnchor: { value: THREE.Vector2 };
  uReachFrom: { value: number };
  uReachTo: { value: number };
  uReachSweep: { value: number };
  uReachFlash: { value: number };
  uReachShape: { value: THREE.Vector2 };
  /** 0..1 vacuum suction strength (smoothed). */
  uVacPull: { value: number };
  uVacInner: { value: number };
  uVacOuter: { value: number };
}

export function createGrassUniforms(): GrassUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uToolPos: { value: new THREE.Vector3(0, 0, -100) },
    uToolRadius: { value: 0.5 },
    uToolVel: { value: new THREE.Vector2() },
    uToolPush: { value: 0 },
    uStubble: { value: new THREE.Color(PALETTE.stubble) },
    uAnchor: { value: new THREE.Vector2(HOSE_ANCHOR.x, HOSE_ANCHOR.z) },
    uReachFrom: { value: 0 },
    uReachTo: { value: 0 },
    uReachSweep: { value: 0 },
    uReachFlash: { value: 0 },
    uReachShape: { value: new THREE.Vector2(REACH_SHAPE.sideStretch, REACH_SHAPE.power) },
    uVacPull: { value: 0 },
    uVacInner: { value: 1.5 },
    uVacOuter: { value: 2.7 },
  };
}

/**
 * Per-instance attribute `aInfo` = (targetHeight, transitionStart, prevHeight, damage01).
 * Heights are multipliers of the clump's full height (1 = standing, ~0.07 = stubble).
 */
export function createGrassMaterial(uniforms: GrassUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aInfo;
        attribute float aKind;
        uniform float uTime;
        uniform float uWind;
        uniform vec3 uToolPos;
        uniform float uToolRadius;
        uniform vec2 uToolVel;
        uniform float uToolPush;
        uniform vec2 uAnchor;
        uniform float uReachFrom;
        uniform float uReachTo;
        uniform float uReachSweep;
        uniform float uReachFlash;
        uniform vec2 uReachShape;
        varying float vStub;
        varying float vDmg;
        varying float vReach;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        bool growing = aInfo.x > aInfo.z;
        float tt = clamp((uTime - aInfo.y) / (growing ? 0.42 : 0.07), 0.0, 1.0);
        float ee = growing ? (1.0 - pow(1.0 - tt, 3.0)) + sin(tt * 3.14159) * 0.12 : tt;
        float hf = mix(aInfo.z, aInfo.x, ee);
        float hw = position.y;
        transformed.y *= hf * (1.0 - aInfo.w * 0.18);
        // Stubble is a compact short tuft, not full-length blades lying flat.
        transformed.xz *= mix(0.22, 1.0, clamp(hf, 0.0, 1.0));
        vStub = 1.0 - clamp(hf, 0.0, 1.0);
        vDmg = aInfo.w;
        #ifdef USE_INSTANCING
          vec2 ipk = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float blossom = fract(sin(dot(ipk, vec2(12.9898, 78.233))) * 43758.5453);
          // Only ~10% of clover clumps show a blossom; hidden ones collapse into the base.
          if (aKind > 0.5 && aKind < 1.5 && blossom > 0.1) transformed = vec3(0.0);
          // Cut crops lose their blossoms and seed heads.
          if (aKind > 0.5 && hf < 0.5) transformed = vec3(0.0);
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float w2 = hw * hw * hf;
        float ph = ip.x * 0.55 + ip.z * 0.37;
        float gust = 0.55 + 0.45 * sin(uTime * 0.35 + ip.z * 0.08 - ip.x * 0.05);
        float sway = (sin(uTime * 1.7 + ph) * 0.65 + sin(uTime * 2.9 + ph * 1.9) * 0.3) * gust;
        vec2 bend = vec2(sway * 0.07, 0.035 + sway * 0.03) * uWind * w2;
        vec2 dd = ip.xz - uToolPos.xz;
        float dist = length(dd);
        float infl = (1.0 - smoothstep(uToolRadius * 0.55, uToolRadius + 0.85, dist)) * uToolPush;
        vec2 away = dist > 0.0001 ? dd / dist : vec2(0.0, 1.0);
        bend += (away * 0.32 + uToolVel * 0.05) * infl * w2;
        bend += vec2(0.06, 0.09) * aInfo.w * w2;
        // Newly reachable crop glows briefly after a Hose Length upgrade (no boundary line).
        vReach = 0.0;
        if (uReachFlash > 0.001) {
          vec2 rd = ip.xz - uAnchor;
          float rD = pow(pow(abs(rd.x) / uReachShape.x, uReachShape.y) + pow(abs(rd.y), uReachShape.y), 1.0 / uReachShape.y);
          float front = mix(uReachFrom, uReachTo, uReachSweep);
          float band = step(uReachFrom, rD) * (1.0 - smoothstep(front - 0.1, front + 0.35, rD));
          float edge = exp(-pow((rD - front) * 2.5, 2.0));
          vReach = (band * 0.45 + edge * 0.55) * uReachFlash;
        }
        mvPosition.xz += bend;
        mvPosition.y -= dot(bend, bend) * 0.9;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uStubble;
        varying float vStub;
        varying float vDmg;
        varying float vReach;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uStubble * (0.85 + diffuseColor.g * 0.35), smoothstep(0.35, 0.9, vStub) * 0.85);
        diffuseColor.rgb *= 1.0 - vDmg * 0.15;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.95, 0.66), clamp(vReach, 0.0, 1.0) * 0.55);`,
      )
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => 'meadow-grass-v2';
  return mat;
}

/** Double-sided flat foliage lit the same from both sides (no dark back faces). */
export function createFoliageMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => 'meadow-foliage-v1';
  return mat;
}

/**
 * Loose cuttings: foliage lighting plus vacuum attraction. Piles near the nozzle drift
 * toward it, swirl and lift a little before being taken, so suction reads from a distance.
 */
export function createLooseMaterial(uniforms: GrassUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uToolPos;
        uniform float uVacPull;
        uniform float uVacInner;
        uniform float uVacOuter;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          vec2 dd = uToolPos.xz - ip.xz;
          float d = length(dd);
          float pull = uVacPull * (1.0 - smoothstep(uVacInner * 0.45, uVacOuter, d));
          if (pull > 0.001) {
            vec2 dir = d > 0.0001 ? dd / d : vec2(0.0);
            vec3 local = mvPosition.xyz - ip;
            float ang = pull * (1.3 + 0.7 * sin(uTime * 9.0 + ip.x * 7.0 + ip.z * 3.0));
            float cs = cos(ang);
            float sn = sin(ang);
            local.xz = mat2(cs, -sn, sn, cs) * local.xz;
            local.y *= 1.0 + pull * 1.1;
            mvPosition.xyz = ip + local;
            mvPosition.xz += dir * pull * min(d * 0.5, 0.5);
            mvPosition.xz += vec2(sin(uTime * 23.0 + ip.z * 11.0), cos(uTime * 19.0 + ip.x * 13.0)) * 0.03 * pull;
            mvPosition.y += pull * pull * 0.08;
          }
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => 'meadow-loose-v1';
  return mat;
}
