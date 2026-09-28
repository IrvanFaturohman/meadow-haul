// Depot buffer and bale packing. Pure functions over GameState. The depot is unlimited.

import { UNITS_PER_BALE, type TierId } from '../config/balance';
import type { Bale, DepotState, GameState } from '../core/GameState';

/** Units waiting at the depot: sum(raw buffer) + sum(bale qty). The depot has no capacity limit. */
export function depotUnits(depot: DepotState): number {
  let used = depot.raw[0] + depot.raw[1] + depot.raw[2];
  for (const b of depot.bales) used += b.qty;
  return used;
}

/**
 * Adds units of a tier to the raw buffer and packs every complete group of ten into a bale.
 * Returns the bales created (in order).
 */
export function addRawUnits(state: GameState, tier: TierId, units: number): Bale[] {
  const created: Bale[] = [];
  state.depot.raw[tier] += units;
  while (state.depot.raw[tier] >= UNITS_PER_BALE) {
    state.depot.raw[tier] -= UNITS_PER_BALE;
    const bale: Bale = { id: state.nextBaleId++, tier, qty: UNITS_PER_BALE };
    state.depot.bales.push(bale);
    created.push(bale);
  }
  return created;
}

/** Atomically removes the top bale from the depot (or null). */
export function takeTopBale(depot: DepotState): Bale | null {
  return depot.bales.pop() ?? null;
}

export function leftoverUnits(depot: DepotState): number {
  return depot.raw[0] + depot.raw[1] + depot.raw[2];
}

/** Recovery path for fractional inventory: only offered when no finished bale is waiting. */
export function canPackLeftovers(depot: DepotState): boolean {
  return leftoverUnits(depot) > 0 && depot.bales.length === 0;
}

/** Turns each tier's leftover units into a mini-bale that keeps its actual quantity. */
export function packLeftovers(state: GameState): Bale[] {
  if (!canPackLeftovers(state.depot)) return [];
  const created: Bale[] = [];
  for (let t = 0 as TierId; t < 3; t = (t + 1) as TierId) {
    const qty = state.depot.raw[t];
    if (qty <= 0) continue;
    state.depot.raw[t] = 0;
    const bale: Bale = { id: state.nextBaleId++, tier: t, qty };
    state.depot.bales.push(bale);
    created.push(bale);
  }
  return created;
}

export function sumQty(bales: readonly Bale[]): number {
  let s = 0;
  for (const b of bales) s += b.qty;
  return s;
}
