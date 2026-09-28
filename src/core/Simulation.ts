// Gameplay simulation: runs at a fixed timestep, owns all committed state changes and
// emits events for presentation. Contains no rendering, DOM or audio code.

import {
  BLADE,
  CARRY,
  HARVESTER,
  PLAYER,
  REACH,
  REPLANT,
  TIERS,
  TUNING,
  VACUUM,
  type TierId,
  type UpgradeId,
} from '../config/balance';
import { FIELD, PADS, STATIC_COLLIDERS, palletColliders, type Aabb, type Pad } from '../config/worldLayout';
import { EventQueue } from './Events';
import type { GameState, ToolId } from './GameState';
import { applyBladeSweep, createCutOutput } from '../gameplay/CuttingSystem';
import { applyVacuum, createVacuumOutput } from '../gameplay/VacuumSystem';
import { moveHarvester, type MoveInput } from '../gameplay/Harvester';
import { movePlayer } from '../gameplay/Player';
import { updateTruck } from '../gameplay/Truck';
import { createHaulerRuntime, updateHauler, type HaulerRuntime } from '../gameplay/Hauler';
import { buyHauler, buyUpgrade, collectCash, deliverOne, type PurchaseResult } from '../gameplay/Economy';
import { canPackLeftovers, packLeftovers, takeTopBale } from '../gameplay/Inventory';
import { updateGoals } from '../gameplay/Goals';
import { replantCells, replantEligible, CELL, cellCenterX, cellCenterZ, forEachCellInRadius } from '../world/FieldModel';

export type SimMode = 'FARM' | 'HARVEST' | 'TRANSITION' | 'IDLE';

export interface SimRuntime {
  mode: SimMode;
  replantT: number;
  harvestPadT: number;
  harvestPadArmed: boolean;
  upgradePadArmed: boolean;
  depotDwell: number;
  depotTimer: number;
  carryFullNotified: boolean;
  deliverTimer: number;
  hireT: number;
  hireArmed: boolean;
  reachPushT: number;
  reachHintCd: number;
  reachTapCd: number;
  wasAtLimit: boolean;
  footTimer: number;
  /** Smoothed presentation signals (not saved). */
  bladeContacts: number;
  vacuumRate: number;
  vacuumAvailable: number;
  toolSpeed: number;
  atReachLimit: boolean;
  /** 0..1 elastic give past the reach limit (presentation). */
  reachStretch: number;
  /** Current speed multiplier from cutting drag (1 = free, ≥ 1 − maxDrag). */
  cutSpeedMul: number;
  /** Reach metric / reach (≈1 at the limit). */
  reachCloseness: number;
  zones: { harvest: boolean; depot: boolean; deliver: boolean; cash: boolean; upgrade: boolean; hauler: boolean };
}

function createRuntime(): SimRuntime {
  return {
    mode: 'IDLE',
    replantT: 0,
    harvestPadT: 0,
    harvestPadArmed: true,
    upgradePadArmed: true,
    depotDwell: 0,
    depotTimer: 0,
    carryFullNotified: false,
    deliverTimer: 0,
    hireT: 0,
    hireArmed: true,
    reachPushT: 0,
    reachHintCd: 0,
    reachTapCd: 0,
    wasAtLimit: false,
    footTimer: 0,
    bladeContacts: 0,
    vacuumRate: 0,
    vacuumAvailable: 0,
    toolSpeed: 0,
    atReachLimit: false,
    reachStretch: 0,
    reachCloseness: 0,
    cutSpeedMul: 1,
    zones: { harvest: false, depot: false, deliver: false, cash: false, upgrade: false, hauler: false },
  };
}


function inPad(x: number, z: number, p: Pad): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  return dx * dx + dz * dz <= p.r * p.r;
}

export class Simulation {
  state: GameState;
  readonly events = new EventQueue();
  rt: SimRuntime = createRuntime();
  hauler: HaulerRuntime = createHaulerRuntime();
  private cutOut = createCutOutput();
  private vacOut = createVacuumOutput();
  private readonly colliderList: Aabb[] = [...STATIC_COLLIDERS, ...palletColliders()];

  constructor(state: GameState) {
    this.state = state;
  }

  setState(state: GameState): void {
    this.state = state;
    const mode = this.rt.mode;
    this.rt = createRuntime();
    this.rt.mode = mode;
    this.hauler = createHaulerRuntime();
  }

  setMode(mode: SimMode): void {
    this.rt.mode = mode;
    const p = this.state.player;
    const h = this.state.harvester;
    if (mode !== 'FARM') {
      p.vx = 0;
      p.vz = 0;
    }
    if (mode !== 'HARVEST') {
      h.vx = 0;
      h.vz = 0;
    }
    if (mode === 'FARM') {
      // Entering/re-entering the farm (also after a load): pads the player already stands on
      // only trigger after stepping off and back on.
      this.rt.harvestPadArmed = !inPad(p.x, p.z, PADS.harvest);
      this.rt.upgradePadArmed = !inPad(p.x, p.z, PADS.upgrade);
      this.rt.hireArmed = !inPad(p.x, p.z, PADS.hauler);
    }
  }

  get replanting(): boolean {
    return this.rt.replantT > 0;
  }

  get toolState(): ToolId | 'SWITCHING' {
    return this.state.harvester.switchT > 0 ? 'SWITCHING' : this.state.harvester.tool;
  }

  reach(): number {
    return REACH.length(this.state.upgrades.reach);
  }

  step(dt: number, move: MoveInput): void {
    const s = this.state;
    const rt = this.rt;
    s.stats.playSeconds += dt;
    rt.reachHintCd = Math.max(0, rt.reachHintCd - dt);
    rt.reachTapCd = Math.max(0, rt.reachTapCd - dt);
    if (rt.replantT > 0) {
      rt.replantT -= dt;
      if (rt.replantT <= 0) {
        rt.replantT = 0;
        this.events.push({ type: 'replantDone', cells: 0 });
      }
    }

    let contacts = 0;
    let vacTaken = 0;
    let vacAvail = 0;
    if (rt.mode === 'HARVEST') {
      const r = this.stepHarvest(dt, move);
      contacts = r.contacts;
      vacTaken = r.vacTaken;
      vacAvail = r.vacAvail;
    } else {
      rt.toolSpeed = 0;
      rt.atReachLimit = false;
      rt.reachStretch = 0;
      rt.cutSpeedMul = 1;
    }
    if (rt.mode === 'FARM') this.stepFarm(dt, move);
    else this.clearZones();

    // Presentation signals, smoothed over ~120 ms.
    const k = 1 - Math.exp(-dt / 0.12);
    rt.bladeContacts += (contacts - rt.bladeContacts) * k;
    rt.vacuumRate += (vacTaken / dt - rt.vacuumRate) * k;
    rt.vacuumAvailable += (vacAvail - rt.vacuumAvailable) * k;

    updateTruck(s.truck, dt, this.events);
    updateHauler(s, this.hauler, dt, this.events);
    updateGoals(s, this.events);
  }

  private stepHarvest(dt: number, move: MoveInput): { contacts: number; vacTaken: number; vacAvail: number } {
    const s = this.state;
    const rt = this.rt;
    const h = s.harvester;
    const reach = this.reach();
    const px = h.x;
    const pz = h.z;
    // Cutting drag: the spinning disc has to chew through standing crop, which slows the head.
    let dragTarget = 1;
    if (h.tool === 'BLADE' && h.switchT <= 0 && rt.replantT <= 0) {
      const lvl = s.upgrades.blade;
      const r = BLADE.radius(lvl) + BLADE.contactSlack;
      // Only the leading half of the disc pushes into crop; the trailing half sits on the
      // swath it just cut. When not moving, the whole disc counts.
      const vx = h.vx + move.x * 0.5;
      const vz = h.vz + move.z * 0.5;
      const vl = Math.hypot(vx, vz);
      const dx = vl > 0.05 ? vx / vl : 0;
      const dz = vl > 0.05 ? vz / vl : 0;
      let hpSum = 0;
      let cells = 0;
      const f = s.field;
      forEachCellInRadius(h.x, h.z, r, (i) => {
        if (vl > 0.05 && (cellCenterX(i) - h.x) * dx + (cellCenterZ(i) - h.z) * dz < -0.05) return;
        cells++;
        if (f.state[i] === CELL.GROWING) hpSum += f.hp[i];
      });
      const density = cells > 0 ? hpSum / (cells * FIELD.cell * FIELD.cell) : 0;
      const drag = density / (density + BLADE.dps(lvl) * BLADE.dragK);
      dragTarget = 1 - BLADE.maxDrag * drag;
    }
    rt.cutSpeedMul += (dragTarget - rt.cutSpeedMul) * (1 - Math.exp(-dt / BLADE.dragTau));
    const res = moveHarvester(h, move, dt, reach, HARVESTER.baseSpeed * rt.cutSpeedMul);
    rt.toolSpeed = res.speed / HARVESTER.baseSpeed;
    rt.atReachLimit = res.atLimit;
    rt.reachStretch = res.stretch;
    rt.reachCloseness = res.closeness;

    const maxed = s.upgrades.reach >= REACH.maxLevel;
    if (res.atLimit && !rt.wasAtLimit && rt.reachTapCd <= 0 && Math.hypot(move.x, move.z) > 0.2) {
      rt.reachTapCd = HARVESTER.reachTapCooldown;
      this.events.push({ type: 'reachLimit' });
    }
    rt.wasAtLimit = res.atLimit;
    if (res.pushingLimit && !maxed) {
      rt.reachPushT += dt;
      if (rt.reachPushT >= HARVESTER.reachPushHintDelay && rt.reachHintCd <= 0) {
        rt.reachHintCd = HARVESTER.reachPushHintCooldown;
        this.events.push({ type: 'reachHint' });
      }
    } else {
      rt.reachPushT = 0;
    }

    if (h.switchT > 0) {
      h.switchT -= dt;
      if (h.switchT <= 0) {
        h.switchT = 0;
        this.events.push({ type: 'toolSwitched', tool: h.tool });
      }
      return { contacts: 0, vacTaken: 0, vacAvail: 0 };
    }
    if (rt.replantT > 0) return { contacts: 0, vacTaken: 0, vacAvail: 0 };

    if (h.tool === 'BLADE') {
      const out = this.cutOut;
      out.cut.length = 0;
      out.damaged.length = 0;
      out.contacts = 0;
      const lvl = s.upgrades.blade;
      applyBladeSweep(s.field, px, pz, h.x, h.z, BLADE.radius(lvl) + BLADE.contactSlack, BLADE.dps(lvl), dt, out);
      if (out.cut.length > 0) {
        for (const i of out.cut) {
          const tier = s.field.tier[i] as TierId;
          const units = TIERS[tier].unitsPerCell;
          s.stats.unitsCut += units;
          s.stats.cutByTier[tier] += units;
          if (tier === 0 && !s.tutorial.done) s.tutorial.cutCount += units;
        }
        const sp = Math.hypot(h.vx, h.vz);
        this.events.push({
          type: 'cellsCut',
          cells: out.cut.slice(),
          dirX: sp > 0.01 ? h.vx / sp : 0,
          dirZ: sp > 0.01 ? h.vz / sp : 1,
        });
      }
      return { contacts: out.contacts, vacTaken: 0, vacAvail: 0 };
    }

    const out = this.vacOut;
    out.cells.length = 0;
    out.tiers.length = 0;
    out.bales.length = 0;
    out.available = 0;
    const lvl = s.upgrades.vacuum;
    applyVacuum(s, h.x, h.z, VACUUM.radius(lvl), VACUUM.intake(lvl) * TUNING.vacuumIntakeMul, dt, out);
    if (out.cells.length > 0) this.events.push({ type: 'vacuumed', cells: out.cells.slice(), tiers: out.tiers.slice() });
    for (const b of out.bales) this.events.push({ type: 'balePacked', bale: b, mini: false });
    return { contacts: 0, vacTaken: out.cells.length, vacAvail: out.available };
  }

  private colliders(): Aabb[] {
    return this.colliderList;
  }

  private clearZones(): void {
    const z = this.rt.zones;
    z.harvest = z.depot = z.deliver = z.cash = z.upgrade = z.hauler = false;
    this.rt.depotDwell = 0;
    this.rt.hireT = 0;
  }

  private stepFarm(dt: number, move: MoveInput): void {
    const s = this.state;
    const rt = this.rt;
    const p = s.player;
    const speed = PLAYER.baseSpeed * CARRY.speedMultiplier(s.upgrades.carry);
    const sp = movePlayer(p, move, speed, dt, this.colliders());
    if (sp > 0.6) {
      rt.footTimer -= dt * (sp / PLAYER.baseSpeed);
      if (rt.footTimer <= 0) {
        rt.footTimer = 0.27;
        this.events.push({ type: 'footstep', carrier: 'player' });
      }
    }

    const z = rt.zones;
    // HARVEST pad
    z.harvest = inPad(p.x, p.z, PADS.harvest);
    if (z.harvest) {
      if (rt.harvestPadArmed) {
        rt.harvestPadT += dt;
        if (rt.harvestPadT >= PLAYER.padDwell) {
          rt.harvestPadArmed = false;
          rt.harvestPadT = 0;
          this.events.push({ type: 'requestHarvest' });
        }
      }
    } else {
      rt.harvestPadArmed = true;
      rt.harvestPadT = 0;
    }

    // Depot pickup
    z.depot = inPad(p.x, p.z, PADS.depot);
    const cap = CARRY.capacity(s.upgrades.carry);
    if (z.depot) {
      rt.depotDwell += dt;
      if (rt.depotDwell >= PLAYER.pickupDwell) {
        rt.depotTimer -= dt;
        if (rt.depotTimer <= 0) {
          rt.depotTimer = PLAYER.pickupInterval;
          if (p.carry.length < cap && s.depot.bales.length > 0) {
            const idx = s.depot.bales.length - 1;
            const bale = takeTopBale(s.depot);
            if (bale) {
              p.carry.push(bale);
              this.events.push({ type: 'pickup', bale, carrier: 'player', depotIndex: idx });
            }
          } else if (p.carry.length >= cap && s.depot.bales.length > 0 && !rt.carryFullNotified) {
            rt.carryFullNotified = true;
            this.events.push({ type: 'carryFull', carrier: 'player' });
          }
        }
      }
    } else {
      rt.depotDwell = 0;
      rt.depotTimer = 0;
      rt.carryFullNotified = false;
    }

    // Deliver to truck
    z.deliver = inPad(p.x, p.z, PADS.deliver);
    if (z.deliver && p.carry.length > 0) {
      rt.deliverTimer -= dt;
      if (rt.deliverTimer <= 0) {
        rt.deliverTimer = PLAYER.deliverInterval;
        deliverOne(s, 'player', this.events);
      }
    } else if (!z.deliver) {
      rt.deliverTimer = 0.08;
    }

    // Cash pad
    z.cash = inPad(p.x, p.z, PADS.cash);
    if (z.cash && s.pendingCashCents > 0) collectCash(s, this.events);

    // Upgrade workshop pad
    z.upgrade = inPad(p.x, p.z, PADS.upgrade);
    if (z.upgrade) {
      if (rt.upgradePadArmed) {
        rt.upgradePadArmed = false;
        this.events.push({ type: 'openUpgrades' });
      }
    } else {
      rt.upgradePadArmed = true;
    }

    // Hire pad (only after the first sale, until hired)
    z.hauler = this.haulerPadActive() && inPad(p.x, p.z, PADS.hauler);
    if (z.hauler) {
      if (rt.hireArmed) {
        rt.hireT += dt;
        if (rt.hireT >= PLAYER.hirePadDwell) {
          rt.hireArmed = false;
          rt.hireT = 0;
          const r = buyHauler(s, this.events);
          if (!r.ok && r.need) this.events.push({ type: 'hireNeedMoney', need: r.need });
        }
      }
    } else {
      rt.hireArmed = true;
      rt.hireT = 0;
    }
  }

  haulerPadActive(): boolean {
    return this.state.stats.firstSaleDone && this.state.hauler.level === 0;
  }

  // ---- Player actions -------------------------------------------------------------

  switchTool(tool: ToolId): boolean {
    const h = this.state.harvester;
    if (this.rt.mode !== 'HARVEST') return false;
    if (h.tool === tool) return false;
    h.tool = tool;
    h.switchT = HARVESTER.toolSwitchTime;
    h.vacuumAcc = 0;
    this.events.push({ type: 'toolSwitchStart', to: tool });
    return true;
  }

  toggleTool(): boolean {
    return this.switchTool(this.state.harvester.tool === 'BLADE' ? 'VACUUM' : 'BLADE');
  }

  buyUpgrade(id: UpgradeId): PurchaseResult {
    return buyUpgrade(this.state, id, this.events);
  }

  buyHauler(): PurchaseResult {
    return buyHauler(this.state, this.events);
  }

  replantInfo(): { eligible: number; available: boolean; reason: string | null } {
    if (this.replanting) return { eligible: 0, available: false, reason: 'Replanting…' };
    const n = replantEligible(this.state.field).length;
    if (n === 0) {
      let loose = 0;
      const f = this.state.field;
      for (let i = 0; i < f.loose.length; i++) loose += f.loose[i];
      return { eligible: 0, available: false, reason: loose > 0 ? 'Collect cuttings first' : 'Field is fully grown' };
    }
    return { eligible: n, available: true, reason: null };
  }

  startReplant(): boolean {
    if (this.replanting) return false;
    const cells = replantEligible(this.state.field);
    if (cells.length === 0) {
      this.events.push({ type: 'replantUnavailable' });
      return false;
    }
    // Commit atomically; the ~1 s grow wave is presentation and blocks new harvest actions.
    const units = replantCells(this.state.field, cells);
    this.state.stats.unitsPlanted += units;
    this.state.stats.replants += 1;
    this.rt.replantT = REPLANT.duration;
    this.events.push({ type: 'replantStart', cells });
    return true;
  }

  canPackLeftovers(): boolean {
    return canPackLeftovers(this.state.depot);
  }

  packLeftovers(): boolean {
    const bales = packLeftovers(this.state);
    for (const b of bales) this.events.push({ type: 'balePacked', bale: b, mini: true });
    return bales.length > 0;
  }

  // ---- Debug helpers (flag the save as debug-assisted) ----------------------------

  debugAddMoney(coins: number): void {
    this.state.walletCents += coins * 100;
    this.state.stats.debugUsed = true;
  }

  debugCutAll(): void {
    const f = this.state.field;
    const cells: number[] = [];
    for (let i = 0; i < f.state.length; i++) {
      if (f.state[i] === CELL.GROWING) {
        f.state[i] = CELL.CUT;
        f.hp[i] = 0;
        f.loose[i] = TIERS[f.tier[i] as TierId].unitsPerCell;
        cells.push(i);
      }
    }
    this.state.stats.debugUsed = true;
    this.events.push({ type: 'cellsCut', cells, dirX: 0, dirZ: 1 });
  }

  debugSpawnBale(tier: TierId): void {
    const s = this.state;
    const bale = { id: s.nextBaleId++, tier, qty: 10 };
    s.depot.bales.push(bale);
    s.stats.unitsPlanted += 10;
    s.stats.debugUsed = true;
    this.events.push({ type: 'balePacked', bale, mini: false });
  }
}
