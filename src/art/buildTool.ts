// Tool head at the end of the hose: a shared hub plus two swappable attachments —
// a spinning cutter disc (BLADE) and a flared suction nozzle (VACUUM).

import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { box, cone, cyl, merge, mesh, rbox, ring, sphere, torus } from './geo';

export interface ToolRig {
  root: THREE.Group;
  /** Yaw/tilt pivot. */
  pivot: THREE.Group;
  hub: THREE.Group;
  blade: THREE.Group;
  bladeDisc: THREE.Group;
  bladeBlur: THREE.Mesh;
  vacuum: THREE.Group;
  swirl: THREE.Mesh;
  /** Local point on the hub where the hose attaches (rear). */
  hoseMount: THREE.Vector3;
  /** Ground ring showing tool radius. */
  radiusRing: THREE.Mesh;
  radiusRingMat: THREE.MeshBasicMaterial;
}

export function buildTool(): ToolRig {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);

  // Hub: motor housing on a short mast so it reads above tall crops; hose collar at the back (−Z).
  const hub = new THREE.Group();
  const hubParts: THREE.BufferGeometry[] = [];
  hubParts.push(cyl(0.075, 0.09, 1.0, PALETTE.rubber, { y: 0.72 }, 10));
  hubParts.push(rbox(0.62, 0.34, 0.66, 0.12, PALETTE.warm, { y: 1.28 }));
  hubParts.push(rbox(0.5, 0.1, 0.52, 0.05, '#C9623F', { y: 1.48 }));
  hubParts.push(rbox(0.66, 0.08, 0.7, 0.04, PALETTE.rubber, { y: 1.12 }));
  hubParts.push(cyl(0.15, 0.17, 0.24, PALETTE.cool, { y: 1.24, z: -0.4, rx: Math.PI / 2 }, 12));
  hubParts.push(torus(0.16, 0.035, PALETTE.rubber, { y: 1.24, z: -0.48 }, 6, 14));
  hubParts.push(box(0.16, 0.08, 0.1, PALETTE.lamp, { y: 1.34, z: 0.34 }));
  hubParts.push(cyl(0.035, 0.035, 0.34, PALETTE.rubber, { x: 0.18, y: 1.62, z: -0.1 }, 6));
  hubParts.push(sphere(0.06, PALETTE.cream, { x: 0.18, y: 1.8, z: -0.1 }, 8, 6));
  hub.add(mesh(merge(hubParts)));
  pivot.add(hub);

  // Blade attachment
  const blade = new THREE.Group();
  const bladeFrame: THREE.BufferGeometry[] = [];
  bladeFrame.push(cyl(0.2, 0.22, 0.12, PALETTE.metalLight, { y: 0.22 }, 14));
  bladeFrame.push(cyl(0.12, 0.2, 0.08, PALETTE.warm, { y: 0.31 }, 14));
  blade.add(mesh(merge(bladeFrame)));
  const bladeDisc = new THREE.Group();
  bladeDisc.position.y = 0.13;
  const discParts: THREE.BufferGeometry[] = [];
  discParts.push(cyl(1, 1, 0.035, '#B7C4BC', {}, 28));
  discParts.push(cyl(0.72, 0.72, 0.045, PALETTE.metalLight, {}, 28));
  discParts.push(cyl(0.2, 0.2, 0.07, PALETTE.warm, {}, 14));
  // Teeth and cutting arms
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    discParts.push(cone(0.09, 0.16, '#EEF3EE', { x: Math.cos(a) * 1.02, z: Math.sin(a) * 1.02, rz: -Math.PI / 2, ry: -a }, 4));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    discParts.push(box(0.9, 0.05, 0.14, PALETTE.rubber, { x: Math.cos(a) * 0.45, y: 0.03, z: Math.sin(a) * 0.45, ry: -a }));
  }
  bladeDisc.add(mesh(merge(discParts)));
  blade.add(bladeDisc);
  // Motion blur disc (visible when spinning fast)
  const blurMat = new THREE.MeshBasicMaterial({ color: '#F4F8F2', transparent: true, opacity: 0.28, depthWrite: false });
  const bladeBlur = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.08, 40), blurMat);
  bladeBlur.rotation.x = -Math.PI / 2;
  bladeBlur.position.y = 0.16;
  blade.add(bladeBlur);
  pivot.add(blade);

  // Vacuum nozzle
  const vacuum = new THREE.Group();
  const vacParts: THREE.BufferGeometry[] = [];
  vacParts.push(cyl(0.17, 0.52, 0.8, PALETTE.cream, { y: 0.48 }, 22, false));
  vacParts.push(torus(0.52, 0.055, PALETTE.cool, { y: 0.08, rx: Math.PI / 2 }, 6, 24));
  vacParts.push(torus(0.33, 0.04, PALETTE.warm, { y: 0.52, rx: Math.PI / 2 }, 6, 18));
  vacParts.push(torus(0.22, 0.035, PALETTE.cool, { y: 0.78, rx: Math.PI / 2 }, 6, 16));
  vacParts.push(cyl(0.14, 0.16, 0.26, PALETTE.cool, { y: 0.98 }, 12));
  // Skirt bristles
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    vacParts.push(box(0.05, 0.07, 0.05, PALETTE.rubber, { x: Math.cos(a) * 0.5, y: 0.03, z: Math.sin(a) * 0.5 }));
  }
  vacuum.add(mesh(merge(vacParts)));
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.42, 22), new THREE.MeshBasicMaterial({ color: '#1E2D2A' }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.09;
  vacuum.add(inner);
  // Swirl: translucent spiral arms spinning under the nozzle
  const swirlGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  for (let arm = 0; arm < 3; arm++) {
    for (let k = 0; k < 16; k++) {
      const t0 = k / 16;
      const t1 = (k + 1) / 16;
      const a0 = arm * ((Math.PI * 2) / 3) + t0 * 3.2;
      const a1 = arm * ((Math.PI * 2) / 3) + t1 * 3.2;
      const r0 = 1.0 - t0 * 0.8;
      const r1 = 1.0 - t1 * 0.8;
      const w0 = 0.07 * (1 - t0 * 0.6);
      const w1 = 0.07 * (1 - t1 * 0.6);
      const p = (a: number, r: number): [number, number, number] => [Math.cos(a) * r, 0, Math.sin(a) * r];
      const a = p(a0, r0 - w0);
      const b = p(a0, r0 + w0);
      const c = p(a1, r1 + w1);
      const d = p(a1, r1 - w1);
      sp.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  swirlGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const swirl = new THREE.Mesh(swirlGeo, new THREE.MeshBasicMaterial({ color: '#E8F5EE', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  swirl.position.y = 0.06;
  vacuum.add(swirl);
  pivot.add(vacuum);

  // Ground radius ring (not part of pivot, stays flat)
  // Drawn over the crop (no depth test) so the working radius stays readable in tall grass.
  const radiusRingMat = new THREE.MeshBasicMaterial({ color: '#FFF6DA', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false });
  const radiusRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.0, 48), radiusRingMat);
  radiusRing.rotation.x = -Math.PI / 2;
  radiusRing.position.y = 0.03;
  radiusRing.renderOrder = 5;
  root.add(radiusRing);

  // Blob shadow under the head
  const shadow = mesh(ring(0, 0.55, '#000000'), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.18, depthWrite: false }), false);
  shadow.position.y = 0.012;
  root.add(shadow);
  // Tiny sphere to hide hose/hub seam
  hub.add(mesh(sphere(0.1, PALETTE.cool, { y: 1.24, z: -0.5 }, 8, 6)));

  pivot.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== bladeBlur && o !== swirl && o !== inner) (o as THREE.Mesh).castShadow = true;
  });

  return { root, pivot, hub, blade, bladeDisc, bladeBlur, vacuum, swirl, hoseMount: new THREE.Vector3(0, 1.24, -0.52), radiusRing, radiusRingMat };
}
