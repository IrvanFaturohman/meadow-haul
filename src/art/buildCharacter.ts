// Farmer / hauler characters built from primitives with a simple joint hierarchy for
// procedural walk, idle breathing and carry poses.

import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { box, capsule, cyl, merge, mesh, rbox, sphere, torus } from './geo';

export interface CharacterRig {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Stack is parented here (on the back rack). */
  stackAnchor: THREE.Group;
}

export interface CharacterStyle {
  shirt: string;
  pants: string;
  hat: 'straw' | 'cap';
  hatColor: string;
  hair: string;
}

export const FARMER_STYLE: CharacterStyle = { shirt: PALETTE.shirt, pants: PALETTE.overalls, hat: 'straw', hatColor: PALETTE.hat, hair: '#6B4A34' };
export const HAULER_STYLE: CharacterStyle = { shirt: PALETTE.workerShirt, pants: '#5B6B7A', hat: 'cap', hatColor: PALETTE.workerCap, hair: '#3B2A22' };

export function buildCharacter(style: CharacterStyle): CharacterRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const limb = (parts: THREE.BufferGeometry[]) => mesh(merge(parts));

  // Legs (pivot at hip)
  const mkLeg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.11, 0.5, 0);
    g.add(
      limb([
        capsule(0.085, 0.26, style.pants, { y: -0.2 }),
        rbox(0.15, 0.1, 0.24, 0.04, PALETTE.boot, { y: -0.45, z: 0.04 }),
      ]),
    );
    body.add(g);
    return g;
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  const torso = new THREE.Group();
  torso.position.y = 0.52;
  body.add(torso);
  torso.add(
    limb([
      rbox(0.4, 0.2, 0.26, 0.08, style.pants, { y: 0.06 }),
      rbox(0.42, 0.4, 0.27, 0.1, style.shirt, { y: 0.34 }),
      box(0.26, 0.2, 0.03, style.pants, { y: 0.28, z: 0.135 }),
      box(0.05, 0.22, 0.03, style.pants, { x: 0.1, y: 0.44, z: 0.13 }),
      box(0.05, 0.22, 0.03, style.pants, { x: -0.1, y: 0.44, z: 0.13 }),
      sphere(0.025, '#F4D06F', { x: 0.1, y: 0.37, z: 0.15 }, 6, 4),
      sphere(0.025, '#F4D06F', { x: -0.1, y: 0.37, z: 0.15 }, 6, 4),
      // Back rack for carrying bales
      box(0.36, 0.05, 0.2, PALETTE.woodDark, { y: 0.52, z: -0.2 }),
      box(0.05, 0.42, 0.05, PALETTE.woodDark, { x: 0.15, y: 0.34, z: -0.16 }),
      box(0.05, 0.42, 0.05, PALETTE.woodDark, { x: -0.15, y: 0.34, z: -0.16 }),
    ]),
  );

  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(side * 0.27, 0.5, 0);
    g.add(limb([capsule(0.068, 0.24, style.shirt, { y: -0.14 }), sphere(0.075, PALETTE.skin, { y: -0.34 }, 8, 6)]));
    torso.add(g);
    return g;
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);

  const head = new THREE.Group();
  head.position.y = 0.62;
  torso.add(head);
  const headParts: THREE.BufferGeometry[] = [
    sphere(0.2, PALETTE.skin, { y: 0.18 }, 14, 10),
    sphere(0.035, '#E3A77E', { y: 0.16, z: 0.2 }, 6, 4),
    sphere(0.026, '#263C33', { x: 0.075, y: 0.22, z: 0.175 }, 6, 4),
    sphere(0.026, '#263C33', { x: -0.075, y: 0.22, z: 0.175 }, 6, 4),
    sphere(0.045, '#F2A7A0', { x: 0.12, y: 0.13, z: 0.15, sy: 0.6 }, 6, 4),
    sphere(0.045, '#F2A7A0', { x: -0.12, y: 0.13, z: 0.15, sy: 0.6 }, 6, 4),
    sphere(0.19, style.hair, { y: 0.24, z: -0.04, sx: 1.04, sy: 0.8 }, 12, 8),
  ];
  if (style.hat === 'straw') {
    headParts.push(cyl(0.34, 0.36, 0.035, style.hatColor, { y: 0.33 }, 20));
    headParts.push(cyl(0.16, 0.19, 0.16, style.hatColor, { y: 0.42 }, 16));
    headParts.push(torus(0.18, 0.022, PALETTE.warm, { y: 0.37, rx: Math.PI / 2 }, 5, 18));
  } else {
    headParts.push(sphere(0.21, style.hatColor, { y: 0.28, sy: 0.7 }, 14, 8));
    headParts.push(box(0.26, 0.03, 0.18, style.hatColor, { y: 0.27, z: 0.2 }));
  }
  head.add(limb(headParts));

  const stackAnchor = new THREE.Group();
  stackAnchor.position.set(0, 0.56, -0.26);
  torso.add(stackAnchor);

  // Blob shadow
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { root, body, torso, head, armL, armR, legL, legR, stackAnchor };
}

/** Procedural walk / idle / carry animation. */
export class CharacterAnimator {
  private phase = 0;
  private time = 0;
  private walkBlend = 0;
  private lean = 0;
  private rig: CharacterRig;

  constructor(rig: CharacterRig) {
    this.rig = rig;
  }

  update(dt: number, speed: number, maxSpeed: number, carrying: number, motionScale: number): void {
    const r = this.rig;
    this.time += dt;
    const s = Math.min(1, speed / Math.max(0.01, maxSpeed));
    this.walkBlend += ((s > 0.05 ? 1 : 0) - this.walkBlend) * (1 - Math.exp(-dt / 0.08));
    const loaded = carrying > 0 ? 1 : 0;
    this.phase += dt * (6 + 5 * s) * (loaded ? 0.9 : 1);
    const w = this.walkBlend * s;
    const swing = Math.sin(this.phase) * 0.75 * w;
    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    // Carrying: arms reach up/back to steady the stack.
    const armCarry = loaded ? -2.3 : 0;
    r.armL.rotation.x = armCarry * 0.55 + (loaded ? swing * 0.15 : -swing * 0.8);
    r.armR.rotation.x = armCarry * 0.55 + (loaded ? -swing * 0.15 : swing * 0.8);
    r.armL.rotation.z = loaded ? 0.35 : 0.08;
    r.armR.rotation.z = loaded ? -0.35 : -0.08;
    const bob = Math.abs(Math.sin(this.phase)) * 0.06 * w * motionScale;
    const breathe = Math.sin(this.time * 2.2) * 0.008 * (1 - w) * motionScale;
    r.body.position.y = bob + breathe;
    this.lean += ((w * (loaded ? 0.16 : 0.1)) - this.lean) * (1 - Math.exp(-dt / 0.1));
    r.torso.rotation.x = this.lean;
    r.torso.scale.y = 1 + breathe * 1.5;
    r.head.rotation.x = -this.lean * 0.6;
  }
}
