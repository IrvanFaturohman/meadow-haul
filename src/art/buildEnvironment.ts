// Static farm environment: ground, paths, road, fences, trees, workshop, pallets,
// conveyor and labelled interaction pads. Decoration is merged into few draw calls
// and kept clear of pads and walking routes.

import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import {
  CONVEYOR,
  DOCK,
  FIELD,
  PADS,
  PALLETS,
  PALLET_SIZE,
  ROAD,
  WORKSHOP,
  type Pad,
  type Vec2,
} from '../config/worldLayout';
import { box, cone, cyl, disc, ico, merge, mesh, paint, place, rbox, rng, sphere, valueNoise } from './geo';

export interface PadRig {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  pad: Pad;
}

export interface EnvironmentRig {
  root: THREE.Group;
  pads: Record<keyof typeof PADS, PadRig>;
  pallets: THREE.Mesh[];
  workshopLampMat: THREE.MeshBasicMaterial;
  workshopGlow: THREE.Mesh;
  workshopGlowMat: THREE.MeshBasicMaterial;
  conveyorTex: THREE.CanvasTexture;
  hireGroup: THREE.Group;
  cashAnchor: THREE.Vector3;
}

const ICONS: Record<string, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  harvest(ctx, s) {
    // Tractor-ish wheel + blade
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14);
      ctx.lineTo(Math.cos(a + 0.5) * s * 0.42, Math.sin(a + 0.5) * s * 0.42);
      ctx.stroke();
    }
  },
  bale(ctx, s) {
    ctx.strokeRect(-s * 0.45, -s * 0.28, s * 0.9, s * 0.56);
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.28);
    ctx.lineTo(-s * 0.15, s * 0.28);
    ctx.moveTo(s * 0.15, -s * 0.28);
    ctx.lineTo(s * 0.15, s * 0.28);
    ctx.stroke();
  },
  truck(ctx, s) {
    ctx.strokeRect(-s * 0.48, -s * 0.2, s * 0.6, s * 0.36);
    ctx.strokeRect(s * 0.12, -s * 0.08, s * 0.34, s * 0.24);
    ctx.beginPath();
    ctx.arc(-s * 0.3, s * 0.24, s * 0.09, 0, Math.PI * 2);
    ctx.arc(s * 0.3, s * 0.24, s * 0.09, 0, Math.PI * 2);
    ctx.stroke();
  },
  coin(ctx, s) {
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `900 ${s * 0.5}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, s * 0.03);
  },
  gear(ctx, s) {
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r = k % 2 === 0 ? s * 0.44 : s * 0.33;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.13, 0, Math.PI * 2);
    ctx.stroke();
  },
  worker(ctx, s) {
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, s * 0.16, 0, Math.PI * 2);
    ctx.moveTo(-s * 0.3, s * 0.42);
    ctx.quadraticCurveTo(0, -s * 0.12, s * 0.3, s * 0.42);
    ctx.stroke();
  },
};

function padTexture(label: string, sub: string, _accent: string, icon: keyof typeof ICONS): THREE.CanvasTexture {
  // Reference-style pad: soft green fill, white dashed outline, white outlined lettering.
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const r = 46;
  const m = 12;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = PALETTE.padFill;
  ctx.beginPath();
  ctx.roundRect(m, m, S - m * 2, S - m * 2, r);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PALETTE.padLine;
  ctx.lineWidth = 11;
  ctx.setLineDash([24, 15]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.roundRect(m + 8, m + 8, S - (m + 8) * 2, S - (m + 8) * 2, r - 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.save();
  ctx.translate(S / 2, S * 0.38);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Dark outline pass, then white icon on top.
  ctx.strokeStyle = PALETTE.padStroke;
  ctx.fillStyle = PALETTE.padStroke;
  ctx.lineWidth = 17;
  ICONS[icon](ctx, 92);
  ctx.strokeStyle = PALETTE.padText;
  ctx.fillStyle = PALETTE.padText;
  ctx.lineWidth = 9;
  ICONS[icon](ctx, 92);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = label.length > 9 ? 32 : 40;
  ctx.font = `900 ${size}px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`;
  ctx.lineWidth = 9;
  ctx.strokeStyle = PALETTE.padStroke;
  ctx.strokeText(label, S / 2, S * 0.74);
  ctx.fillStyle = PALETTE.padText;
  ctx.fillText(label, S / 2, S * 0.74);
  if (sub) {
    ctx.font = `800 23px ui-rounded, system-ui, sans-serif`;
    ctx.lineWidth = 6;
    ctx.strokeText(sub, S / 2, S * 0.87);
    ctx.fillText(sub, S / 2, S * 0.87);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildPad(pad: Pad, label: string, sub: string, accent: string, icon: keyof typeof ICONS): PadRig {
  const size = pad.r * 2.1;
  const geo = new THREE.PlaneGeometry(size, size);
  // Lay flat and rotate so the text reads upright for a camera looking along +Z.
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI);
  const mat = new THREE.MeshBasicMaterial({ map: padTexture(label, sub, accent, icon), transparent: true, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pad.x, 0.02, pad.z);
  m.renderOrder = 1;
  const ringMat = new THREE.MeshBasicMaterial({ color: accent === PALETTE.cashDark ? '#FFF6A8' : '#FFFFFF', transparent: true, opacity: 0, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(pad.r * 1.08, pad.r * 1.2, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pad.x, 0.025, pad.z);
  ring.renderOrder = 1;
  return { mesh: m, mat, ring, ringMat, pad };
}

function fenceLine(parts: THREE.BufferGeometry[], a: Vec2, b: Vec2, spacing = 1.25): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.round(len / spacing));
  const ang = Math.atan2(b.x - a.x, b.z - a.z);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    parts.push(box(0.14, 0.62, 0.14, PALETTE.woodDark, { x, y: 0.31, z }));
    parts.push(box(0.18, 0.05, 0.18, PALETTE.wood, { x, y: 0.64, z }));
  }
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  for (const y of [0.24, 0.48]) parts.push(box(0.06, 0.09, len, PALETTE.wood, { x: mx, y, z: mz, ry: ang }));
}

function tree(parts: THREE.BufferGeometry[], x: number, z: number, s: number, seed: number): void {
  const r = rng(seed);
  parts.push(cyl(0.12 * s, 0.18 * s, 1.1 * s, PALETTE.trunk, { x, y: 0.55 * s, z }, 7));
  const blobs = 3 + Math.floor(r() * 2);
  for (let k = 0; k < blobs; k++) {
    const a = r() * Math.PI * 2;
    const rr = (0.2 + r() * 0.35) * s;
    const col = r() > 0.5 ? PALETTE.leafDark : PALETTE.leafLight;
    parts.push(ico((0.55 + r() * 0.35) * s, col, { x: x + Math.cos(a) * rr, y: (1.35 + r() * 0.6) * s, z: z + Math.sin(a) * rr }, 1, 0.06));
  }
}

function bush(parts: THREE.BufferGeometry[], x: number, z: number, s: number, seed: number): void {
  const r = rng(seed);
  for (let k = 0; k < 3; k++) {
    parts.push(ico((0.28 + r() * 0.16) * s, k === 1 ? PALETTE.leafLight : PALETTE.leafDark, { x: x + (r() - 0.5) * 0.5 * s, y: 0.22 * s, z: z + (r() - 0.5) * 0.4 * s, sy: 0.8 }, 1, 0.08));
  }
}

function flowers(parts: THREE.BufferGeometry[], x: number, z: number, seed: number): void {
  const r = rng(seed);
  const cols = [PALETTE.flowerWhite, PALETTE.flowerPink, PALETTE.flowerYellow];
  for (let k = 0; k < 6; k++) {
    const fx = x + (r() - 0.5) * 1.1;
    const fz = z + (r() - 0.5) * 0.8;
    parts.push(cyl(0.012, 0.012, 0.22, PALETTE.leafDark, { x: fx, y: 0.11, z: fz }, 4));
    parts.push(sphere(0.06, cols[k % 3], { x: fx, y: 0.24, z: fz }, 6, 4));
  }
}

export function buildEnvironment(): EnvironmentRig {
  const root = new THREE.Group();

  // ---- Ground with gentle colour variation --------------------------------------
  const gGeo = new THREE.PlaneGeometry(90, 90, 90, 90);
  gGeo.rotateX(-Math.PI / 2);
  gGeo.translate(0, 0, 6);
  const gCol = new Float32Array(gGeo.attributes.position.count * 3);
  const cA = new THREE.Color(PALETTE.farmGrass);
  const cB = new THREE.Color(PALETTE.farmGrassDark);
  const cT = new THREE.Color();
  for (let i = 0; i < gGeo.attributes.position.count; i++) {
    const x = gGeo.attributes.position.getX(i);
    const z = gGeo.attributes.position.getZ(i);
    const n = valueNoise(x * 0.18, z * 0.18, 5) * 0.7 + valueNoise(x * 0.6, z * 0.6, 8) * 0.3;
    cT.copy(cA).lerp(cB, n * 0.6);
    gCol[i * 3] = cT.r;
    gCol[i * 3 + 1] = cT.g;
    gCol[i * 3 + 2] = cT.b;
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3));
  gGeo.deleteAttribute('uv');
  const ground = new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true;
  root.add(ground);

  // ---- Flat decals: paths, road, pad bases ----------------------------------------
  const decals: THREE.BufferGeometry[] = [];
  const path = (a: Vec2, b: Vec2, w = 1.6) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
    decals.push(paint(place(new THREE.PlaneGeometry(w + 0.18, len), { rx: -Math.PI / 2, ry: ang, x: (a.x + b.x) / 2, y: 0.006, z: (a.z + b.z) / 2 }), PALETTE.pathEdge));
    decals.push(paint(place(new THREE.PlaneGeometry(w, len), { rx: -Math.PI / 2, ry: ang, x: (a.x + b.x) / 2, y: 0.009, z: (a.z + b.z) / 2 }), PALETTE.path));
    decals.push(disc(w / 2 + 0.09, PALETTE.pathEdge, { x: a.x, y: 0.0065, z: a.z }, 18));
    decals.push(disc(w / 2 + 0.09, PALETTE.pathEdge, { x: b.x, y: 0.0065, z: b.z }, 18));
    decals.push(disc(w / 2, PALETTE.path, { x: a.x, y: 0.0095, z: a.z }, 18));
    decals.push(disc(w / 2, PALETTE.path, { x: b.x, y: 0.0095, z: b.z }, 18));
  };
  const H = PADS.harvest;
  const Dp = PADS.depot;
  const Dl = PADS.deliver;
  const Ca = PADS.cash;
  const U = PADS.upgrade;
  const Hi = PADS.hauler;
  path(H, Dp);
  path(Dp, Dl);
  path(Dl, Ca);
  path(Ca, Hi);
  path(Hi, U);
  path(H, U);
  path(H, Ca);
  // Loading apron by the truck
  decals.push(paint(place(new THREE.PlaneGeometry(3.8, 1.3), { rx: -Math.PI / 2, x: Dl.x - 0.2, y: 0.008, z: ROAD.z + 1.55 }), PALETTE.path));
  // Road
  decals.push(paint(place(new THREE.PlaneGeometry(90, ROAD.width + 0.3), { rx: -Math.PI / 2, y: 0.01, z: ROAD.z }), PALETTE.pathEdge));
  decals.push(paint(place(new THREE.PlaneGeometry(90, ROAD.width), { rx: -Math.PI / 2, y: 0.012, z: ROAD.z }), PALETTE.road));
  for (let x = -40; x < 40; x += 2.2) decals.push(paint(place(new THREE.PlaneGeometry(1.1, 0.12), { rx: -Math.PI / 2, x, y: 0.014, z: ROAD.z }), PALETTE.roadLine));
  // Dirt skirt around the field
  decals.push(paint(place(new THREE.PlaneGeometry(FIELD.width + 1.1, FIELD.length + 1.2), { rx: -Math.PI / 2, x: 0, y: 0.003, z: FIELD.length / 2 }), PALETTE.soilDark));
  // Machine standing area
  decals.push(paint(place(new THREE.PlaneGeometry(3.4, 4.2), { rx: -Math.PI / 2, x: 0, y: 0.007, z: -2.6 }), PALETTE.pathEdge));
  // Depot slab
  const pcx = (PALLETS[0].x + PALLETS[1].x) / 2;
  const pcz = (PALLETS[0].z + PALLETS[2].z) / 2;
  decals.push(paint(place(new THREE.PlaneGeometry(3.3, 3.3), { rx: -Math.PI / 2, x: pcx, y: 0.007, z: pcz }), '#F6CE8C'));
  const decalMesh = new THREE.Mesh(merge(decals), new THREE.MeshLambertMaterial({ vertexColors: true }));
  decalMesh.receiveShadow = true;
  root.add(decalMesh);

  // ---- Solid props (merged, cast shadows) ------------------------------------------
  const props: THREE.BufferGeometry[] = [];
  const fx0 = FIELD.x0 - 0.45;
  const fx1 = FIELD.x0 + FIELD.width + 0.45;
  const fz1 = FIELD.z0 + FIELD.length + 0.5;
  fenceLine(props, { x: fx0, z: -0.75 }, { x: fx0, z: fz1 });
  fenceLine(props, { x: fx1, z: -0.75 }, { x: fx1, z: fz1 });
  fenceLine(props, { x: fx0, z: fz1 }, { x: fx1, z: fz1 });
  fenceLine(props, { x: fx0, z: -0.75 }, { x: -1.5, z: -0.75 });
  fenceLine(props, { x: 1.5, z: -0.75 }, { x: fx1, z: -0.75 });
  // Farm yard boundary (road fence has a gap at the truck loading bay)
  const roadFence = ROAD.z + ROAD.width / 2 + 0.05;
  fenceLine(props, { x: fx0, z: roadFence }, { x: fx0, z: -0.75 });
  fenceLine(props, { x: fx1, z: roadFence }, { x: fx1, z: -0.75 });
  fenceLine(props, { x: fx0, z: roadFence }, { x: -5.4, z: roadFence });
  fenceLine(props, { x: -1.7, z: roadFence }, { x: fx1, z: roadFence });

  // Trees & bushes outside the play space
  let seed = 11;
  const treeSpots: [number, number, number][] = [
    [-7.6, -11.0, 1.1], [-8.8, -7.4, 1.3], [-7.7, -3.6, 1.0], [-8.9, 0.4, 1.25], [-7.5, 3.8, 1.05],
    [-8.6, 7.6, 1.3], [-7.4, 11.5, 1.1], [-8.8, 15.8, 1.35], [-7.6, 20.4, 1.0], [-8.7, 25.0, 1.2], [-7.5, 29.6, 1.1],
    [7.5, -10.6, 1.15], [8.8, -6.8, 1.3], [7.6, -2.6, 1.0], [8.9, 1.6, 1.25], [7.4, 5.8, 1.1], [8.7, 10.2, 1.3],
    [7.5, 14.6, 1.0], [8.9, 19.2, 1.2], [7.5, 23.8, 1.1], [8.8, 28.4, 1.3],
    [-5.5, 31.8, 1.2], [-1.6, 32.4, 1.0], [2.4, 31.9, 1.3], [6.0, 32.6, 1.1],
    [-10.5, -15.4, 1.3], [-6.2, -15.9, 1.1], [-1.8, -15.5, 1.2], [2.6, -16.0, 1.0], [6.8, -15.4, 1.25], [11.0, -15.8, 1.1],
  ];
  for (const [x, z, s] of treeSpots) tree(props, x, z, s, seed++);
  const bushSpots: [number, number][] = [
    [-5.9, -1.5], [5.9, -1.3], [5.9, -11.2], [-6.0, -7.9], [6.0, -6.0], [-6.0, 30.4], [6.1, 30.6], [-10.4, 11], [10.4, 12.5],
  ];
  for (const [x, z] of bushSpots) bush(props, x, z, 1, seed++);
  const flowerSpots: [number, number][] = [[-5.6, -2.6], [5.4, -8.6], [-5.5, -9.4], [2.2, -1.7], [-2.2, -1.6], [5.3, -2.9]];
  for (const [x, z] of flowerSpots) flowers(props, x, z, seed++);
  const rr = rng(99);
  for (let k = 0; k < 10; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    props.push(ico(0.18 + rr() * 0.18, PALETTE.rock, { x: side * (7.0 + rr() * 2.5), y: 0.08, z: -8 + rr() * 34, sy: 0.6 }, 0, 0.05));
  }

  // Workshop
  const W = WORKSHOP;
  const front = W.z - W.d / 2;
  props.push(rbox(W.w, 1.55, W.d, 0.06, PALETTE.wall, { x: W.x, y: 0.78, z: W.z }));
  props.push(box(W.w + 0.08, 0.12, W.d + 0.08, PALETTE.woodDark, { x: W.x, y: 0.06, z: W.z }));
  // Gable roof
  const roofW = W.d / 2 + 0.35;
  props.push(box(W.w + 0.5, 0.14, roofW * 1.08, PALETTE.roof, { x: W.x, y: 1.95, z: W.z - roofW * 0.48, rx: -0.55 }));
  props.push(box(W.w + 0.5, 0.14, roofW * 1.08, PALETTE.roof, { x: W.x, y: 1.95, z: W.z + roofW * 0.48, rx: 0.55 }));
  props.push(box(W.w + 0.02, 0.62, 0.06, PALETTE.wall, { x: W.x, y: 1.75, z: front + 0.18, sx: 0.98 }));
  props.push(box(0.2, 0.2, W.d * 1.1, '#C9442F', { x: W.x, y: 2.42, z: W.z, rx: Math.PI / 4 }));
  // Door + frame
  props.push(box(0.9, 1.15, 0.06, PALETTE.woodDark, { x: W.x - 0.45, y: 0.6, z: front - 0.02 }));
  props.push(box(0.8, 1.05, 0.05, PALETTE.wood, { x: W.x - 0.45, y: 0.56, z: front - 0.05 }));
  props.push(box(0.8, 0.05, 0.06, PALETTE.woodDark, { x: W.x - 0.45, y: 0.56, z: front - 0.08, rz: 0.9 }));
  // Window frame
  props.push(box(0.7, 0.55, 0.06, PALETTE.woodDark, { x: W.x + 0.75, y: 0.95, z: front - 0.02 }));
  // Chimney
  props.push(box(0.3, 0.7, 0.3, '#DE6A4E', { x: W.x + 0.9, y: 2.3, z: W.z + 0.4 }));
  // Workbench + barrel outside
  props.push(box(0.9, 0.08, 0.45, PALETTE.wood, { x: W.x + 1.95, y: 0.6, z: W.z - 0.2 }));
  for (const dx of [-0.38, 0.38]) props.push(box(0.07, 0.58, 0.4, PALETTE.woodDark, { x: W.x + 1.95 + dx, y: 0.3, z: W.z - 0.2 }));
  props.push(cyl(0.26, 0.26, 0.62, PALETTE.woodDark, { x: W.x + 1.9, y: 0.31, z: W.z + 0.75 }, 12));
  props.push(cyl(0.27, 0.27, 0.05, PALETTE.metalLight, { x: W.x + 1.9, y: 0.5, z: W.z + 0.75 }, 12));
  // Sign post on roof front with gear
  props.push(rbox(1.1, 0.42, 0.06, 0.05, PALETTE.cream, { x: W.x + 0.2, y: 1.72, z: front - 0.02 }));

  // Conveyor from machine to depot
  const cvLen = CONVEYOR.x0 - CONVEYOR.x1;
  const cvX = (CONVEYOR.x0 + CONVEYOR.x1) / 2;
  for (const dz of [-0.3, 0.3]) props.push(box(cvLen, 0.1, 0.06, PALETTE.rubber, { x: cvX, y: 0.62, z: CONVEYOR.z + dz }));
  for (const dx of [-cvLen / 2 + 0.2, 0, cvLen / 2 - 0.2])
    for (const dz of [-0.28, 0.28]) props.push(box(0.07, 0.6, 0.07, PALETTE.rubber, { x: cvX + dx, y: 0.3, z: CONVEYOR.z + dz }));
  for (let k = 0; k < 6; k++) props.push(cyl(0.05, 0.05, 0.56, PALETTE.metalLight, { x: CONVEYOR.x1 + 0.15 + k * (cvLen - 0.3) / 5, y: 0.55, z: CONVEYOR.z, rx: Math.PI / 2 }, 8));

  // Replant sign by the field
  props.push(box(0.1, 1.0, 0.1, PALETTE.woodDark, { x: 2.6, y: 0.5, z: -1.2 }));
  props.push(rbox(0.9, 0.5, 0.07, 0.04, PALETTE.wood, { x: 2.6, y: 1.05, z: -1.25 }));
  props.push(cone(0.1, 0.22, PALETTE.leafLight, { x: 2.6, y: 1.08, z: -1.31 }, 6));

  // Water trough by the fence (decor, outside walking routes)
  props.push(rbox(1.0, 0.36, 0.45, 0.05, PALETTE.woodDark, { x: 5.9, y: 0.18, z: -8.4, ry: Math.PI / 2 }));
  props.push(box(0.34, 0.02, 0.88, '#6CC8F0', { x: 5.9, y: 0.33, z: -8.4 }));

  const propMesh = mesh(merge(props));
  propMesh.receiveShadow = true;
  root.add(propMesh);

  // Workshop window lamp + sign texture + light pool
  const workshopLampMat = new THREE.MeshBasicMaterial({ color: '#6D5C43' });
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), workshopLampMat);
  lamp.rotation.y = Math.PI;
  lamp.position.set(W.x + 0.75, 0.95, front - 0.06);
  root.add(lamp);
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256;
  signCanvas.height = 96;
  const sctx = signCanvas.getContext('2d')!;
  sctx.fillStyle = PALETTE.cream;
  sctx.fillRect(0, 0, 256, 96);
  sctx.fillStyle = PALETTE.textDark;
  sctx.font = '900 44px ui-rounded, system-ui, sans-serif';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('WORKSHOP', 128, 50);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.rotation.y = Math.PI;
  sign.position.set(W.x + 0.2, 1.72, front - 0.06);
  root.add(sign);
  const workshopGlowMat = new THREE.MeshBasicMaterial({ color: '#FFE3A1', transparent: true, opacity: 0, depthWrite: false });
  const workshopGlow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), workshopGlowMat);
  workshopGlow.rotation.x = -Math.PI / 2;
  workshopGlow.position.set(W.x + 0.2, 0.03, front - 1.0);
  root.add(workshopGlow);

  // Conveyor belt with scrolling stripes
  const bc = document.createElement('canvas');
  bc.width = 64;
  bc.height = 16;
  const bctx = bc.getContext('2d')!;
  bctx.fillStyle = '#4A5A6E';
  bctx.fillRect(0, 0, 64, 16);
  bctx.fillStyle = '#6E8199';
  for (let k = 0; k < 4; k++) bctx.fillRect(k * 16, 0, 6, 16);
  const conveyorTex = new THREE.CanvasTexture(bc);
  conveyorTex.wrapS = THREE.RepeatWrapping;
  conveyorTex.repeat.set(cvLen * 1.2, 1);
  conveyorTex.colorSpace = THREE.SRGBColorSpace;
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(cvLen, 0.52), new THREE.MeshLambertMaterial({ map: conveyorTex }));
  belt.rotation.x = -Math.PI / 2;
  belt.position.set(cvX, 0.66, CONVEYOR.z);
  belt.receiveShadow = true;
  root.add(belt);

  // Loading dock pallet beside DELIVER (sold bales wait here for the truck)
  const dockPallet = mesh(merge([
    ...[-0.5, 0, 0.5].map((dz) => box(1.55, 0.05, 0.3, PALETTE.wood, { y: 0.1, z: dz * 1.05 })),
    ...[-0.5, 0, 0.5].map((dx) => box(0.16, 0.08, 1.4, PALETTE.woodDark, { x: dx * 1.4, y: 0.04 })),
  ]));
  dockPallet.position.set(DOCK.x, 0, DOCK.z);
  dockPallet.receiveShadow = true;
  root.add(dockPallet);

  // Depot pallets
  const palletGeo = merge([
    ...[-0.5, 0, 0.5].map((dz) => box(PALLET_SIZE, 0.05, 0.3, PALETTE.wood, { y: 0.14, z: dz * PALLET_SIZE * 0.84 })),
    ...[-0.5, 0, 0.5].map((dx) => box(0.16, 0.12, PALLET_SIZE, PALETTE.woodDark, { x: dx * PALLET_SIZE * 0.86, y: 0.06 })),
  ]);
  const pallets: THREE.Mesh[] = [];
  for (const p of PALLETS) {
    const m = mesh(palletGeo);
    m.position.set(p.x, 0, p.z);
    m.receiveShadow = true;
    root.add(m);
    pallets.push(m);
  }

  // Pads
  const pads = {
    harvest: buildPad(PADS.harvest, 'HARVEST', '', PALETTE.warm, 'harvest'),
    depot: buildPad(PADS.depot, 'BALES', 'pick up', PALETTE.cool, 'bale'),
    deliver: buildPad(PADS.deliver, 'DELIVER', '', PALETTE.warm, 'truck'),
    cash: buildPad(PADS.cash, 'COLLECT', 'cash', PALETTE.cashDark, 'coin'),
    upgrade: buildPad(PADS.upgrade, 'UPGRADE', '', PALETTE.cool, 'gear'),
    hauler: buildPad(PADS.hauler, 'HIRE', 'hauler', PALETTE.warm, 'worker'),
  };
  const hireGroup = new THREE.Group();
  for (const [k, p] of Object.entries(pads)) {
    if (k === 'hauler') {
      hireGroup.add(p.mesh, p.ring);
    } else {
      root.add(p.mesh, p.ring);
    }
  }
  // Hire signpost
  const hp = PADS.hauler;
  hireGroup.add(mesh(merge([box(0.1, 1.1, 0.1, PALETTE.woodDark, { x: hp.x + 1.05, y: 0.55, z: hp.z + 0.4 }), rbox(0.7, 0.4, 0.06, 0.04, PALETTE.warm, { x: hp.x + 1.05, y: 1.1, z: hp.z + 0.36 })])));
  root.add(hireGroup);

  return {
    root,
    pads,
    pallets,
    workshopLampMat,
    workshopGlow,
    workshopGlowMat,
    conveyorTex,
    hireGroup,
    cashAnchor: new THREE.Vector3(PADS.cash.x, 0.05, PADS.cash.z),
  };
}
