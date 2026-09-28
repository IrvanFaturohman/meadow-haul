// Small buyer truck (faces +X). Wheels spin while driving; the body sits on a
// suspension offset that dips as bales land in the bed.

import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { box, cyl, merge, mesh, rbox } from './geo';

export interface TruckRig {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Group[];
  /** Cargo is parented here (bed floor, local). */
  bed: THREE.Group;
  headlightMat: THREE.MeshBasicMaterial;
}

export const TRUCK_SLOTS: THREE.Vector3[] = (() => {
  const out: THREE.Vector3[] = [];
  for (let layer = 0; layer < 2; layer++)
    for (let ix = 0; ix < 2; ix++)
      for (let iz = 0; iz < 2; iz++) out.push(new THREE.Vector3(-0.42 + ix * 0.66, 0.2 + layer * 0.37, -0.26 + iz * 0.5));
  return out;
})();

export function buildTruck(): TruckRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const B = PALETTE.truckBody;
  const parts: THREE.BufferGeometry[] = [];
  // Chassis
  parts.push(rbox(3.7, 0.22, 1.35, 0.06, PALETTE.rubber, { x: 0.05, y: 0.55 }));
  // Cab
  parts.push(rbox(1.05, 1.0, 1.55, 0.16, B, { x: 1.05, y: 1.18 }));
  parts.push(rbox(1.12, 0.1, 1.6, 0.05, PALETTE.truckDark, { x: 1.05, y: 1.72 }));
  parts.push(box(0.03, 0.46, 1.25, PALETTE.glass, { x: 1.58, y: 1.33 }));
  for (const sz of [-0.785, 0.785]) parts.push(box(0.62, 0.42, 0.02, PALETTE.glass, { x: 1.02, y: 1.35, z: sz }));
  // Hood + grille + bumper
  parts.push(rbox(0.72, 0.62, 1.45, 0.14, B, { x: 1.88, y: 0.92 }));
  parts.push(box(0.04, 0.34, 0.9, PALETTE.rubber, { x: 2.25, y: 0.9 }));
  parts.push(rbox(0.16, 0.16, 1.55, 0.05, PALETTE.metalLight, { x: 2.28, y: 0.6 }));
  for (const sz of [-0.55, 0.55]) parts.push(cyl(0.1, 0.1, 0.05, PALETTE.metalLight, { x: 2.25, y: 1.02, z: sz, rz: Math.PI / 2 }, 12));
  // Bed
  parts.push(box(2.2, 0.12, 1.55, PALETTE.wood, { x: -0.62, y: 0.72 }));
  for (const sz of [-0.74, 0.74]) {
    parts.push(box(2.2, 0.26, 0.07, PALETTE.woodDark, { x: -0.62, y: 0.9, z: sz }));
    for (let k = 0; k < 4; k++) parts.push(box(0.07, 0.34, 0.08, PALETTE.truckDark, { x: -1.66 + k * 0.7, y: 0.92, z: sz }));
  }
  parts.push(box(0.07, 0.3, 1.55, PALETTE.woodDark, { x: -1.72, y: 0.92 }));
  parts.push(box(0.07, 0.44, 1.55, PALETTE.truckDark, { x: 0.47, y: 1.0 }));
  // Fenders
  for (const sz of [-0.72, 0.72]) {
    parts.push(rbox(0.8, 0.12, 0.26, 0.05, PALETTE.truckDark, { x: 1.62, y: 0.78, z: sz }));
    parts.push(rbox(0.8, 0.12, 0.26, 0.05, PALETTE.truckDark, { x: -1.0, y: 0.72, z: sz }));
  }
  // Tail lights
  for (const sz of [-0.6, 0.6]) parts.push(box(0.04, 0.1, 0.16, '#D9534F', { x: -1.76, y: 0.75, z: sz }));
  body.add(mesh(merge(parts)));

  const headlightMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  for (const sz of [-0.55, 0.55]) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.075, 12), headlightMat);
    l.rotation.y = Math.PI / 2;
    l.position.set(2.28, 1.02, sz);
    body.add(l);
  }

  const bed = new THREE.Group();
  bed.position.set(-0.62, 0.78, 0);
  body.add(bed);

  const wheels: THREE.Group[] = [];
  const wheelGeo = merge([
    cyl(0.36, 0.36, 0.26, PALETTE.rubber, { rx: Math.PI / 2 }, 18),
    cyl(0.2, 0.2, 0.28, PALETTE.metalLight, { rx: Math.PI / 2 }, 12),
    box(0.3, 0.06, 0.3, PALETTE.truckDark, {}),
  ]);
  for (const [x, z] of [
    [1.62, -0.72],
    [1.62, 0.72],
    [-1.0, -0.72],
    [-1.0, 0.72],
  ]) {
    const w = new THREE.Group();
    w.position.set(x, 0.36, z);
    w.add(mesh(wheelGeo));
    root.add(w);
    wheels.push(w);
  }

  // Blob shadow
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.9), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  root.add(shadow);

  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { root, body, wheels, bed, headlightMat };
}
