import { TIERS, type TierId } from '../src/config/balance';
import type { GameState } from '../src/core/GameState';
import { CELL, cellIndex } from '../src/world/FieldModel';
import { sumQty } from '../src/gameplay/Inventory';

/** Every unit must sit in exactly one place: standing → loose → depot → carrier → sold ledger. */
export function conservedUnits(s: GameState) {
  let standing = 0;
  let loose = 0;
  for (let i = 0; i < s.field.state.length; i++) {
    if (s.field.state[i] === CELL.GROWING) standing += TIERS[s.field.tier[i] as TierId].unitsPerCell;
    loose += s.field.loose[i];
  }
  const raw = s.depot.raw[0] + s.depot.raw[1] + s.depot.raw[2];
  const depot = sumQty(s.depot.bales);
  const carry = sumQty(s.player.carry);
  const hauler = sumQty(s.hauler.carry);
  const sold = s.stats.unitsSold;
  return { standing, loose, raw, depot, carry, hauler, sold, total: standing + loose + raw + depot + carry + hauler + sold };
}

/** Cell index at the centre of a meadow row near the anchor. */
export function meadowCell(col = 20, row = 8): number {
  return cellIndex(col, row);
}
