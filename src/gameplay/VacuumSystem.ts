// Vacuum intake: moves loose units from the field into the depot buffer exactly once.
// A deterministic accumulator turns units/second into whole-unit transfers.

import type { TierId } from '../config/balance';
import type { Bale, GameState } from '../core/GameState';
import { CELL, forEachCellInRadius } from '../world/FieldModel';
import { addRawUnits } from './Inventory';

export interface VacuumOutput {
  cells: number[];
  tiers: TierId[];
  bales: Bale[];
  /** Loose units inside the radius before intake (for UI/audio density). */
  available: number;
}

export function createVacuumOutput(): VacuumOutput {
  return { cells: [], tiers: [], bales: [], available: 0 };
}

const candidates: { i: number; d2: number }[] = [];

export function applyVacuum(state: GameState, x: number, z: number, radius: number, intakePerSec: number, dt: number, out: VacuumOutput): void {
  const h = state.harvester;
  const field = state.field;
  candidates.length = 0;
  let available = 0;
  forEachCellInRadius(x, z, radius, (i, d2) => {
    if (field.loose[i] > 0) {
      candidates.push({ i, d2 });
      available += field.loose[i];
    }
  });
  out.available += available;

  h.vacuumAcc += intakePerSec * dt;
  if (available === 0) {
    // Don't bank suction while there is nothing to pick up.
    h.vacuumAcc = Math.min(h.vacuumAcc, 1);
    return;
  }
  const want = Math.floor(h.vacuumAcc);
  if (want <= 0) return;

  candidates.sort((a, b) => a.d2 - b.d2);
  let taken = 0;
  for (const c of candidates) {
    if (taken >= want) break;
    while (field.loose[c.i] > 0 && taken < want) {
      field.loose[c.i] -= 1;
      taken += 1;
      const tier = field.tier[c.i] as TierId;
      out.cells.push(c.i);
      out.tiers.push(tier);
      state.stats.unitsCollected += 1;
      const made = addRawUnits(state, tier, 1);
      for (const b of made) out.bales.push(b);
    }
    if (field.loose[c.i] === 0) field.state[c.i] = CELL.COLLECTED;
  }
  h.vacuumAcc -= taken;
  if (taken < want) h.vacuumAcc = Math.min(h.vacuumAcc, 1);
}
