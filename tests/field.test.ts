import { describe, expect, it } from 'vitest';
import { BLADE, REACH, REACH_SHAPE, SIM_STEP, TIERS, VACUUM } from '../src/config/balance';
import { FIELD, HOSE_ANCHOR } from '../src/config/worldLayout';
import { createInitialState } from '../src/core/GameState';
import { applyBladeSweep, createCutOutput } from '../src/gameplay/CuttingSystem';
import { applyVacuum, createVacuumOutput } from '../src/gameplay/VacuumSystem';
import { moveHarvester } from '../src/gameplay/Harvester';
import { reachMetric } from '../src/gameplay/Reach';
import { CELL, cellCenterX, cellCenterZ, countField, createField, replantCells, replantEligible } from '../src/world/FieldModel';
import { conservedUnits, meadowCell } from './helpers';

describe('field layout', () => {
  it('has three tiers in the configured rows and a bare starting strip', () => {
    const f = createField(1);
    expect(f.state[meadowCell(10, 0)]).toBe(CELL.EMPTY);
    expect(f.state[meadowCell(10, 3)]).toBe(CELL.EMPTY);
    expect(f.tier[meadowCell(10, 4)]).toBe(0);
    expect(f.tier[meadowCell(10, 35)]).toBe(0);
    expect(f.tier[meadowCell(10, 36)]).toBe(1);
    expect(f.tier[meadowCell(10, 66)]).toBe(2);
    expect(f.tier[meadowCell(10, 95)]).toBe(2);
    expect(countField(f).growing).toBe(40 * 92);
  });

  it('max reach covers the farthest crop corner', () => {
    const maxReach = REACH.length(REACH.maxLevel);
    const corners = [
      [FIELD.x0 + FIELD.cell / 2, FIELD.z0 + FIELD.length - FIELD.cell / 2],
      [FIELD.x0 + FIELD.width - FIELD.cell / 2, FIELD.z0 + FIELD.length - FIELD.cell / 2],
    ];
    for (const [x, z] of corners) expect(reachMetric(x - HOSE_ANCHOR.x, z - HOSE_ANCHOR.z)).toBeLessThan(maxReach);
    expect(maxReach).toBeCloseTo(31.7, 5);
  });

  it('near rows are reachable across the whole field width at level 1', () => {
    const reach = REACH.length(1);
    for (const x of [FIELD.x0 + 0.3, FIELD.x0 + FIELD.width - 0.3])
      for (const z of [1.3, 2.5, 3.4]) expect(reachMetric(x - HOSE_ANCHOR.x, z - HOSE_ANCHOR.z)).toBeLessThan(reach);
    // Depth straight ahead is still the upgrade's length.
    expect(reachMetric(0, reach)).toBeCloseTo(reach, 6);
  });
});

describe('cutting', () => {
  it('cuts a cell once and never yields again before replant', () => {
    const s = createInitialState();
    const i = meadowCell();
    const x = cellCenterX(i);
    const z = cellCenterZ(i);
    const out = createCutOutput();
    for (let k = 0; k < 120; k++) applyBladeSweep(s.field, x, z, x, z, 0.5, 4, SIM_STEP, out);
    expect(s.field.state[i]).toBe(CELL.CUT);
    expect(s.field.loose[i]).toBe(1);
    const cutOnce = out.cut.filter((c) => c === i).length;
    expect(cutOnce).toBe(1);
    // Keep sweeping the bare cell: no new loose units appear.
    for (let k = 0; k < 120; k++) applyBladeSweep(s.field, x, z, x, z, 0.5, 4, SIM_STEP, out);
    expect(s.field.loose[i]).toBe(1);
    expect(out.cut.filter((c) => c === i).length).toBe(1);
  });

  it('needs real contact time: Meadow HP / 4 DPS', () => {
    const s = createInitialState();
    const i = meadowCell();
    const x = cellCenterX(i);
    const z = cellCenterZ(i);
    const out = createCutOutput();
    const steps = Math.ceil(TIERS[0].hp / 4 / SIM_STEP);
    for (let k = 0; k < steps - 2; k++) applyBladeSweep(s.field, x, z, x, z, 0.5, 4, SIM_STEP, out);
    expect(s.field.state[i]).toBe(CELL.GROWING);
    for (let k = 0; k < 3; k++) applyBladeSweep(s.field, x, z, x, z, 0.5, 4, SIM_STEP, out);
    expect(s.field.state[i]).toBe(CELL.CUT);
  });

  it('yield does not depend on frame rate (swept substeps)', () => {
    const yieldAt = (dt: number) => {
      const s = createInitialState();
      const out = createCutOutput();
      let x = -4;
      const z = 3;
      // Roughly the head speed under cutting drag at Blade level 1.
      const speed = 2.0;
      for (let t = 0; t < 2.4; t += dt) {
        const nx = x + speed * dt;
        applyBladeSweep(s.field, x, z, nx, z, BLADE.radius(1), BLADE.dps(1), dt, out);
        x = nx;
      }
      return out.cut.length;
    };
    const a = yieldAt(1 / 30);
    const b = yieldAt(1 / 60);
    const c = yieldAt(1 / 144);
    expect(a).toBeGreaterThan(0);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(3, b * 0.1));
    expect(Math.abs(c - b)).toBeLessThanOrEqual(Math.max(3, b * 0.1));
    // A 30 FPS frame must not produce more yield than 144 FPS.
    expect(a).toBeLessThanOrEqual(c + 3);
  });

  it('a very fast sweep does not skip cells between frames', () => {
    const s = createInitialState();
    const out = createCutOutput();
    // Teleport-sized move in one step with enough DPS: every cell on the path is contacted.
    applyBladeSweep(s.field, -5, 3, 5, 3, 0.5, 3000, SIM_STEP, out);
    const row = Math.floor(3 / FIELD.cell);
    for (let col = 4; col < 36; col++) expect(s.field.state[row * FIELD.cols + col]).toBe(CELL.CUT);
  });
});

describe('vacuum', () => {
  it('never takes standing crop', () => {
    const s = createInitialState();
    const out = createVacuumOutput();
    const before = conservedUnits(s);
    for (let k = 0; k < 120; k++) applyVacuum(s, 0, 3, VACUUM.radius(1), VACUUM.intake(1), SIM_STEP, out);
    expect(out.cells.length).toBe(0);
    expect(conservedUnits(s)).toEqual(before);
  });

  it('moves each loose unit to the depot exactly once and packs bales of ten', () => {
    const s = createInitialState();
    const cut = createCutOutput();
    for (let k = 0; k < 60; k++) applyBladeSweep(s.field, 0, 3, 0, 3, 1.0, 20, SIM_STEP, cut);
    const cutUnits = cut.cut.length;
    expect(cutUnits).toBeGreaterThan(20);
    const total0 = conservedUnits(s).total;
    const out = createVacuumOutput();
    for (let k = 0; k < 600; k++) applyVacuum(s, 0, 3, 1.4, VACUUM.intake(1), SIM_STEP, out);
    const c = conservedUnits(s);
    expect(c.loose).toBe(0);
    expect(c.raw + c.depot).toBe(cutUnits);
    expect(c.total).toBe(total0);
    expect(s.depot.bales.every((b) => b.qty === 10)).toBe(true);
    expect(s.depot.raw[0]).toBe(cutUnits % 10);
    for (const i of cut.cut) expect(s.field.state[i]).toBe(CELL.COLLECTED);
  });

  it('intake rate follows the accumulator (16 units/s at level 1)', () => {
    const s = createInitialState();
    const cut = createCutOutput();
    for (let k = 0; k < 60; k++) applyBladeSweep(s.field, 0, 4, 0, 4, 1.6, 50, SIM_STEP, cut);
    const out = createVacuumOutput();
    for (let k = 0; k < 60; k++) applyVacuum(s, 0, 4, 1.6, 16, SIM_STEP, out);
    expect(out.cells.length).toBe(16);
  });

  it('never blocks on storage: a big depot keeps accepting cuttings', () => {
    const s = createInitialState();
    s.depot.bales = Array.from({ length: 400 }, (_, k) => ({ id: 1000 + k, tier: 0 as const, qty: 10 }));
    const cut = createCutOutput();
    for (let k = 0; k < 60; k++) applyBladeSweep(s.field, 0, 3, 0, 3, 1.0, 20, SIM_STEP, cut);
    const out = createVacuumOutput();
    for (let k = 0; k < 300; k++) applyVacuum(s, 0, 3, 1.4, 16, SIM_STEP, out);
    expect(out.cells.length).toBe(cut.cut.length);
    expect(conservedUnits(s).loose).toBe(0);
  });
});

describe('harvester reach', () => {
  it('has an elastic limit: gives a little under push, springs back on release, slides tangentially', () => {
    const s = createInitialState();
    const h = s.harvester;
    const reach = REACH.length(1);
    const D = () => reachMetric(h.x - HOSE_ANCHOR.x, h.z - HOSE_ANCHOR.z);
    let maxD = 0;
    for (let k = 0; k < 300; k++) {
      moveHarvester(h, { x: 0, z: 1 }, SIM_STEP, reach);
      maxD = Math.max(maxD, D());
    }
    // Held against the limit: slightly past it, never beyond the elastic maximum.
    expect(D()).toBeGreaterThan(reach + 0.05);
    expect(maxD).toBeLessThanOrEqual(reach + REACH_SHAPE.stretchMax + 1e-6);
    // Released: springs back to the limit within ~0.3 s.
    for (let k = 0; k < 18; k++) moveHarvester(h, { x: 0, z: 0 }, SIM_STEP, reach);
    expect(D()).toBeLessThan(reach + 0.02);
    // Tangential slide along the boundary still works.
    const x0 = h.x;
    for (let k = 0; k < 30; k++) moveHarvester(h, { x: 0.7, z: 0.7 }, SIM_STEP, reach);
    expect(h.x).toBeGreaterThan(x0 + 0.3);
    expect(D()).toBeLessThanOrEqual(reach + REACH_SHAPE.stretchMax + 1e-6);
  });

  it('accelerates within ~100 ms and stops within ~100 ms', () => {
    const s = createInitialState();
    const h = s.harvester;
    for (let k = 0; k < 6; k++) moveHarvester(h, { x: 1, z: 0 }, SIM_STEP, 30);
    expect(Math.hypot(h.vx, h.vz)).toBeGreaterThan(3.4 * 0.9);
    for (let k = 0; k < 6; k++) moveHarvester(h, { x: 0, z: 0 }, SIM_STEP, 30);
    expect(Math.hypot(h.vx, h.vz)).toBeLessThan(0.05);
  });
});

describe('replant', () => {
  it('only regrows fully collected cells and keeps loose cuttings', () => {
    const s = createInitialState();
    const cut = createCutOutput();
    for (let k = 0; k < 60; k++) applyBladeSweep(s.field, 0, 3, 0, 3, 1.0, 20, SIM_STEP, cut);
    // Collect only part of the cuttings.
    const out = createVacuumOutput();
    for (let k = 0; k < 20; k++) applyVacuum(s, 0, 3, 1.4, 16, SIM_STEP, out);
    const collected = new Set(out.cells);
    const eligible = replantEligible(s.field);
    expect(eligible.length).toBe(collected.size);
    const looseBefore = conservedUnits(s).loose;
    const depotBefore = conservedUnits(s).raw + conservedUnits(s).depot;
    const added = replantCells(s.field, eligible);
    expect(added).toBe(collected.size);
    const after = conservedUnits(s);
    expect(after.loose).toBe(looseBefore);
    expect(after.raw + after.depot).toBe(depotBefore);
    for (const i of eligible) {
      expect(s.field.state[i]).toBe(CELL.GROWING);
      expect(s.field.generation[i]).toBe(1);
    }
    // Replanting again right away does nothing.
    expect(replantCells(s.field, replantEligible(s.field))).toBe(0);
  });
});
