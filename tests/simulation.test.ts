import { describe, expect, it } from 'vitest';
import { BLADE, CARRY, SIM_STEP } from '../src/config/balance';
import { PADS, type Pad } from '../src/config/worldLayout';
import { createInitialState } from '../src/core/GameState';
import { Simulation } from '../src/core/Simulation';
import { deserialize, serialize } from '../src/core/SaveSystem';
import { conservedUnits } from './helpers';

function run(sim: Simulation, seconds: number, move = { x: 0, z: 0 }) {
  const n = Math.round(seconds / SIM_STEP);
  for (let i = 0; i < n; i++) sim.step(SIM_STEP, move);
}

function driveTool(sim: Simulation, tx: number, tz: number, maxSeconds = 10, speedScale = 1) {
  const h = sim.state.harvester;
  for (let t = 0; t < maxSeconds; t += SIM_STEP) {
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const m = Math.min(1, d / 0.3) * speedScale;
    sim.step(SIM_STEP, { x: (dx / d) * m, z: (dz / d) * m });
  }
}

function walkTo(sim: Simulation, pad: Pad, maxSeconds = 10) {
  const p = sim.state.player;
  for (let t = 0; t < maxSeconds; t += SIM_STEP) {
    const dx = pad.x - p.x;
    const dz = pad.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) break;
    const m = Math.min(1, d / 0.4);
    sim.step(SIM_STEP, { x: (dx / d) * m, z: (dz / d) * m });
  }
  run(sim, 0.1);
}

function mowAndVacuum(sim: Simulation) {
  sim.setMode('HARVEST');
  // Mow a few slow passes across the first meadow rows.
  const rows = [1.5, 2.1, 2.7, 3.3];
  for (const z of rows) {
    driveTool(sim, -4.5, z, 10, 0.45);
    driveTool(sim, 4.5, z, 10, 0.45);
  }
  sim.switchTool('VACUUM');
  run(sim, 0.3);
  for (const z of rows) {
    driveTool(sim, -4.5, z, 10, 0.6);
    driveTool(sim, 4.5, z, 10, 0.6);
  }
}

describe('full loop from a fresh save (no debug)', () => {
  it('cut → vacuum → pickup → deliver → cash → upgrade', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    const planted = s.stats.unitsPlanted;

    mowAndVacuum(sim);
    expect(s.stats.unitsCut).toBeGreaterThan(60);
    expect(s.depot.bales.length).toBeGreaterThanOrEqual(6);
    expect(conservedUnits(s).total).toBe(planted);

    sim.setMode('FARM');
    const available = s.depot.bales.length;
    walkTo(sim, PADS.depot);
    run(sim, 2.5);
    const carried = Math.min(CARRY.capacity(1), available);
    expect(s.player.carry.length).toBe(carried);

    walkTo(sim, PADS.deliver);
    run(sim, 4);
    expect(s.player.carry.length).toBe(0);
    expect(s.pendingCashCents).toBe(carried * 8_00);
    expect(conservedUnits(s).total).toBe(planted);

    walkTo(sim, PADS.cash);
    expect(s.walletCents).toBe(carried * 8_00);
    expect(s.pendingCashCents).toBe(0);

    const r = sim.buyUpgrade('blade');
    expect(r.ok).toBe(true);
    expect(s.upgrades.blade).toBe(2);
    expect(s.walletCents).toBe(carried * 8_00 - 35_00);
    expect(s.stats.debugUsed).toBe(false);
  });
});

describe('hauler', () => {
  it('hauls stock from the depot to the truck and sales land on the cash pad', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    s.hauler.level = 1;
    for (let i = 0; i < 9; i++) s.depot.bales.push({ id: 100 + i, tier: 0, qty: 10 });
    s.stats.unitsPlanted += 90;
    sim.setMode('FARM');
    run(sim, 40);
    expect(s.depot.bales.length).toBe(0);
    expect(s.stats.balesSold).toBe(9);
    expect(s.pendingCashCents).toBe(72_00);
    expect(conservedUnits(s).total).toBe(s.stats.unitsPlanted);
  });

  it('keeps hauling while the player is in harvest mode', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    s.hauler.level = 1;
    for (let i = 0; i < 3; i++) s.depot.bales.push({ id: 100 + i, tier: 1, qty: 10 });
    sim.setMode('HARVEST');
    run(sim, 20);
    expect(s.stats.balesSold).toBe(3);
  });
});

describe('save / load', () => {
  it('round-trips progress without selling twice', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    mowAndVacuum(sim);
    sim.setMode('FARM');
    walkTo(sim, PADS.depot);
    run(sim, 2);
    walkTo(sim, PADS.deliver);
    run(sim, 0.5); // partially delivered
    const pending = s.pendingCashCents;
    const sold = s.stats.unitsSold;
    expect(sold).toBeGreaterThan(0);

    const loaded = deserialize(serialize(s));
    expect(loaded.pendingCashCents).toBe(pending);
    expect(loaded.stats.unitsSold).toBe(sold);
    expect(loaded.player.carry.length).toBe(s.player.carry.length);
    expect(loaded.depot.bales.length).toBe(s.depot.bales.length);
    expect(Array.from(loaded.field.loose)).toEqual(Array.from(s.field.loose));
    expect(Array.from(loaded.field.state)).toEqual(Array.from(s.field.state));
    expect(conservedUnits(loaded).total).toBe(conservedUnits(s).total);
    // The truck's cargo was already paid; loading never re-credits it.
    const sim2 = new Simulation(loaded);
    sim2.setMode('FARM');
    run(sim2, 5);
    expect(loaded.pendingCashCents).toBeGreaterThanOrEqual(pending);
    expect(loaded.stats.unitsSold - sold).toBe((conservedUnits(s).carry - conservedUnits(loaded).carry));
  });

  it('rejects corrupt saves instead of crashing', () => {
    expect(() => deserialize('{nope')).toThrow();
    expect(() => deserialize(JSON.stringify({ schemaVersion: 99 }))).toThrow();
    const s = createInitialState();
    const obj = JSON.parse(serialize(s));
    obj.field.state = 'AAAA';
    expect(() => deserialize(JSON.stringify(obj))).toThrow();
  });

  it('clamps out-of-range values on load', () => {
    const s = createInitialState();
    const obj = JSON.parse(serialize(s));
    obj.walletCents = -500;
    obj.upgrades.reach = 99;
    obj.harvester.z = 999;
    const loaded = deserialize(JSON.stringify(obj));
    expect(loaded.walletCents).toBe(0);
    expect(loaded.upgrades.reach).toBe(10);
    expect(loaded.harvester.z).toBeLessThanOrEqual(28.8);
  });
});

describe('replant through the simulation', () => {
  it('replant keeps money, inventory and loose cuttings unchanged', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    mowAndVacuum(sim);
    s.walletCents = 12_34;
    const before = conservedUnits(s);
    const ok = sim.startReplant();
    expect(ok).toBe(true);
    const after = conservedUnits(s);
    expect(after.loose).toBe(before.loose);
    expect(after.raw).toBe(before.raw);
    expect(after.depot).toBe(before.depot);
    expect(s.walletCents).toBe(12_34);
    expect(after.standing).toBeGreaterThan(before.standing);
    expect(after.total).toBe(s.stats.unitsPlanted);
    // Harvest actions are blocked during the ~1 s replant.
    const cutBefore = s.stats.unitsCut;
    sim.setMode('HARVEST');
    s.harvester.tool = 'BLADE';
    driveTool(sim, 0, 3, 0.5, 0.4);
    expect(s.stats.unitsCut).toBe(cutBefore);
  });
});

describe('pads after load / mode change', () => {
  it('does not re-open the workshop when continuing a save that stands on the pad', () => {
    const s = createInitialState();
    s.player.x = PADS.upgrade.x;
    s.player.z = PADS.upgrade.z;
    const sim = new Simulation(deserialize(serialize(s)));
    sim.setMode('FARM');
    run(sim, 0.5);
    const ev = sim.events.drain();
    expect(ev.some((e) => e.type === 'openUpgrades')).toBe(false);
    // Stepping off and back on opens it.
    walkTo(sim, PADS.harvest, 3);
    sim.events.drain();
    walkTo(sim, PADS.upgrade, 4);
    expect(sim.events.drain().some((e) => e.type === 'openUpgrades')).toBe(true);
  });

  it('movement input is ignored during transitions', () => {
    const s = createInitialState();
    const sim = new Simulation(s);
    sim.setMode('TRANSITION');
    const p0 = { x: s.player.x, z: s.player.z, tx: s.harvester.x, tz: s.harvester.z };
    run(sim, 0.5, { x: 1, z: 1 });
    expect(s.player.x).toBe(p0.x);
    expect(s.harvester.z).toBe(p0.tz);
  });
});

describe('cutting drag', () => {
  const speedThrough = (bladeLevel: number, z: number, clearFirst = false) => {
    const s = createInitialState();
    s.upgrades.blade = bladeLevel;
    const sim = new Simulation(s);
    sim.setMode('HARVEST');
    s.harvester.x = -4;
    s.harvester.z = z;
    if (clearFirst) for (let i = 0; i < s.field.state.length; i++) if (s.field.state[i] === 1) s.field.state[i] = 3;
    run(sim, 0.6, { x: 1, z: 0 });
    return sim.rt.cutSpeedMul;
  };

  it('slows the head in standing crop, not on bare ground, and stays grass-light', () => {
    const bare = speedThrough(1, 3, true);
    const meadowL1 = speedThrough(1, 3);
    expect(bare).toBeCloseTo(1, 3);
    expect(meadowL1).toBeLessThan(0.8);
    expect(meadowL1).toBeGreaterThanOrEqual(1 - BLADE.maxDrag);
  });

  it('Blade Power reduces the drag', () => {
    expect(speedThrough(6, 3)).toBeGreaterThan(speedThrough(1, 3) + 0.08);
  });
});
