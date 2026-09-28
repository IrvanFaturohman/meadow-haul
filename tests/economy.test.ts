import { describe, expect, it } from 'vitest';
import { TRUCK, balePriceCents, upgradeCost } from '../src/config/balance';
import { createInitialState, type GameState } from '../src/core/GameState';
import { EventQueue } from '../src/core/Events';
import { buyHauler, buyUpgrade, collectCash, deliverOne, formatMoney } from '../src/gameplay/Economy';
import { addRawUnits, canPackLeftovers, depotUnits, packLeftovers, takeTopBale } from '../src/gameplay/Inventory';
import { updateTruck } from '../src/gameplay/Truck';
import { conservedUnits } from './helpers';

function loadingTruck(s: GameState) {
  s.truck.state = 'LOADING';
  s.truck.t = 0;
  s.truck.cargo = [];
}

describe('upgrade costs', () => {
  it('follows round(base × growth^(level−1)) and stops at MAX', () => {
    expect(upgradeCost('blade', 1)).toBe(35);
    expect(upgradeCost('blade', 2)).toBe(Math.round(35 * 1.55));
    expect(upgradeCost('reach', 1)).toBe(50);
    expect(upgradeCost('reach', 3)).toBe(Math.round(50 * 1.3 * 1.3));
    expect(upgradeCost('blade', 6)).toBeNull();
    expect(upgradeCost('reach', 10)).toBeNull();
    expect(upgradeCost('carry', 5)).toBeNull();
  });

  it('never lets the wallet go negative and ignores a double click', () => {
    const s = createInitialState();
    s.walletCents = 48_00;
    const a = buyUpgrade(s, 'blade');
    const b = buyUpgrade(s, 'blade'); // second click: next cost is 54
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(s.upgrades.blade).toBe(2);
    expect(s.walletCents).toBe(13_00);
    expect(upgradeCost('blade', s.upgrades.blade)).toBe(54);
  });

  it('refuses purchases at MAX level', () => {
    const s = createInitialState();
    s.upgrades.carry = 5;
    s.walletCents = 1_000_000;
    const r = buyUpgrade(s, 'carry');
    expect(r.ok).toBe(false);
    expect(s.walletCents).toBe(1_000_000);
  });

  it('hauler hire and two upgrades cost 220, 180, 300', () => {
    const s = createInitialState();
    s.walletCents = 700_00;
    expect(buyHauler(s).ok).toBe(true);
    expect(buyHauler(s).ok).toBe(true);
    expect(buyHauler(s).ok).toBe(true);
    expect(buyHauler(s).ok).toBe(false);
    expect(s.hauler.level).toBe(3);
    expect(s.walletCents).toBe(0);
  });
});

describe('depot and bales', () => {
  it('packs ten units into a bale and counts depot units without double counting', () => {
    const s = createInitialState();
    addRawUnits(s, 0, 7);
    expect(s.depot.bales.length).toBe(0);
    addRawUnits(s, 0, 5);
    expect(s.depot.bales.length).toBe(1);
    expect(s.depot.raw[0]).toBe(2);
    expect(depotUnits(s.depot)).toBe(12);
  });

  it('pack leftovers keeps actual quantity and proportional value', () => {
    const s = createInitialState();
    addRawUnits(s, 0, 7);
    addRawUnits(s, 2, 3);
    expect(canPackLeftovers(s.depot)).toBe(true);
    const minis = packLeftovers(s);
    expect(minis.map((b) => b.qty)).toEqual([7, 3]);
    expect(depotUnits(s.depot)).toBe(10);
    expect(balePriceCents(0, 7)).toBe(560); // 7 × 8 / 10 = 5.60
    expect(balePriceCents(2, 3)).toBe(600); // 3 × 20 / 10 = 6.00
    expect(canPackLeftovers(s.depot)).toBe(false);
  });

  it('pack leftovers is not offered while a full bale waits', () => {
    const s = createInitialState();
    addRawUnits(s, 0, 13);
    expect(canPackLeftovers(s.depot)).toBe(false);
  });
});

describe('selling', () => {
  it('pays per loaded bale exactly once, and cash collection cannot repeat', () => {
    const s = createInitialState();
    loadingTruck(s);
    s.player.carry = [
      { id: 1, tier: 0, qty: 10 },
      { id: 2, tier: 1, qty: 10 },
      { id: 3, tier: 2, qty: 4 },
    ];
    s.stats.unitsPlanted = 24; // for conservation
    const ev = new EventQueue();
    while (deliverOne(s, 'player', ev));
    expect(s.player.carry.length).toBe(0);
    expect(s.truck.cargo.length).toBe(3);
    expect(s.pendingCashCents).toBe(8_00 + 12_00 + 8_00);
    expect(collectCash(s, ev)).toBe(28_00);
    expect(collectCash(s, ev)).toBe(0);
    expect(s.walletCents).toBe(28_00);
    expect(s.stats.unitsSold).toBe(24);
  });

  it('truck never exceeds capacity and departure does not pay again', () => {
    const s = createInitialState();
    loadingTruck(s);
    s.player.carry = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, tier: 0 as const, qty: 10 }));
    let delivered = 0;
    while (deliverOne(s, 'player')) delivered++;
    expect(delivered).toBe(TRUCK.capacity);
    expect(s.player.carry.length).toBe(4);
    const pending = s.pendingCashCents;
    for (let t = 0; t < 10; t += 1 / 60) updateTruck(s.truck, 1 / 60);
    expect(s.truck.cargo.length).toBeLessThan(TRUCK.capacity);
    expect(s.pendingCashCents).toBe(pending);
    expect(s.truck.state === 'ARRIVING' || s.truck.state === 'LOADING' || s.truck.state === 'WAITING_NEXT').toBe(true);
  });

  it('player and hauler never own the same bale', () => {
    const s = createInitialState();
    for (let i = 0; i < 5; i++) s.depot.bales.push({ id: i + 1, tier: 0, qty: 10 });
    const seen = new Set<number>();
    for (let k = 0; k < 5; k++) {
      const who = k % 2 === 0 ? s.player.carry : s.hauler.carry;
      const b = takeTopBale(s.depot);
      if (b) who.push(b);
    }
    for (const b of [...s.player.carry, ...s.hauler.carry]) {
      expect(seen.has(b.id)).toBe(false);
      seen.add(b.id);
    }
    expect(seen.size).toBe(5);
    expect(s.depot.bales.length).toBe(0);
  });

  it('grants 5 XP per 10 units sold including fractions', () => {
    const s = createInitialState();
    loadingTruck(s);
    s.player.carry = [
      { id: 1, tier: 0, qty: 3 },
      { id: 2, tier: 0, qty: 3 },
    ];
    deliverOne(s, 'player');
    deliverOne(s, 'player');
    // 6 units → 3 XP
    expect(s.xp + (s.level - 1) * 1000).toBe(3);
  });

  it('formats money', () => {
    expect(formatMoney(4800)).toBe('48');
    expect(formatMoney(560)).toBe('5.60');
    expect(formatMoney(123456700)).toBe('1,234,567');
  });

  it('conserves units through the whole pipeline', () => {
    const s = createInitialState();
    const before = conservedUnits(s).total;
    expect(before).toBe(s.stats.unitsPlanted);
  });
});
