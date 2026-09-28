// Read-only descriptions of upgrades for the panel (current → next values).

import { BLADE, CARRY, HAULER, REACH, VACUUM, haulerNextCost, upgradeCost, type UpgradeId } from '../config/balance';
import type { GameState } from '../core/GameState';

export type UpgradeKey = UpgradeId | 'hauler';

export interface UpgradeInfo {
  key: UpgradeKey;
  name: string;
  tab: 'machine' | 'farm';
  level: number;
  maxLevel: number;
  /** Whole coins, or null at MAX. */
  cost: number | null;
  current: string;
  next: string | null;
  blurb: string;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export function describeUpgrade(state: GameState, key: UpgradeKey): UpgradeInfo {
  if (key === 'hauler') {
    const lvl = state.hauler.level;
    const cur = lvl > 0 ? HAULER.levels[lvl - 1] : null;
    const nxt = HAULER.levels[lvl] ?? null;
    return {
      key,
      name: lvl === 0 ? 'Hire Hauler' : 'Hauler',
      tab: 'farm',
      level: lvl,
      maxLevel: HAULER.levels.length,
      cost: haulerNextCost(lvl),
      current: cur ? `${cur.carry} bales · ${f1(cur.speed)} m/s` : 'Not hired',
      next: nxt ? `${nxt.carry} bales · ${f1(nxt.speed)} m/s` : null,
      blurb: 'Carries bales from the farm to the truck for you.',
    };
  }
  const level = state.upgrades[key];
  const cost = upgradeCost(key, level);
  const nl = level + 1;
  switch (key) {
    case 'blade':
      return {
        key,
        name: 'Blade Power',
        tab: 'machine',
        level,
        maxLevel: BLADE.maxLevel,
        cost,
        current: `${f1(BLADE.dps(level))} cut/s · ${f1(BLADE.radius(level) * 2)} m`,
        next: cost === null ? null : `${f1(BLADE.dps(nl))} cut/s · ${f1(BLADE.radius(nl) * 2)} m`,
        blurb: 'Cuts faster, wider, and pushes through thick crop with less drag.',
      };
    case 'vacuum':
      return {
        key,
        name: 'Vacuum Power',
        tab: 'machine',
        level,
        maxLevel: VACUUM.maxLevel,
        cost,
        current: `${f1(VACUUM.intake(level))}/s · ${f1(VACUUM.radius(level))} m`,
        next: cost === null ? null : `${f1(VACUUM.intake(nl))}/s · ${f1(VACUUM.radius(nl))} m`,
        blurb: 'Stronger suction over a wider area.',
      };
    case 'reach':
      return {
        key,
        name: 'Hose Length',
        tab: 'machine',
        level,
        maxLevel: REACH.maxLevel,
        cost,
        current: `${f1(REACH.length(level))} m`,
        next: cost === null ? null : `${f1(REACH.length(nl))} m`,
        blurb: 'Reach deeper rows: Clover, then Golden Grass.',
      };
    case 'carry':
      return {
        key,
        name: 'Carry Capacity',
        tab: 'farm',
        level,
        maxLevel: CARRY.maxLevel,
        cost,
        current: `${CARRY.capacity(level)} bales · +${Math.round((CARRY.speedMultiplier(level) - 1) * 100)}% speed`,
        next: cost === null ? null : `${CARRY.capacity(nl)} bales · +${Math.round((CARRY.speedMultiplier(nl) - 1) * 100)}% speed`,
        blurb: 'Carry more bales per trip, and walk a bit faster.',
      };
  }
}

export const UPGRADE_ORDER: UpgradeKey[] = ['blade', 'vacuum', 'reach', 'carry', 'hauler'];
