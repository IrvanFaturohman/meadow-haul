// Blade cutting with swept substeps. Each substep applies the damage for the fraction of
// the frame it represents, so a fast sweep never skips cells and never multiplies damage.

import { HARVESTER, TIERS, type TierId } from '../config/balance';
import { CELL, forEachCellInRadius, type FieldState } from '../world/FieldModel';

export interface CutOutput {
  /** Cells that changed state GROWING → CUT during this sweep. */
  cut: number[];
  /** Cells that took damage but still stand (for bend/progress visuals). */
  damaged: number[];
  /** Number of standing cells touched (drives motor load / audio). */
  contacts: number;
}

export function createCutOutput(): CutOutput {
  return { cut: [], damaged: [], contacts: 0 };
}

export function applyBladeSweep(
  field: FieldState,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius: number,
  dps: number,
  dt: number,
  out: CutOutput,
): void {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(dist / HARVESTER.sweepStep));
  const dmg = (dps * dt) / n;
  const touched = new Set<number>();
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    forEachCellInRadius(x, z, radius, (i) => {
      if (field.state[i] !== CELL.GROWING) return;
      touched.add(i);
      field.hp[i] -= dmg;
      if (field.hp[i] <= 1e-6) {
        // Exactly one state change and one batch of loose material per cell.
        field.hp[i] = 0;
        field.state[i] = CELL.CUT;
        field.loose[i] = TIERS[field.tier[i] as TierId].unitsPerCell;
        out.cut.push(i);
      }
    });
  }
  out.contacts += touched.size;
  for (const i of touched) if (field.state[i] === CELL.GROWING) out.damaged.push(i);
}
