// Resource conservation snapshot: every unit lives in exactly one place.

import { TIERS, type TierId } from '../config/balance';
import type { GameState } from '../core/GameState';
import { CELL } from '../world/FieldModel';
import { sumQty } from '../gameplay/Inventory';

export function conservedUnitsSnapshot(s: GameState) {
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
