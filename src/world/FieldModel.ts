// Logical crop field: one cell = one unit of crop. Pure data + functions (no rendering).

import { TIERS, type TierId } from '../config/balance';
import { FIELD } from '../config/worldLayout';
import { reachMetric } from '../gameplay/Reach';

export const CELL = {
  /** Bare soil that never grows anything (the starting strip). */
  EMPTY: 0,
  GROWING: 1,
  /** Cut down; loose cuttings still lie on the ground. */
  CUT: 2,
  /** All cuttings collected; stubble and soil remain. */
  COLLECTED: 3,
} as const;

export type CellStateId = (typeof CELL)[keyof typeof CELL];

export interface FieldState {
  cols: number;
  rows: number;
  /** −1 for empty cells, otherwise TierId. */
  tier: Int8Array;
  state: Uint8Array;
  hp: Float32Array;
  loose: Uint8Array;
  generation: Uint16Array;
}

export function tierForRow(row: number): TierId | -1 {
  for (let t = 0; t < FIELD.tierRows.length; t++) {
    const [a, b] = FIELD.tierRows[t];
    if (row >= a && row <= b) return t as TierId;
  }
  return -1;
}

export function createField(_seed: number): FieldState {
  const n = FIELD.cols * FIELD.rows;
  const f: FieldState = {
    cols: FIELD.cols,
    rows: FIELD.rows,
    tier: new Int8Array(n),
    state: new Uint8Array(n),
    hp: new Float32Array(n),
    loose: new Uint8Array(n),
    generation: new Uint16Array(n),
  };
  for (let row = 0; row < FIELD.rows; row++) {
    const tier = tierForRow(row);
    for (let col = 0; col < FIELD.cols; col++) {
      const i = row * FIELD.cols + col;
      f.tier[i] = tier;
      if (tier < 0) {
        f.state[i] = CELL.EMPTY;
        f.hp[i] = 0;
      } else {
        f.state[i] = CELL.GROWING;
        f.hp[i] = TIERS[tier].hp;
      }
    }
  }
  return f;
}

export function cellIndex(col: number, row: number): number {
  return row * FIELD.cols + col;
}

export function cellCol(i: number): number {
  return i % FIELD.cols;
}

export function cellRow(i: number): number {
  return (i / FIELD.cols) | 0;
}

export function cellCenterX(i: number): number {
  return FIELD.x0 + (cellCol(i) + 0.5) * FIELD.cell;
}

export function cellCenterZ(i: number): number {
  return FIELD.z0 + (cellRow(i) + 0.5) * FIELD.cell;
}

/**
 * Spatial query over the field grid: visits every cell whose centre lies within `r` of (x, z).
 * Only the bounding rows/cols are scanned, never the whole field.
 */
export function forEachCellInRadius(x: number, z: number, r: number, fn: (i: number, d2: number) => void): void {
  const c = FIELD.cell;
  const c0 = Math.max(0, Math.floor((x - r - FIELD.x0) / c));
  const c1 = Math.min(FIELD.cols - 1, Math.floor((x + r - FIELD.x0) / c));
  const r0 = Math.max(0, Math.floor((z - r - FIELD.z0) / c));
  const r1 = Math.min(FIELD.rows - 1, Math.floor((z + r - FIELD.z0) / c));
  const rr = r * r;
  for (let row = r0; row <= r1; row++) {
    const cz = FIELD.z0 + (row + 0.5) * c;
    const dz = cz - z;
    const dz2 = dz * dz;
    if (dz2 > rr) continue;
    for (let col = c0; col <= c1; col++) {
      const cx = FIELD.x0 + (col + 0.5) * c;
      const dx = cx - x;
      const d2 = dx * dx + dz2;
      if (d2 <= rr) fn(row * FIELD.cols + col, d2);
    }
  }
}

export interface FieldCounts {
  growing: number;
  cut: number;
  collected: number;
  looseUnits: number;
  standingUnits: number;
}

export function countField(f: FieldState): FieldCounts {
  const out: FieldCounts = { growing: 0, cut: 0, collected: 0, looseUnits: 0, standingUnits: 0 };
  for (let i = 0; i < f.state.length; i++) {
    const s = f.state[i];
    if (s === CELL.GROWING) {
      out.growing++;
      out.standingUnits += TIERS[f.tier[i] as TierId].unitsPerCell;
    } else if (s === CELL.CUT) out.cut++;
    else if (s === CELL.COLLECTED) out.collected++;
    out.looseUnits += f.loose[i];
  }
  return out;
}

/** Cells that may be replanted: fully collected crop cells only. */
export function replantEligible(f: FieldState): number[] {
  const out: number[] = [];
  for (let i = 0; i < f.state.length; i++) {
    if (f.state[i] === CELL.COLLECTED && f.tier[i] >= 0 && f.loose[i] === 0) out.push(i);
  }
  return out;
}

/** Regrows the given cells (must be eligible). Returns units added to the world. */
export function replantCells(f: FieldState, cells: readonly number[]): number {
  let units = 0;
  for (const i of cells) {
    if (f.state[i] !== CELL.COLLECTED || f.tier[i] < 0 || f.loose[i] !== 0) continue;
    const tier = f.tier[i] as TierId;
    f.state[i] = CELL.GROWING;
    f.hp[i] = TIERS[tier].hp;
    f.generation[i] = Math.min(65535, f.generation[i] + 1);
    units += TIERS[tier].unitsPerCell;
  }
  return units;
}

/** Crop cells inside the reach boundary and how many of them are no longer standing. */
export function reachableDepletion(f: FieldState, ax: number, az: number, reach: number): { total: number; depleted: number; standing: number } {
  let total = 0;
  let depleted = 0;
  let standing = 0;
  for (let i = 0; i < f.state.length; i++) {
    if (f.tier[i] < 0) continue;
    if (reachMetric(cellCenterX(i) - ax, cellCenterZ(i) - az) > reach) continue;
    total++;
    if (f.state[i] === CELL.GROWING) standing++;
    else depleted++;
  }
  return { total, depleted, standing };
}
