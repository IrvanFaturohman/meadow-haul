// Headless "bot playtest": a scripted, reasonably efficient player drives the real
// Simulation to estimate pacing with the final balance config. It is an approximation of
// an attentive player, not a substitute for human playtests (see QA_NOTES.md).

import { describe, expect, it } from 'vitest';
import { BLADE, CARRY, REACH, SIM_STEP, VACUUM, upgradeCost, type UpgradeId } from '../src/config/balance';
import { FIELD, HOSE_ANCHOR, PADS, type Pad } from '../src/config/worldLayout';
import { createInitialState } from '../src/core/GameState';
import { Simulation } from '../src/core/Simulation';
import { CELL, cellCenterX, cellCenterZ } from '../src/world/FieldModel';
import { conservedUnits } from './helpers';
import { reachHalfWidth, reachMetric } from '../src/gameplay/Reach';

interface Timeline {
  [k: string]: number;
}

class Bot {
  sim: Simulation;
  t = 0;
  timeline: Timeline = {};
  log: string[] = [];
  order: (UpgradeId | 'hauler')[];
  constructor(order: (UpgradeId | 'hauler')[]) {
    this.sim = new Simulation(createInitialState(7));
    this.order = order;
  }
  get s() {
    return this.sim.state;
  }
  mark(k: string) {
    if (this.timeline[k] === undefined) this.timeline[k] = Math.round(this.t);
  }
  step(move = { x: 0, z: 0 }) {
    this.sim.step(SIM_STEP, move);
    this.t += SIM_STEP;
    const ev = this.sim.events.drain();
    for (const e of ev) {
      if (e.type === 'cellsCut') this.mark('firstCut');
      if (e.type === 'balePacked') this.mark('firstBale');
      if (e.type === 'deliver') this.mark('firstSale');
      if (e.type === 'cashCollected') this.mark('firstCash');
      if (e.type === 'upgradeBought') {
        this.mark('firstUpgrade');
        this.mark(`${e.id}${e.level}`);
      }
      if (e.type === 'haulerBought') this.mark(`hauler${e.level}`);
      if (e.type === 'replantStart') this.mark('firstReplant');
      if (e.type === 'levelUp') this.mark(`level${e.level}`);
    }
    if (this.s.stats.cutByTier[1] > 0) this.mark('clover');
    if (this.s.stats.cutByTier[2] > 0) this.mark('golden');
  }
  wait(sec: number) {
    for (let i = 0; i < sec / SIM_STEP; i++) this.step();
  }
  driveTool(tx: number, tz: number, speed: number, maxSec = 12) {
    const h = this.s.harvester;
    for (let k = 0; k < maxSec / SIM_STEP; k++) {
      const dx = tx - h.x;
      const dz = tz - h.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) return;
      const m = Math.min(1, d / 0.3) * speed;
      this.step({ x: (dx / d) * m, z: (dz / d) * m });
      // Stuck against the reach limit: give up on this waypoint.
      if (this.sim.rt.atReachLimit && d < 1.5 && Math.hypot(h.vx, h.vz) < 0.2) return;
    }
  }
  walkTo(p: Pad, maxSec = 10) {
    const pl = this.s.player;
    for (let k = 0; k < maxSec / SIM_STEP; k++) {
      const dx = p.x - pl.x;
      const dz = p.z - pl.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) break;
      const m = Math.min(1, d / 0.4);
      this.step({ x: (dx / d) * m, z: (dz / d) * m });
    }
  }
  /** Rows the tool can sweep at the current reach, far rows first (higher value). */
  rows(spacing: number): { z: number; x0: number; x1: number }[] {
    const reach = REACH.length(this.s.upgrades.reach) - 0.1;
    const out: { z: number; x0: number; x1: number }[] = [];
    const zMax = Math.min(FIELD.length - 0.3, HOSE_ANCHOR.z + reach);
    for (let z = zMax; z >= 1.3; z -= spacing) {
      const hw = reachHalfWidth(z - HOSE_ANCHOR.z, reach);
      const x0 = Math.max(-5.6, -hw);
      const x1 = Math.min(5.6, hw);
      if (x1 - x0 > 0.6) out.push({ z, x0, x1 });
    }
    return out;
  }
  standingInReach(): number {
    const reach = REACH.length(this.s.upgrades.reach);
    let n = 0;
    const f = this.s.field;
    for (let i = 0; i < f.state.length; i++) {
      if (f.state[i] !== CELL.GROWING) continue;
      if (reachMetric(cellCenterX(i) - HOSE_ANCHOR.x, cellCenterZ(i) - HOSE_ANCHOR.z) <= reach) n++;
    }
    return n;
  }
  looseTotal(): number {
    let n = 0;
    for (let i = 0; i < this.s.field.loose.length; i++) n += this.s.field.loose[i];
    return n;
  }
  harvestTrip() {
    const s = this.s;
    this.sim.setMode('HARVEST');
    // Blade until there is roughly two carry-loads worth of cuttings on the ground.
    const free = Math.max(120, 20 * CARRY.capacity(s.upgrades.carry));
    this.sim.switchTool('BLADE');
    this.wait(0.2);
    const bladeR = BLADE.radius(s.upgrades.blade);
    const rows = this.rows(bladeR * 1.3);
    let dir = 1;
    for (const r of rows) {
      if (this.looseTotal() >= free) break;
      const a = dir > 0 ? r.x0 : r.x1;
      const b = dir > 0 ? r.x1 : r.x0;
      this.driveTool(a, r.z, 1);
      this.driveTool(b, r.z, 0.55);
      dir = -dir;
    }
    // Vacuum the cuttings.
    this.sim.switchTool('VACUUM');
    this.wait(0.2);
    const vr = VACUUM.radius(s.upgrades.vacuum);
    for (const r of this.rows(vr * 1.5)) {
      if (this.looseTotal() === 0) break;
      if (!this.rowHasLoose(r.z, vr)) continue;
      const a = dir > 0 ? r.x0 : r.x1;
      const b = dir > 0 ? r.x1 : r.x0;
      this.driveTool(a, r.z, 1);
      this.driveTool(b, r.z, 0.8);
      dir = -dir;
    }
    this.sim.setMode('TRANSITION');
    this.wait(0.46);
    this.sim.setMode('FARM');
  }
  rowHasLoose(z: number, r: number): boolean {
    const f = this.s.field;
    for (let i = 0; i < f.loose.length; i++) if (f.loose[i] > 0 && Math.abs(cellCenterZ(i) - z) <= r) return true;
    return false;
  }
  haulAll() {
    const s = this.s;
    let guard = 0;
    while ((s.depot.bales.length > 0 || s.player.carry.length > 0) && guard++ < 40) {
      if (s.player.carry.length < CARRY.capacity(s.upgrades.carry) && s.depot.bales.length > 0) {
        this.walkTo(PADS.depot);
        this.wait(0.2 + 0.18 * CARRY.capacity(s.upgrades.carry));
      }
      this.walkTo(PADS.deliver);
      for (let k = 0; k < 20 && s.player.carry.length > 0; k++) this.wait(0.5);
      this.walkTo(PADS.cash);
      // With a hauler, stop hauling manually and go back to harvesting.
      if (s.hauler.level > 0) break;
    }
    this.walkTo(PADS.cash);
  }
  /** Buys along a fixed plan, saving up for the next item; then buys the cheapest thing. */
  shop() {
    const s = this.s;
    for (;;) {
      const next = this.order[0];
      if (next === undefined) break;
      const ok = next === 'hauler' ? s.stats.firstSaleDone && this.sim.buyHauler().ok : this.sim.buyUpgrade(next).ok;
      const maxed = next === 'hauler' ? s.hauler.level >= 3 : upgradeCost(next, s.upgrades[next]) === null;
      if (ok || maxed) this.order.shift();
      else return;
    }
    for (;;) {
      const options: { k: UpgradeId | 'hauler'; c: number }[] = [];
      for (const k of ['blade', 'vacuum', 'reach', 'carry'] as UpgradeId[]) {
        const c = upgradeCost(k, s.upgrades[k]);
        if (c !== null) options.push({ k, c });
      }
      if (s.hauler.level < 3) options.push({ k: 'hauler', c: [220, 180, 300][s.hauler.level] });
      options.sort((a, b) => a.c - b.c);
      const o = options[0];
      if (!o || s.walletCents < o.c * 100) return;
      if (o.k === 'hauler') this.sim.buyHauler();
      else this.sim.buyUpgrade(o.k);
    }
  }
  run(maxMinutes: number) {
    this.sim.setMode('FARM');
    while (this.t < maxMinutes * 60) {
      if (this.standingInReach() < 60 && this.looseTotal() === 0) this.sim.startReplant();
      this.walkTo(PADS.harvest);
      this.harvestTrip();
      this.haulAll();
      this.shop();
      this.log.push(
        `${Math.round(this.t)}s wallet=${(this.s.walletCents / 100).toFixed(0)} sold=${this.s.stats.balesSold} up=B${this.s.upgrades.blade}V${this.s.upgrades.vacuum}R${this.s.upgrades.reach}C${this.s.upgrades.carry}H${this.s.hauler.level}`,
      );
    }
  }
}

// Purchase plans: the bot saves for each item in order, then buys whatever is cheapest.
const UPGRADES_FIRST: (UpgradeId | 'hauler')[] = ['blade', 'reach', 'blade', 'vacuum', 'reach', 'blade', 'reach', 'carry', 'hauler'];
const HAULER_EARLY: (UpgradeId | 'hauler')[] = ['blade', 'reach', 'hauler', 'blade', 'reach', 'vacuum'];

describe('pacing bot (estimate, not a human playtest)', () => {
  for (const [name, order] of [
    ['upgrades-first', UPGRADES_FIRST],
    ['hauler-early', HAULER_EARLY],
  ] as const) {
    it(`${name}: reaches the early milestones and keeps resources conserved`, () => {
      const bot = new Bot([...order]);
      bot.run(15);
      const tl = bot.timeline;
      console.log(`PACING[${name}] timeline (s):`, JSON.stringify(tl));
      console.log(`PACING[${name}] log:\n` + bot.log.join('\n'));
      expect(tl.firstCut).toBeLessThanOrEqual(5);
      expect(tl.firstSale).toBeLessThan(120);
      expect(tl.firstUpgrade).toBeDefined();
      expect(tl.hauler1).toBeDefined();
      expect(conservedUnits(bot.s).total).toBe(bot.s.stats.unitsPlanted);
      expect(bot.s.walletCents).toBeGreaterThanOrEqual(0);
    });
  }
});
