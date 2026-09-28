// Money, sales, XP and purchases. All amounts in integer cents.

import {
  HAULER,
  UNITS_PER_BALE,
  XP,
  balePriceCents,
  haulerNextCost,
  upgradeCost,
  type UpgradeId,
} from '../config/balance';
import type { Bale, GameState } from '../core/GameState';
import type { Carrier, EventQueue } from '../core/Events';

export function formatMoney(cents: number, forceDecimals = false): string {
  const whole = Math.floor(cents / 100);
  const frac = cents - whole * 100;
  if (!forceDecimals && frac === 0) return whole.toLocaleString('en-US');
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Sells one bale from a carrier: carrier −1 → loading dock +1 (visual, already sold) →
 * pendingCash += price → sold stats/XP. Never waits for a truck.
 * Returns the delivered bale, or null if the carrier is empty.
 */
export function deliverOne(state: GameState, carrier: Carrier, events?: EventQueue): Bale | null {
  const from = carrier === 'player' ? state.player.carry : state.hauler.carry;
  const bale = from.pop();
  if (!bale) return null;
  state.truck.dock.push(bale);
  const cents = balePriceCents(bale.tier, bale.qty);
  state.pendingCashCents += cents;
  state.stats.unitsSold += bale.qty;
  state.stats.balesSold += 1;
  state.stats.cashEarnedCents += cents;
  state.stats.firstSaleDone = true;
  events?.push({ type: 'deliver', bale, carrier, cents, dockIndex: state.truck.dock.length - 1 });
  grantSaleXp(state, bale.qty, events);
  return bale;
}

/** 5 XP per 10 units sold, with an accumulator so mini-bales still count. */
export function grantSaleXp(state: GameState, units: number, events?: EventQueue): void {
  state.xpUnitAcc += units * XP.perTenUnits;
  const gained = Math.floor(state.xpUnitAcc / UNITS_PER_BALE);
  if (gained <= 0) return;
  state.xpUnitAcc -= gained * UNITS_PER_BALE;
  state.xp += gained;
  events?.push({ type: 'xp', amount: gained });
  while (state.xp >= XP.toNext(state.level)) {
    state.xp -= XP.toNext(state.level);
    state.level += 1;
    events?.push({ type: 'levelUp', level: state.level });
  }
}

/** Moves pending cash into the wallet exactly once. */
export function collectCash(state: GameState, events?: EventQueue): number {
  const cents = state.pendingCashCents;
  if (cents <= 0) return 0;
  state.pendingCashCents = 0;
  state.walletCents += cents;
  events?.push({ type: 'cashCollected', cents });
  return cents;
}

export type PurchaseResult = { ok: true; cost: number; level: number } | { ok: false; reason: string; need?: number };

export function buyUpgrade(state: GameState, id: UpgradeId, events?: EventQueue): PurchaseResult {
  const level = state.upgrades[id];
  const cost = upgradeCost(id, level);
  if (cost === null) return fail(events, 'MAX');
  const costCents = cost * 100;
  if (state.walletCents < costCents) {
    const need = Math.ceil((costCents - state.walletCents) / 100);
    return fail(events, `Need ${need} more`, need);
  }
  state.walletCents -= costCents;
  state.upgrades[id] = level + 1;
  events?.push({ type: 'upgradeBought', id, level: level + 1, cost });
  return { ok: true, cost, level: level + 1 };
}

export function buyHauler(state: GameState, events?: EventQueue): PurchaseResult {
  const cost = haulerNextCost(state.hauler.level);
  if (cost === null) return fail(events, 'MAX');
  const costCents = cost * 100;
  if (state.walletCents < costCents) {
    const need = Math.ceil((costCents - state.walletCents) / 100);
    return fail(events, `Need ${need} more`, need);
  }
  state.walletCents -= costCents;
  state.hauler.level += 1;
  events?.push({ type: 'haulerBought', level: state.hauler.level, cost });
  return { ok: true, cost, level: state.hauler.level };
}

function fail(events: EventQueue | undefined, reason: string, need?: number): PurchaseResult {
  events?.push({ type: 'purchaseFailed', reason });
  return { ok: false, reason, need };
}

export function haulerStats(level: number): { carry: number; speed: number } {
  const def = HAULER.levels[Math.max(0, Math.min(HAULER.levels.length - 1, level - 1))];
  return { carry: def.carry, speed: def.speed };
}
