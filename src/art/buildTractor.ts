// Stylized harvester machine parked at the base of the field. Faces +Z (toward the crop).

import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { box, cyl, merge, mesh, rbox, sphere, torus, cone } from './geo';

export interface TractorRig {
  root: THREE.Group;
  /** Vibrates subtly while the machine works. */
  body: THREE.Group;
  /** Hose reel drum (spins as hose pays out). */
  reel: THREE.Object3D;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshBasicMaterial;
  headlightMat: THREE.MeshBasicMaterial;
  /** Local-space exhaust tip for smoke puffs. */
  exhaustTip: THREE.Vector3;
  /** Local-space point where bales exit toward the conveyor. */
  chuteOut: THREE.Vector3;
}

export function buildTractor(): TractorRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const W = PALETTE.warm;
  const D = PALETTE.rubber;
  const M = PALETTE.metalLight;
  const C = PALETTE.cream;

  const parts: THREE.BufferGeometry[] = [];
  // Chassis
  parts.push(rbox(1.35, 0.3, 2.7, 0.08, D, { y: 0.52, z: 0.05 }));
  // Engine hood + grille
  parts.push(rbox(1.2, 0.72, 0.95, 0.14, W, { y: 0.98, z: 0.55 }));
  parts.push(rbox(1.24, 0.12, 0.99, 0.05, '#C9623F', { y: 0.66, z: 0.55 }));
  parts.push(box(0.84, 0.46, 0.06, D, { y: 0.95, z: 1.03 }));
  for (let i = 0; i < 4; i++) parts.push(box(0.72, 0.04, 0.03, M, { y: 0.8 + i * 0.1, z: 1.07 }));
  // Headlight housings
  for (const sx of [-0.44, 0.44]) parts.push(cyl(0.12, 0.12, 0.08, M, { x: sx, y: 1.18, z: 1.03, rx: Math.PI / 2 }, 14));
  // Cab
  parts.push(rbox(1.2, 0.92, 0.95, 0.1, C, { y: 1.62, z: -0.18 }));
  // Windows (inset dark glass on four sides)
  parts.push(box(0.9, 0.5, 0.02, PALETTE.glass, { y: 1.72, z: 0.3 }));
  parts.push(box(0.9, 0.5, 0.02, PALETTE.glass, { y: 1.72, z: -0.66 }));
  for (const sx of [-0.61, 0.61]) parts.push(box(0.02, 0.5, 0.66, PALETTE.glass, { x: sx, y: 1.72, z: -0.18 }));
  // Roof
  parts.push(rbox(1.38, 0.13, 1.14, 0.06, W, { y: 2.13, z: -0.18 }));
  // Hopper tank behind the cab
  parts.push(cyl(0.52, 0.56, 0.95, C, { y: 1.3, z: -1.02 }, 18));
  parts.push(cyl(0.575, 0.575, 0.14, W, { y: 1.35, z: -1.02 }, 18));
  parts.push(sphere(0.52, C, { y: 1.78, z: -1.02, sy: 0.45 }, 16, 8));
  parts.push(cyl(0.12, 0.12, 0.12, D, { y: 2.0, z: -1.02 }, 10));
  // Intake pipe from front reel over the hood into the tank
  parts.push(cyl(0.09, 0.09, 1.4, PALETTE.cool, { x: 0.52, y: 1.42, z: 0.18, rx: Math.PI / 2 - 0.35 }, 10));
  // Side chute toward the conveyor (−X side)
  parts.push(rbox(0.5, 0.26, 0.42, 0.06, W, { x: -0.72, y: 0.98, z: -0.45 }));
  parts.push(box(0.36, 0.08, 0.36, D, { x: -0.98, y: 0.86, z: -0.45 }));
  // Exhaust
  parts.push(cyl(0.06, 0.07, 0.75, D, { x: 0.42, y: 1.62, z: 0.78 }, 10));
  parts.push(cyl(0.085, 0.07, 0.08, M, { x: 0.42, y: 2.0, z: 0.78 }, 10));
  // Steps + fenders
  for (const sx of [-0.7, 0.7]) {
    parts.push(rbox(0.3, 0.1, 0.9, 0.04, W, { x: sx * 1.18, y: 1.12, z: -0.62 }));
    parts.push(rbox(0.26, 0.08, 0.6, 0.03, W, { x: sx * 1.08, y: 0.88, z: 0.82 }));
  }
  // Reel frame (front)
  for (const sx of [-0.5, 0.5]) {
    parts.push(rbox(0.08, 0.5, 0.14, 0.03, D, { x: sx, y: 0.62, z: 1.22 }));
    parts.push(cyl(0.38, 0.38, 0.05, W, { x: sx, y: 0.74, z: 1.36, rz: Math.PI / 2 }, 20));
  }
  const bodyMesh = mesh(merge(parts));
  body.add(bodyMesh);

  // Wheels
  const wheelParts: THREE.BufferGeometry[] = [];
  const wheel = (x: number, y: number, z: number, r: number, w: number) => {
    wheelParts.push(cyl(r, r, w, D, { x, y, z, rz: Math.PI / 2 }, 20));
    wheelParts.push(cyl(r * 0.55, r * 0.55, w + 0.02, M, { x, y, z, rz: Math.PI / 2 }, 14));
    wheelParts.push(cyl(r * 0.22, r * 0.22, w + 0.05, W, { x, y, z, rz: Math.PI / 2 }, 10));
    // Tread lugs
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      wheelParts.push(box(w * 0.9, 0.06, 0.1, '#2A3C38', { x, y: y + Math.sin(a) * r, z: z + Math.cos(a) * r, rx: -a }));
    }
  };
  wheel(-0.82, 0.58, -0.72, 0.58, 0.38);
  wheel(0.82, 0.58, -0.72, 0.58, 0.38);
  wheel(-0.72, 0.4, 0.78, 0.4, 0.28);
  wheel(0.72, 0.4, 0.78, 0.4, 0.28);
  root.add(mesh(merge(wheelParts)));

  // Reel drum with coiled hose
  const reel = new THREE.Group();
  reel.position.set(0, 0.74, 1.36);
  const reelParts: THREE.BufferGeometry[] = [];
  reelParts.push(cyl(0.3, 0.3, 0.9, PALETTE.hose, { rz: Math.PI / 2 }, 16));
  for (let k = 0; k < 6; k++) reelParts.push(torus(0.3, 0.035, PALETTE.hoseDark, { x: -0.38 + k * 0.152, ry: Math.PI / 2 }, 6, 16));
  reelParts.push(box(0.92, 0.05, 0.05, M, { y: 0.3 }));
  reel.add(mesh(merge(reelParts)));
  body.add(reel);

  // Headlights (glow when working) and roof beacon
  const headlightMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  for (const sx of [-0.44, 0.44]) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14), headlightMat);
    l.position.set(sx, 1.18, 1.075);
    body.add(l);
  }
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#FFB347' });
  const beacon = new THREE.Mesh(cone(0.11, 0.18, '#ffffff', { y: 0 }, 10), beaconMat);
  beacon.position.set(0.35, 2.28, -0.3);
  body.add(beacon);
  body.add(mesh(cyl(0.12, 0.12, 0.05, D, { x: 0.35, y: 2.2, z: -0.3 }, 10)));

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return {
    root,
    body,
    reel,
    beacon,
    beaconMat,
    headlightMat,
    exhaustTip: new THREE.Vector3(0.42, 2.08, 0.78),
    chuteOut: new THREE.Vector3(-1.1, 0.95, -0.45),
  };
}
