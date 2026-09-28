// Renders the crop field from FieldState: instanced clumps per chunk×tier, a soil-reveal
// mask on the ground, and instanced loose-cutting piles. Only changed cells are rewritten.

import * as THREE from 'three';
import { TIERS, type TierId } from '../config/balance';
import { PALETTE, TIER_COLORS } from '../config/palette';
import { FIELD } from '../config/worldLayout';
import { hash01, valueNoise } from '../art/geo';
import { buildClippingsGeometry, buildClumpGeometry, createGrassMaterial, createLooseMaterial, createGrassUniforms, type GrassDetail, type GrassUniforms } from '../art/grassMaterial';
import { CELL, cellCenterX, cellCenterZ, cellCol, cellRow, forEachCellInRadius, type FieldState } from './FieldModel';

const STUBBLE_H = Math.fround(0.075);

interface ChunkMesh {
  mesh: THREE.InstancedMesh;
  info: THREE.InstancedBufferAttribute;
  dirty: boolean;
}

interface LooseChunk {
  mesh: THREE.InstancedMesh;
  dirty: boolean;
}

export class FieldRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: GrassUniforms;
  private material: THREE.MeshLambertMaterial;
  private clumpGeos: THREE.BufferGeometry[] = [];
  private chunks: ChunkMesh[] = [];
  private looseChunks: LooseChunk[] = [];
  private looseGeo: THREE.BufferGeometry;
  private looseMat: THREE.MeshLambertMaterial;
  /** Per cell: chunk mesh index and first instance index. */
  private cellChunk: Int32Array;
  private cellInst: Int32Array;
  private cellLooseChunk: Int32Array;
  private cellLooseInst: Int32Array;
  private clumps = 2;
  /** Visual height per cell currently targeted (to animate from). */
  private visH: Float32Array;
  private visDmg: Float32Array;
  private maskData: Uint8Array;
  private maskTex: THREE.DataTexture;
  private ground: THREE.Mesh;
  private field: FieldState;
  private time = 0;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(field: FieldState, detail: GrassDetail) {
    this.field = field;
    const n = FIELD.cols * FIELD.rows;
    this.cellChunk = new Int32Array(n).fill(-1);
    this.cellInst = new Int32Array(n).fill(-1);
    this.cellLooseChunk = new Int32Array(n).fill(-1);
    this.cellLooseInst = new Int32Array(n).fill(-1);
    this.visH = new Float32Array(n);
    this.visDmg = new Float32Array(n);
    this.uniforms = createGrassUniforms();
    this.material = createGrassMaterial(this.uniforms);
    this.looseGeo = buildClippingsGeometry();
    this.looseMat = createLooseMaterial(this.uniforms);

    // Soil mask: R = soil exposed, G = cuttings lying there.
    this.maskData = new Uint8Array(n * 4);
    this.maskTex = new THREE.DataTexture(this.maskData, FIELD.cols, FIELD.rows, THREE.RGBAFormat);
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;
    this.ground = this.buildGround();
    this.group.add(this.ground);

    this.build(detail);
  }

  private buildGround(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(FIELD.width, FIELD.length, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(FIELD.x0 + FIELD.width / 2, 0.005, FIELD.z0 + FIELD.length / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const uniforms = {
      uMask: { value: this.maskTex },
      uGrassA: { value: new THREE.Color(PALETTE.grassShadow) },
      uGrassB: { value: new THREE.Color('#149E3B') },
      uSoil: { value: new THREE.Color(PALETTE.soil) },
      uSoilDark: { value: new THREE.Color(PALETTE.soilDark) },
      uGoldGround: { value: new THREE.Color('#D9A52E') },
      uOrigin: { value: new THREE.Vector2(FIELD.x0, FIELD.z0) },
      uSize: { value: new THREE.Vector2(FIELD.width, FIELD.length) },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFieldUv;\nvarying vec2 vWorldXZ;\nuniform vec2 uOrigin;\nuniform vec2 uSize;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;\nvFieldUv = (vWorldXZ - uOrigin) / uSize;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vFieldUv;
          varying vec2 vWorldXZ;
          uniform sampler2D uMask;
          uniform vec3 uGrassA; uniform vec3 uGrassB; uniform vec3 uSoil; uniform vec3 uSoilDark; uniform vec3 uGoldGround;
          float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
          float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec4 m = texture2D(uMask, vFieldUv);
          float n1 = vn(vWorldXZ * 3.1);
          float n2 = vn(vWorldXZ * 9.0);
          float soilT = smoothstep(0.38, 0.62, m.r + (n1 - 0.5) * 0.35);
          vec3 grass = mix(uGrassB, uGrassA, 0.55 + n2 * 0.45);
          grass = mix(grass, uGoldGround, smoothstep(0.66, 0.70, vFieldUv.y) * 0.45);
          vec3 soil = mix(uSoilDark, uSoil, 0.45 + n1 * 0.35 + n2 * 0.25);
          // Furrow stripes along the field make harvested ground read as tilled soil.
          soil *= 0.94 + 0.06 * sin(vWorldXZ.x * 7.0 + sin(vWorldXZ.y * 0.9) * 1.6 + n1 * 2.0);
          soil = mix(soil, soil * vec3(0.92, 0.95, 0.8), m.g * 0.6);
          diffuseColor.rgb = mix(grass, soil, soilT);`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private build(detail: GrassDetail): void {
    for (const c of this.chunks) this.group.remove(c.mesh);
    for (const c of this.looseChunks) this.group.remove(c.mesh);
    for (const c of this.chunks) c.mesh.geometry.dispose();
    for (const c of this.looseChunks) c.mesh.geometry.dispose();
    for (const g of this.clumpGeos) g.dispose();
    this.chunks = [];
    this.looseChunks = [];
    this.clumps = detail === 'low' ? 1 : 2;
    this.clumpGeos = [0, 1, 2].map((t) => buildClumpGeometry(t as TierId, detail));

    const cc = Math.ceil(FIELD.cols / FIELD.chunkCols);
    const cr = Math.ceil(FIELD.rows / FIELD.chunkRows);
    for (let crow = 0; crow < cr; crow++) {
      for (let ccol = 0; ccol < cc; ccol++) {
        const cells: number[][] = [[], [], []];
        const looseCells: number[] = [];
        for (let row = crow * FIELD.chunkRows; row < Math.min(FIELD.rows, (crow + 1) * FIELD.chunkRows); row++) {
          for (let col = ccol * FIELD.chunkCols; col < Math.min(FIELD.cols, (ccol + 1) * FIELD.chunkCols); col++) {
            const i = row * FIELD.cols + col;
            const tier = this.field.tier[i];
            if (tier < 0) continue;
            cells[tier].push(i);
            looseCells.push(i);
          }
        }
        for (let t = 0; t < 3; t++) {
          if (cells[t].length === 0) continue;
          this.buildChunk(t as TierId, cells[t]);
        }
        if (looseCells.length > 0) this.buildLooseChunk(looseCells);
      }
    }
    this.refreshAll(true);
  }

  private buildChunk(tier: TierId, cells: number[]): void {
    const base = this.clumpGeos[tier];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    geo.setAttribute('color', base.attributes.color);
    geo.setAttribute('aKind', base.attributes.aKind);
    const count = cells.length * this.clumps;
    const info = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', info);
    const mesh = new THREE.InstancedMesh(geo, this.material, count);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const idx = this.chunks.length;
    const tc = TIER_COLORS[tier];
    const tint = this.tmpC;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      this.cellChunk[i] = idx;
      this.cellInst[i] = k * this.clumps;
      const cx = cellCenterX(i);
      const cz = cellCenterZ(i);
      for (let c = 0; c < this.clumps; c++) {
        const h1 = hash01(i * 7 + c * 131 + 1);
        const h2 = hash01(i * 13 + c * 71 + 2);
        const h3 = hash01(i * 17 + c * 37 + 3);
        const h4 = hash01(i * 23 + c * 53 + 4);
        const off = this.clumps === 1 ? 0 : c === 0 ? -1 : 1;
        const jx = (h1 - 0.5) * FIELD.cell * 0.55 + off * FIELD.cell * 0.2;
        const jz = (h2 - 0.5) * FIELD.cell * 0.55 - off * FIELD.cell * 0.12;
        this.tmpP.set(cx + jx, 0, cz + jz);
        this.tmpQ.setFromAxisAngle(this.up, h3 * Math.PI * 2);
        const nH = valueNoise(cx * 0.45, cz * 0.45, 3 + tier);
        let sy: number;
        let sxz: number;
        if (tier === 0) {
          sy = 0.65 + (nH * 0.6 + h4 * 0.4) * 0.5;
          sxz = 1.05 + h4 * 0.35;
        } else if (tier === 1) {
          sy = 0.85 + (nH * 0.5 + h4 * 0.5) * 0.3;
          sxz = 1.2 + h4 * 0.35;
        } else {
          sy = 0.9 + (nH * 0.6 + h4 * 0.4) * 0.28;
          sxz = 1.0 + h4 * 0.3;
        }
        this.tmpS.set(sxz, sy, sxz);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        const ii = k * this.clumps + c;
        mesh.setMatrixAt(ii, this.tmpM);
        const cn = valueNoise(cx * 0.3 + 11, cz * 0.3, 9 + tier);
        const v = 0.88 + cn * 0.2 + (h1 - 0.5) * 0.08;
        tint.setRGB(v, v * (0.98 + cn * 0.04), v * (0.95 + (1 - cn) * 0.06));
        if (tier === 0) tint.lerp(this.tmpColorB.set(tc.tip), 0.08 * cn);
        mesh.setColorAt(ii, tint);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    // Grass sways/bends a little outside its instance bounds.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.8;
    this.group.add(mesh);
    this.chunks.push({ mesh, info, dirty: true });
  }

  private tmpColorB = new THREE.Color();

  private buildLooseChunk(cells: number[]): void {
    const mesh = new THREE.InstancedMesh(this.looseGeo, this.looseMat, cells.length);
    mesh.castShadow = false;
    const idx = this.looseChunks.length;
    for (let k = 0; k < cells.length; k++) {
      this.cellLooseChunk[cells[k]] = idx;
      this.cellLooseInst[cells[k]] = k;
      // Fresh-cut colour with a little per-pile variation between the tier's tip and mid tones.
      const tc = TIER_COLORS[this.field.tier[cells[k]] as TierId];
      mesh.setColorAt(k, this.tmpC.set(tc.tip).lerp(this.tmpColorB.set(tc.mid), hash01(cells[k] * 5 + 3) * 0.45).multiplyScalar(1.05));
    }
    // Fixed bounds from the chunk's cells (hidden instances would otherwise shrink them).
    const box = new THREE.Box3();
    for (const i of cells) box.expandByPoint(this.tmpP.set(cellCenterX(i), 0, cellCenterZ(i)));
    box.expandByScalar(0.4);
    mesh.boundingBox = box;
    mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    this.group.add(mesh);
    this.looseChunks.push({ mesh, dirty: true });
  }

  setDetail(detail: GrassDetail): void {
    this.build(detail);
  }

  setField(field: FieldState): void {
    this.field = field;
    this.refreshAll(true);
  }

  /** Rewrites every cell from state (load / rebuild). */
  refreshAll(instant: boolean): void {
    for (let i = 0; i < this.field.state.length; i++) {
      if (this.field.tier[i] < 0) {
        this.setMask(i, 255, 0);
        continue;
      }
      this.updateCell(i, instant ? -10 : this.time, 0);
    }
    this.maskTex.needsUpdate = true;
  }

  private setMask(i: number, soil: number, loose: number): void {
    const col = cellCol(i);
    const row = cellRow(i);
    const o = (row * FIELD.cols + col) * 4;
    this.maskData[o] = soil;
    this.maskData[o + 1] = loose;
    this.maskData[o + 2] = 0;
    this.maskData[o + 3] = 255;
  }

  /** Syncs the visuals of one cell with its logical state. `delay` staggers grow waves. */
  updateCell(i: number, now = this.time, delay = 0): void {
    const f = this.field;
    const tier = f.tier[i];
    if (tier < 0) return;
    const state = f.state[i];
    const standing = state === CELL.GROWING;
    const target = standing ? 1 : STUBBLE_H;
    const dmg = standing ? 1 - f.hp[i] / TIERS[tier as TierId].hp : 0;
    const chunkIdx = this.cellChunk[i];
    if (chunkIdx >= 0) {
      const ch = this.chunks[chunkIdx];
      const arr = ch.info.array as Float32Array;
      const base = this.cellInst[i];
      for (let c = 0; c < this.clumps; c++) {
        const o = (base + c) * 4;
        if (arr[o] !== target) {
          // Current displayed height becomes the transition start.
          const prevTarget = arr[o];
          const prev = now < -1 ? target : prevTarget === 0 ? target : prevTarget;
          arr[o] = target;
          arr[o + 1] = now + delay + (target > prev ? c * 0.04 : 0);
          arr[o + 2] = prev;
        }
        arr[o + 3] = Math.max(0, Math.min(1, dmg));
      }
      ch.dirty = true;
    }
    this.visH[i] = target;
    this.visDmg[i] = dmg;
    this.setMask(i, standing ? 0 : 255, f.loose[i] > 0 ? 255 : 0);
    this.maskTex.needsUpdate = true;

    const lc = this.cellLooseChunk[i];
    if (lc >= 0) {
      const lch = this.looseChunks[lc];
      const k = this.cellLooseInst[i];
      if (f.loose[i] > 0) {
        const h = hash01(i * 29 + 5);
        this.tmpP.set(cellCenterX(i) + (h - 0.5) * 0.08, 0.005, cellCenterZ(i) + (hash01(i * 31) - 0.5) * 0.08);
        this.tmpQ.setFromAxisAngle(this.up, h * Math.PI * 2);
        // Oversized mounds overlap their neighbours into a continuous carpet of cuttings.
        const s = 1.3 + hash01(i * 3 + 9) * 0.35;
        this.tmpS.set(s, 0.9 + hash01(i * 7 + 1) * 0.4, s);
      } else {
        this.tmpP.set(0, -5, 0);
        this.tmpQ.identity();
        this.tmpS.set(0.0001, 0.0001, 0.0001);
      }
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      lch.mesh.setMatrixAt(k, this.tmpM);
      lch.dirty = true;
    }
  }

  /** Updates partial-damage lean for standing cells near the tool. */
  refreshDamageNear(x: number, z: number, r: number): void {
    const f = this.field;
    forEachCellInRadius(x, z, r, (i) => {
      if (f.state[i] !== CELL.GROWING) return;
      const dmg = 1 - f.hp[i] / TIERS[f.tier[i] as TierId].hp;
      if (Math.abs(dmg - this.visDmg[i]) > 0.02) this.updateCell(i);
    });
  }

  /** Grow wave from the base of the field toward the far end, ~1 s total. */
  replantWave(cells: number[]): void {
    let minRow = FIELD.rows;
    let maxRow = 0;
    for (const i of cells) {
      const r = cellRow(i);
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
    }
    const span = Math.max(1, maxRow - minRow);
    for (const i of cells) {
      const d = ((cellRow(i) - minRow) / span) * 0.55 + hash01(i) * 0.05;
      this.updateCell(i, this.time, d);
    }
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.uniforms.uTime.value = time;
    void dt;
    for (const c of this.chunks) {
      if (c.dirty) {
        c.info.needsUpdate = true;
        c.dirty = false;
      }
    }
    for (const c of this.looseChunks) {
      if (c.dirty) {
        c.mesh.instanceMatrix.needsUpdate = true;
        c.dirty = false;
      }
    }
  }

  get now(): number {
    return this.time;
  }

  stats(): { chunks: number; instances: number } {
    let inst = 0;
    for (const c of this.chunks) inst += c.mesh.count;
    return { chunks: this.chunks.length + this.looseChunks.length, instances: inst };
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh.geometry.dispose();
    for (const g of this.clumpGeos) g.dispose();
    this.looseGeo.dispose();
    this.material.dispose();
    this.looseMat.dispose();
    this.maskTex.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
  }
}
