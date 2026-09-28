// Visual world: scene graph, lights and every rig. Reads committed state each frame and
// turns simulation events into feedback (debris, pops, flights, pulses). Never mutates state.

import * as THREE from 'three';
import { BLADE, CARRY, JUICE, REACH, VACUUM, type TierId } from '../config/balance';
import { PALETTE, TIER_COLORS } from '../config/palette';
import { CONVEYOR, HOSE_ANCHOR, MACHINE, PADS, TOOL_HEIGHT, TRUCK_LAYOUT } from '../config/worldLayout';
import type { GameState } from '../core/GameState';
import type { GameEvent } from '../core/Events';
import type { SimRuntime } from '../core/Simulation';
import { buildEnvironment, type EnvironmentRig } from '../art/buildEnvironment';
import { buildTractor, type TractorRig } from '../art/buildTractor';
import { buildTool, type ToolRig } from '../art/buildTool';
import { buildCharacter, CharacterAnimator, FARMER_STYLE, HAULER_STYLE, type CharacterRig } from '../art/buildCharacter';
import { buildTruck, type TruckRig } from '../art/buildTruck';
import type { GrassDetail } from '../art/grassMaterial';
import { FieldRenderer } from './FieldRenderer';
import { BaleRenderer, type StackView } from './BaleRenderer';
import { ParticleSystem } from '../effects/ParticlePool';
import { Hose } from '../gameplay/Hose';
import { Spring, clamp01, damp, ease, popScale } from '../effects/Tweens';
import { cellCenterX, cellCenterZ } from './FieldModel';
import { reachDistance } from '../gameplay/Reach';
import { haulerStats } from '../gameplay/Economy';
import type { TutorialTarget } from '../gameplay/Tutorial';

export type ViewMode = 'FARM' | 'HARVEST' | 'TRANSITION';

export interface QualityProfile {
  grass: GrassDetail;
  shadows: boolean;
  shadowSize: number;
  debris: number;
  pixelRatio: number;
}

interface CarrierVisual {
  rig: CharacterRig;
  anim: CharacterAnimator;
  view: StackView;
  swayX: Spring;
  swayZ: Spring;
  bounce: Spring;
  lastVx: number;
  lastVz: number;
  prevX: number;
  prevZ: number;
}

const tierColor = [0, 1, 2].map((t) => new THREE.Color(TIER_COLORS[t].tip));
const tierMid = [0, 1, 2].map((t) => new THREE.Color(TIER_COLORS[t].mid));
const soilColor = new THREE.Color(PALETTE.soil).lerp(new THREE.Color('#ffffff'), 0.25);

export class FarmWorld {
  readonly scene = new THREE.Scene();
  readonly env: EnvironmentRig;
  readonly field: FieldRenderer;
  readonly tractor: TractorRig;
  readonly tool: ToolRig;
  readonly hose: Hose;
  readonly truck: TruckRig;
  readonly bales: BaleRenderer;
  readonly particles: ParticleSystem;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private player: CarrierVisual;
  private hauler: CarrierVisual;
  private state: GameState;
  private time = 0;
  motionScale = 1;
  private toolYaw = 0;
  private toolTilt = new THREE.Vector2();
  private toolRecoil = 0;
  private bladeSpin = 0;
  private bladeSpeed = 0;
  private swapT = 1;
  private swapFrom: 'BLADE' | 'VACUUM' = 'BLADE';
  private swapTo: 'BLADE' | 'VACUUM' = 'BLADE';
  private reachSweepT = -1;
  private reachSweepFrom = 0;
  private reachSweepTo = 0;
  /** Replay the "new rows" glow the next time the harvest view opens. */
  private reachGlowPending = false;
  private lastView: ViewMode = 'FARM';
  private toolLean = new THREE.Group();
  private leanAmt = 0;
  private anchorV = new THREE.Vector3(HOSE_ANCHOR.x, HOSE_ANCHOR.y, HOSE_ANCHOR.z);
  private toolWorld = new THREE.Vector3();
  private mountWorld = new THREE.Vector3();
  private nozzleWorld = new THREE.Vector3();
  private truckSquash = new Spring(160, 12);
  private truckWheelAngle = 0;
  private lastTruckX = 0;
  private cashStack: THREE.InstancedMesh;
  private cashShown = 0;
  private cashPop = -1;
  private arrow: THREE.Group;
  private arrowTarget: THREE.Vector3 | null = null;
  private padPulse: Record<string, number> = {};
  private workshopLight = 0;
  private workshopLightTarget = 0;
  private exhaustT = 0;
  private machineWork = 0;
  private reelAngle = 0;
  private lastRest = 0;
  private toolPos = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private smokeColor = new THREE.Color('#E6E2D6');
  private lampOff = new THREE.Color('#6D5C43');
  private lampOn = new THREE.Color('#FFE7A6');
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private conveyorItems: { t: number; tier: TierId }[] = [];
  private conveyorMesh: THREE.InstancedMesh;
  private haulerRoot: THREE.Group;
  private toolScaleBlade = 1;
  private toolScaleVac = 1;
  private vacGulp = new Spring(260, 14);
  private vacPull = 0;
  private moteT = 0;
  private lastPulse = -1;
  private pulseAcc = 0;
  private moteColor = new THREE.Color('#F4FBE8');

  constructor(state: GameState, quality: QualityProfile) {
    this.state = state;
    this.scene.background = new THREE.Color(PALETTE.farmGrass);

    // Bright, soft "toy" lighting: up-facing surfaces land on the palette (no tone mapping),
    // a warm sand-coloured bounce keeps sides from going muddy, and shadows stay light.
    this.hemi = new THREE.HemisphereLight('#FFFFFF', '#F4DEB0', 1.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#FFF8EC', 1.65);
    this.sun.position.set(-8, 16, -6);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.intensity = 0.45;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.env = buildEnvironment();
    this.scene.add(this.env.root);

    this.field = new FieldRenderer(state.field, quality.grass);
    this.scene.add(this.field.group);

    this.tractor = buildTractor();
    this.tractor.root.position.set(MACHINE.x, 0, MACHINE.z);
    this.scene.add(this.tractor.root);

    this.tool = buildTool();
    this.tool.pivot.scale.setScalar(1.12);
    // Lean group between root and pivot: the head tips back toward the machine when the hose pulls.
    this.tool.root.remove(this.tool.pivot);
    this.toolLean.add(this.tool.pivot);
    this.tool.root.add(this.toolLean);
    this.scene.add(this.tool.root);
    this.hose = new Hose();
    this.scene.add(this.hose.mesh);

    this.truck = buildTruck();
    this.truck.root.position.set(state.truck.x, 0, TRUCK_LAYOUT.z);
    this.scene.add(this.truck.root);

    this.bales = new BaleRenderer();
    this.scene.add(this.bales.group);

    this.particles = new ParticleSystem();
    this.particles.setBudget(quality.debris);
    this.scene.add(this.particles.group);

    this.player = this.makeCarrier(buildCharacter(FARMER_STYLE), state.player.carry);
    this.player.rig.root.scale.setScalar(1.15);
    this.scene.add(this.player.rig.root);
    this.hauler = this.makeCarrier(buildCharacter(HAULER_STYLE), state.hauler.carry);
    this.haulerRoot = this.hauler.rig.root;
    this.haulerRoot.scale.setScalar(1.08);
    this.scene.add(this.haulerRoot);

    // Cash pile on the pad
    const billGeo = new THREE.BoxGeometry(0.36, 0.05, 0.2);
    const billMat = new THREE.MeshLambertMaterial({ color: PALETTE.cash });
    this.cashStack = new THREE.InstancedMesh(billGeo, billMat, 40);
    this.cashStack.count = 0;
    this.cashStack.castShadow = true;
    this.cashStack.frustumCulled = false;
    this.scene.add(this.cashStack);

    // Clumps riding the conveyor while vacuuming
    this.conveyorMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 16);
    this.conveyorMesh.count = 0;
    this.conveyorMesh.frustumCulled = false;
    this.scene.add(this.conveyorMesh);

    // Tutorial arrow
    this.arrow = new THREE.Group();
    const arrowMat = new THREE.MeshLambertMaterial({ color: PALETTE.warm, emissive: new THREE.Color(PALETTE.warm), emissiveIntensity: 0.25 });
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 4), arrowMat);
    head.rotation.x = Math.PI;
    head.position.y = 0.25;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.45, 0.2), arrowMat);
    stem.position.y = 0.72;
    this.arrow.add(head, stem);
    this.arrow.visible = false;
    this.scene.add(this.arrow);

    this.syncStatic();
    this.hose.reset(this.anchorV, this.mountWorldPos());
  }

  private makeCarrier(rig: CharacterRig, bales: GameState['player']['carry']): CarrierVisual {
    return {
      rig,
      anim: new CharacterAnimator(rig),
      view: { anchor: rig.stackAnchor, bales, swayX: 0, swayZ: 0, bounce: 0 },
      swayX: new Spring(90, 9),
      swayZ: new Spring(90, 9),
      bounce: new Spring(200, 12),
      lastVx: 0,
      lastVz: 0,
      prevX: 0,
      prevZ: 0,
    };
  }

  /** Re-points visuals at a (new) state object, e.g. after load/reset. */
  setState(state: GameState): void {
    this.state = state;
    this.field.setField(state.field);
    this.bales.clearFlights();
    this.player.view.bales = state.player.carry;
    this.hauler.view.bales = state.hauler.carry;
    this.syncStatic();
    this.hose.reset(this.anchorV, this.mountWorldPos());
  }

  setQuality(q: QualityProfile, renderer: THREE.WebGLRenderer): void {
    this.field.setDetail(q.grass);
    this.particles.setBudget(q.debris);
    this.sun.castShadow = q.shadows;
    renderer.shadowMap.enabled = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  /** Things that only change on purchase/load. */
  syncStatic(): void {
    const s = this.state;
    this.applyToolScale();
    this.haulerRoot.visible = s.hauler.level > 0;
    this.player.view.bales = s.player.carry;
    this.hauler.view.bales = s.hauler.carry;
    this.swapT = 1;
    this.swapTo = s.harvester.tool;
  }

  private applyToolScale(): void {
    const s = this.state;
    const br = BLADE.radius(s.upgrades.blade);
    this.toolScaleBlade = br;
    this.toolScaleVac = 1.05 + (s.upgrades.vacuum - 1) * 0.07;
  }

  private mountWorldPos(): THREE.Vector3 {
    this.tool.root.updateMatrixWorld(true);
    return this.mountWorld.copy(this.tool.hoseMount).applyMatrix4(this.tool.pivot.matrixWorld);
  }

  // ---- Events ------------------------------------------------------------------------

  handleEvent(e: GameEvent): void {
    const s = this.state;
    switch (e.type) {
      case 'cellsCut': {
        const n = e.cells.length;
        // Visual batching: at most a handful of debris per cut cell and per frame.
        const per = n > 12 ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const i = e.cells[k];
          this.field.updateCell(i);
          if (k < 24) {
            const tier = s.field.tier[i] as TierId;
            this.particles.cutBurst(cellCenterX(i), cellCenterZ(i), e.dirX, e.dirZ, tierColor[tier], tier === 1 ? 0.5 : 0.9, per);
          }
        }
        if (n > 0) {
          const i = e.cells[0];
          this.particles.dust(cellCenterX(i), 0.1, cellCenterZ(i), soilColor, Math.min(3, 1 + (n >> 2)), 0.4, 0.5);
          this.toolRecoil = Math.min(1, this.toolRecoil + n * 0.08);
        }
        break;
      }
      case 'vacuumed': {
        const nx = s.harvester.x;
        const nz = s.harvester.z;
        for (let k = 0; k < e.cells.length; k++) {
          const i = e.cells[k];
          this.field.updateCell(i);
          this.particles.suck(cellCenterX(i), cellCenterZ(i), tierColor[e.tiers[k]], nx, nz);
        }
        if (e.cells.length > 0) {
          // Nozzle "gulps"; hose pulses are spaced out so they read as separate slugs.
          this.vacGulp.kick(-(0.9 + e.cells.length * 0.35));
          this.pulseAcc += e.cells.length;
          if (this.time - this.lastPulse > 0.09) {
            this.hose.addPulse(e.tiers[0], Math.min(1.5, 0.75 + this.pulseAcc * 0.12));
            this.lastPulse = this.time;
            this.pulseAcc = 0;
          }
          for (let k = 0; k < Math.min(3, e.cells.length); k++)
            if (this.conveyorItems.length < 16) this.conveyorItems.push({ t: -k * 0.12 - 0.5, tier: e.tiers[k] });
        }
        break;
      }
      case 'balePacked': {
        const idx = s.depot.bales.findIndex((b) => b.id === e.bale.id);
        if (idx < 0) break;
        const from = this.tmp.set(CONVEYOR.x1 + 0.2, 0.9, CONVEYOR.z);
        const slot = new THREE.Vector3();
        this.bales.launch(e.bale, from, () => this.bales.depotSlot(Math.max(0, s.depot.bales.findIndex((b) => b.id === e.bale.id)), slot), 0.26, 0.6);
        break;
      }
      case 'pickup': {
        const carrier = e.carrier === 'player' ? this.player : this.hauler;
        const from = this.bales.depotSlot(e.depotIndex, new THREE.Vector3());
        const target = new THREE.Vector3();
        const idx = () => Math.max(0, carrier.view.bales.findIndex((b) => b.id === e.bale.id));
        this.bales.launch(e.bale, from, () => this.bales.stackTop(carrier.view, idx(), target), 0.22, 0.7, () => {
          carrier.bounce.kick(-2.2);
        });
        break;
      }
      case 'deliver': {
        const carrier = e.carrier === 'player' ? this.player : this.hauler;
        const from = this.bales.stackTop(carrier.view, carrier.view.bales.length, new THREE.Vector3());
        const target = new THREE.Vector3();
        this.bales.launch(e.bale, from, () => this.bales.dockSlot(e.dockIndex, target), 0.2, 0.8);
        break;
      }
      case 'truckLoad': {
        const from = this.bales.dockSlot(e.dockIndex, new THREE.Vector3());
        const target = new THREE.Vector3();
        this.bales.launch(e.bale, from, () => this.bales.truckSlot(this.truck.bed, e.truckSlot, target), 0.2, 0.9, () => {
          this.truckSquash.kick(-1.2);
        });
        break;
      }
      case 'cashCollected':
        this.cashPop = this.time;
        break;
      case 'upgradeBought': {
        this.applyToolScale();
        if (e.id === 'reach') {
          this.reachSweepFrom = REACH.length(e.level - 1);
          this.reachSweepTo = REACH.length(e.level);
          this.reachSweepT = 0;
          this.reachGlowPending = true;
        }
        break;
      }
      case 'haulerBought':
        this.haulerRoot.visible = true;
        this.particles.sparkle(s.hauler.x, 1, s.hauler.z, new THREE.Color(PALETTE.gold), 14);
        break;
      case 'toolSwitchStart':
        this.swapFrom = e.to === 'BLADE' ? 'VACUUM' : 'BLADE';
        this.swapTo = e.to;
        this.swapT = 0;
        break;
      case 'replantStart':
        this.field.replantWave(e.cells);
        break;
      case 'reachLimit':
        // The hose snaps taut: a small twang and a tug on the head.
        this.hose.pluck(0.035 * this.motionScale);
        this.toolRecoil = Math.min(1, this.toolRecoil + 0.35);
        break;
      case 'levelUp':
        this.particles.sparkle(s.player.x, 1.6, s.player.z, new THREE.Color(PALETTE.gold), 18);
        break;
      default:
        break;
    }
  }

  /** Rebuilds every cell (after load/debug). */
  refreshField(): void {
    this.field.refreshAll(true);
  }

  setWorkshopLight(on: boolean): void {
    this.workshopLightTarget = on ? 1 : 0;
  }

  setTutorialTarget(t: TutorialTarget, visible: boolean): void {
    let p: THREE.Vector3 | null = null;
    if (visible && t && t.startsWith('pad:')) {
      const key = t.slice(4) as keyof typeof PADS;
      const pad = PADS[key];
      if (pad) p = new THREE.Vector3(pad.x, 0, pad.z);
    }
    this.arrowTarget = p;
    this.arrow.visible = !!p;
  }

  get arrowWorld(): THREE.Vector3 | null {
    return this.arrowTarget;
  }

  // ---- Frame update -------------------------------------------------------------------

  update(
    dt: number,
    alpha: number,
    view: ViewMode,
    rt: SimRuntime,
    prev: { tx: number; tz: number; px: number; pz: number; hx: number; hz: number },
    cameraTarget: THREE.Vector3,
  ): void {
    this.time += dt;
    const s = this.state;
    const ms = this.motionScale;
    this.particles.motionScale = ms;

    // Tool head (interpolated)
    const h = s.harvester;
    const tx = prev.tx + (h.x - prev.tx) * alpha;
    const tz = prev.tz + (h.z - prev.tz) * alpha;
    this.toolPos.set(tx, 0, tz);
    this.tool.root.position.set(tx, 0, tz);
    const sp = Math.hypot(h.vx, h.vz);
    if (sp > 0.2) {
      const targetYaw = Math.atan2(h.vx, h.vz);
      let d = targetYaw - this.toolYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.toolYaw += d * damp(0.09, dt);
    }
    // Yaw so the hose collar trails toward the anchor when idle.
    this.tool.pivot.rotation.y = this.toolYaw;
    const tiltAmt = THREE.MathUtils.degToRad(JUICE.toolTiltDeg) * ms;
    this.toolTilt.x += (clamp01(sp / 3.4) * tiltAmt - this.toolTilt.x) * damp(0.08, dt);
    this.toolRecoil *= Math.exp(-dt * 10);
    // Chewing through thick crop: the head judders a little in proportion to the cutting drag.
    const drag01 = view === 'HARVEST' ? clamp01((1 - rt.cutSpeedMul) / BLADE.maxDrag) : 0;
    const jud = drag01 * drag01 * ms;
    this.tool.pivot.rotation.x = this.toolTilt.x + Math.sin(this.time * 60) * 0.02 * this.toolRecoil * ms + Math.sin(this.time * 53) * 0.03 * jud;
    this.tool.pivot.rotation.z = Math.sin(this.time * 47) * 0.025 * jud;
    this.tool.pivot.position.y = TOOL_HEIGHT - 0.34 + Math.sin(this.time * 7) * 0.012 * ms + Math.abs(Math.sin(this.time * 61)) * 0.02 * jud;

    // Tool swap animation (~160 ms): old retracts, new pops in.
    this.swapT = Math.min(1, this.swapT + dt / 0.16);
    const toolActive = view === 'HARVEST';
    const k1 = this.swapT < 0.5 ? 1 - ease.inCubic(this.swapT * 2) : 0;
    const k2 = this.swapT < 0.5 ? 0 : ease.outBack((this.swapT - 0.5) * 2);
    const bladeK = this.swapT >= 1 ? (this.swapTo === 'BLADE' ? 1 : 0) : this.swapTo === 'BLADE' ? k2 : this.swapFrom === 'BLADE' ? k1 : 0;
    const vacK = this.swapT >= 1 ? (this.swapTo === 'VACUUM' ? 1 : 0) : this.swapTo === 'VACUUM' ? k2 : this.swapFrom === 'VACUUM' ? k1 : 0;
    this.tool.blade.visible = bladeK > 0.01;
    this.tool.vacuum.visible = vacK > 0.01;
    const bs = this.toolScaleBlade;
    this.tool.blade.scale.set(Math.max(0.001, bladeK), Math.max(0.001, bladeK), Math.max(0.001, bladeK));
    this.tool.bladeDisc.scale.set(bs, 1, bs);
    this.tool.bladeBlur.scale.set(bs, bs, 1);
    const vacOn = toolActive && h.tool === 'VACUUM' && h.switchT <= 0;
    const intake01 = clamp01(rt.vacuumRate / VACUUM.intake(s.upgrades.vacuum));
    const gulp = this.vacGulp.update(dt) * ms;
    const hum = vacOn ? Math.sin(this.time * 38) * 0.03 * intake01 * ms : 0;
    const vs = Math.max(0.001, vacK * this.toolScaleVac);
    this.tool.vacuum.scale.set(vs * (1 - gulp * 0.1 + hum), vs * (1 + gulp * 0.16 - hum), vs * (1 - gulp * 0.1 + hum));

    // Blade spin (spins while blade mode is active in harvest; spools down otherwise).
    // The disc bogs down a little under load (it spins up again on clear ground).
    const wantSpin = toolActive && h.tool === 'BLADE' && h.switchT <= 0 ? (40 + rt.bladeContacts * 0.5) * (1 - 0.4 * drag01) : 0;
    this.bladeSpeed += (wantSpin - this.bladeSpeed) * damp(wantSpin > this.bladeSpeed ? 0.25 : 0.6, dt);
    this.bladeSpin += this.bladeSpeed * dt;
    this.tool.bladeDisc.rotation.y = this.bladeSpin;
    (this.tool.bladeBlur.material as THREE.MeshBasicMaterial).opacity = clamp01(this.bladeSpeed / 38) * 0.3;
    this.tool.swirl.rotation.y -= dt * (vacOn ? 8 + intake01 * 10 : 1.5);
    (this.tool.swirl.material as THREE.MeshBasicMaterial).opacity = vacOn ? 0.28 + intake01 * 0.35 : 0.08;
    this.tool.swirl.scale.setScalar(VACUUM.radius(s.upgrades.vacuum) / this.toolScaleVac);

    // Radius ring on the ground
    const ringR = h.tool === 'BLADE' ? BLADE.radius(s.upgrades.blade) : VACUUM.radius(s.upgrades.vacuum);
    this.tool.radiusRing.scale.set(ringR, ringR, 1);
    this.tool.radiusRingMat.opacity = toolActive ? (h.tool === 'VACUUM' ? 0.4 : 0.22) : 0;

    // Grass reacts to the tool
    const u = this.field.uniforms;
    u.uToolPos.value.set(tx, 0, tz);
    u.uToolRadius.value = ringR;
    u.uToolVel.value.set(h.vx, h.vz);
    const pushTarget = !toolActive ? 0 : h.tool === 'BLADE' ? 1 : -0.35;
    u.uToolPush.value += (pushTarget - u.uToolPush.value) * damp(0.15, dt);
    u.uWind.value = 0.35 + 0.65 * ms;
    // Suction pulls nearby cuttings (shader) and draws a stream of air motes into the nozzle.
    const vr = VACUUM.radius(s.upgrades.vacuum);
    this.vacPull += ((vacOn ? 1 : 0) - this.vacPull) * damp(0.12, dt);
    u.uVacPull.value = this.vacPull;
    u.uVacInner.value = vr;
    u.uVacOuter.value = vr * VACUUM.attractScale;
    this.moteT -= dt;
    if (vacOn && this.moteT <= 0) {
      this.moteT = 0.05 - intake01 * 0.02;
      this.particles.mote(tx, tz, vr, this.moteColor);
    }
    this.field.refreshDamageNear(h.x, h.z, BLADE.radius(s.upgrades.blade) + 0.3);
    this.field.update(dt, this.time);

    // Hose: slack in open field, straight and taut at the limit, under tension in the elastic give.
    const reach = REACH.length(s.upgrades.reach);
    const closeness = reachDistance(tx, tz) / reach;
    const stretch = toolActive ? rt.reachStretch : 0;
    this.hose.update(dt, this.anchorV, this.mountWorldPos(), closeness, stretch);
    const payout = this.hose.restLength - this.lastRest;
    this.lastRest = this.hose.restLength;
    this.reelAngle += payout * 2.4;
    this.tractor.reel.rotation.x = this.reelAngle;

    // Head leans back toward the machine as the hose pulls (and wobbles a little when stretched).
    const leanTarget = toolActive ? (clamp01((closeness - 0.97) / 0.03) * 0.05 + this.hose.stretch * 0.2) * ms : 0;
    this.leanAmt += (leanTarget - this.leanAmt) * damp(0.06, dt);
    const ox = tx - HOSE_ANCHOR.x;
    const oz = tz - HOSE_ANCHOR.z;
    const ol = Math.hypot(ox, oz) || 1;
    const wob = Math.sin(this.time * 31) * 0.02 * this.hose.stretch * ms;
    this.toolLean.rotation.x = (-oz / ol) * (this.leanAmt + wob);
    this.toolLean.rotation.z = (ox / ol) * (this.leanAmt + wob);

    // Newly reachable rows glow after a Hose Length upgrade (replayed when entering harvest).
    if (view === 'HARVEST' && this.lastView !== 'HARVEST' && this.reachGlowPending) this.reachSweepT = 0;
    if (view === 'HARVEST' && this.reachSweepT > 0.3) this.reachGlowPending = false;
    this.lastView = view;
    if (this.reachSweepT >= 0) {
      this.reachSweepT += dt;
      u.uReachFrom.value = this.reachSweepFrom;
      u.uReachTo.value = this.reachSweepTo;
      u.uReachSweep.value = ease.outCubic(clamp01(this.reachSweepT / 1.0));
      u.uReachFlash.value = this.reachSweepT < 1.6 ? 1 : Math.max(0, 1 - (this.reachSweepT - 1.6) / 0.9);
      if (this.reachSweepT > 2.5) {
        this.reachSweepT = -1;
        u.uReachFlash.value = 0;
      }
    }

    // Machine: works (vibrates, beacon spins, exhaust puffs) while harvesting.
    const working = view === 'HARVEST' ? 1 : 0;
    this.machineWork += (working - this.machineWork) * damp(0.3, dt);
    const vib = this.machineWork * 0.012 * ms * (1 + rt.bladeContacts * 0.02);
    this.tractor.body.position.set(Math.sin(this.time * 71) * vib, Math.abs(Math.sin(this.time * 53)) * vib, 0);
    this.tractor.beacon.rotation.y += dt * 8 * this.machineWork;
    this.tractor.beaconMat.color.setRGB(1, 0.62 + 0.3 * Math.max(0, Math.sin(this.time * 9)) * this.machineWork, 0.25);
    this.exhaustT -= dt;
    if (this.exhaustT <= 0) {
      this.exhaustT = this.machineWork > 0.5 ? 0.22 - clamp01(rt.bladeContacts / 30) * 0.1 : 0.9;
      const p = this.tmp.copy(this.tractor.exhaustTip).add(this.tractor.root.position);
      this.particles.dust(p.x, p.y, p.z, this.smokeColor, 1, 0.05, 0.9);
    }
    // Conveyor clumps
    const belt = this.env.conveyorTex;
    belt.offset.x -= dt * (0.4 + this.conveyorItems.length * 0.1);
    let cn = 0;
    const m4 = this.m4;
    for (let i = this.conveyorItems.length - 1; i >= 0; i--) {
      const it = this.conveyorItems[i];
      it.t += dt * 1.4;
      if (it.t >= 1) {
        this.conveyorItems.splice(i, 1);
        continue;
      }
      if (it.t < 0) continue;
      const x = CONVEYOR.x0 + (CONVEYOR.x1 - CONVEYOR.x0) * it.t;
      m4.makeTranslation(x, 0.76, CONVEYOR.z + Math.sin(i * 3.1) * 0.12);
      this.conveyorMesh.setMatrixAt(cn, m4);
      this.conveyorMesh.setColorAt(cn, tierMid[it.tier]);
      cn++;
    }
    this.conveyorMesh.count = cn;
    this.conveyorMesh.instanceMatrix.needsUpdate = true;
    if (this.conveyorMesh.instanceColor) this.conveyorMesh.instanceColor.needsUpdate = true;

    // Player + hauler
    const px = prev.px + (s.player.x - prev.px) * alpha;
    const pz = prev.pz + (s.player.z - prev.pz) * alpha;
    const carrySpeed = 3.8 * CARRY.speedMultiplier(s.upgrades.carry);
    this.updateCarrier(this.player, dt, px, pz, s.player.facing, Math.hypot(s.player.vx, s.player.vz), carrySpeed, s.player.carry.length);
    if (s.hauler.level > 0) {
      const hx = prev.hx + (s.hauler.x - prev.hx) * alpha;
      const hz = prev.hz + (s.hauler.z - prev.hz) * alpha;
      this.updateCarrier(this.hauler, dt, hx, hz, s.hauler.facing, Math.hypot(s.hauler.vx, s.hauler.vz), haulerStats(s.hauler.level).speed, s.hauler.carry.length);
    }

    // Truck
    const tr = s.truck;
    this.truck.root.position.x = tr.x;
    const dx = tr.x - this.lastTruckX;
    this.lastTruckX = tr.x;
    this.truckWheelAngle -= dx / 0.36;
    for (const w of this.truck.wheels) w.rotation.z = this.truckWheelAngle;
    this.truckSquash.target = -Math.min(0.1, tr.cargo.length * 0.012);
    const squash = this.truckSquash.update(dt);
    this.truck.body.position.y = squash * 0.12 * (0.5 + 0.5 * ms);
    this.truck.body.rotation.z = Math.abs(dx) > 0.001 ? Math.sin(this.time * 18) * 0.006 * ms : 0;

    // Bales
    this.player.view.bales = s.player.carry;
    this.hauler.view.bales = s.hauler.carry;
    const stacks: StackView[] = [this.player.view];
    if (s.hauler.level > 0) stacks.push(this.hauler.view);
    this.bales.update(dt, s.depot.bales, stacks, this.truck.root.position.x > -30 ? this.truck.bed : null, tr.cargo, tr.dock);

    // Cash pile grows with pending cash
    const bills = Math.min(40, Math.ceil(s.pendingCashCents / 400));
    this.cashShown += (bills - this.cashShown) * damp(0.08, dt);
    const shown = Math.round(this.cashShown);
    const popK = this.cashPop >= 0 ? popScale(this.time - this.cashPop, 0.3, 1.25) : 1;
    for (let i = 0; i < shown; i++) {
      const layer = Math.floor(i / 4);
      const j = i % 4;
      m4.makeRotationY((j * 0.9 + layer * 0.37) % 1.2 - 0.3);
      m4.setPosition(PADS.cash.x + ((j % 2) - 0.5) * 0.4, 0.06 + layer * 0.055, PADS.cash.z + (Math.floor(j / 2) - 0.5) * 0.26 + 0.35);
      if (popK !== 1) m4.scale(this.tmp2.setScalar(popK));
      this.cashStack.setMatrixAt(i, m4);
    }
    this.cashStack.count = shown;
    this.cashStack.instanceMatrix.needsUpdate = true;

    // Pads: highlight zones the player is standing on; hire pad only when available.
    const z = rt.zones;
    this.pulsePad('harvest', z.harvest, dt);
    this.pulsePad('depot', z.depot, dt);
    this.pulsePad('deliver', z.deliver, dt);
    this.pulsePad('cash', z.cash || s.pendingCashCents > 0, dt, z.cash ? 0.9 : 0.35 + 0.25 * Math.sin(this.time * 4));
    this.pulsePad('upgrade', z.upgrade, dt);
    this.pulsePad('hauler', z.hauler, dt);
    this.env.hireGroup.visible = s.stats.firstSaleDone && s.hauler.level === 0;

    // Workshop lamp
    this.workshopLight += (this.workshopLightTarget - this.workshopLight) * damp(0.12, dt);
    this.env.workshopLampMat.color.copy(this.lampOff).lerp(this.lampOn, this.workshopLight);
    this.env.workshopGlowMat.opacity = this.workshopLight * 0.35;

    // Tutorial arrow bob
    if (this.arrowTarget) {
      this.arrow.position.set(this.arrowTarget.x, 1.2 + Math.abs(Math.sin(this.time * 3.2)) * 0.45 * (0.4 + 0.6 * ms), this.arrowTarget.z);
      this.arrow.rotation.y += dt * 1.5;
    }

    this.particles.update(dt, this.nozzleWorld.set(tx, 0.25, tz));

    // Keep the shadow camera around what's on screen.
    this.sun.position.set(cameraTarget.x - 8, 16, cameraTarget.z - 6);
    this.sun.target.position.set(cameraTarget.x, 0, cameraTarget.z);
  }

  private pulsePad(key: keyof typeof PADS, on: boolean, dt: number, level = 0.9): void {
    const p = this.env.pads[key];
    const cur = this.padPulse[key] ?? 0;
    const next = cur + ((on ? level : 0) - cur) * damp(0.1, dt);
    this.padPulse[key] = next;
    p.ringMat.opacity = next;
    const sc = 1 + next * 0.06 * Math.sin(this.time * 6) * this.motionScale;
    p.ring.scale.set(sc, sc, 1);
  }

  private updateCarrier(c: CarrierVisual, dt: number, x: number, z: number, facing: number, speed: number, maxSpeed: number, carrying: number): void {
    c.rig.root.position.set(x, 0, z);
    c.rig.root.rotation.y = facing;
    c.anim.update(dt, speed, maxSpeed, carrying, this.motionScale);
    // Stack follow-through: springs driven by acceleration in local space.
    const vx = dt > 0 ? (x - c.prevX) / dt : 0;
    const vz = dt > 0 ? (z - c.prevZ) / dt : 0;
    c.prevX = x;
    c.prevZ = z;
    const ax = (vx - c.lastVx) / Math.max(dt, 1e-3);
    const az = (vz - c.lastVz) / Math.max(dt, 1e-3);
    c.lastVx = vx;
    c.lastVz = vz;
    const cs = Math.cos(facing);
    const sn = Math.sin(facing);
    const fwd = ax * sn + az * cs;
    const side = ax * cs - az * sn;
    const maxSway = THREE.MathUtils.degToRad(JUICE.stackSwayDeg) * this.motionScale;
    c.swayX.target = THREE.MathUtils.clamp(-fwd * 0.012, -maxSway, maxSway);
    c.swayZ.target = THREE.MathUtils.clamp(side * 0.012, -maxSway, maxSway);
    c.view.swayX = c.swayX.update(dt);
    c.view.swayZ = c.swayZ.update(dt);
    c.bounce.target = speed > 0.3 ? Math.abs(Math.sin(this.time * 11)) * 0.03 * this.motionScale : 0;
    c.view.bounce = c.bounce.update(dt);
  }

  get toolWorldPos(): THREE.Vector3 {
    return this.toolWorld.set(this.toolPos.x, 0.5, this.toolPos.z);
  }

  playerWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.player.rig.root.position);
  }

  stackTopWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.bales.stackTop(this.player.view, Math.max(0, this.state.player.carry.length), out);
  }

  debugInfo(): { particles: number; flights: number; hosePulses: number } {
    return { particles: this.particles.activeCount, flights: this.bales.flightCount, hosePulses: this.hose.activePulses };
  }
}
