// All tunable gameplay/economy numbers live here. Money is stored in integer cents.
// See QA_NOTES.md for playtest notes on why values differ from the original brief.

export const GAME_NAME = 'Meadow Haul';

export const SIM_HZ = 60;
export const SIM_STEP = 1 / SIM_HZ;
export const MAX_SIM_STEPS_PER_FRAME = 5;
export const MAX_FRAME_DT = 0.1;

export type TierId = 0 | 1 | 2;

export interface TierDef {
  id: TierId;
  name: string;
  shortName: string;
  hp: number;
  unitsPerCell: number;
  unitsPerBale: number;
  /** Sale price for a full bale, in whole coins. */
  pricePerBale: number;
}

export const TIERS: readonly TierDef[] = [
  { id: 0, name: 'Meadow Grass', shortName: 'Meadow', hp: 1.15, unitsPerCell: 1, unitsPerBale: 10, pricePerBale: 8 },
  { id: 1, name: 'Clover Patch', shortName: 'Clover', hp: 2.1, unitsPerCell: 1, unitsPerBale: 10, pricePerBale: 12 },
  { id: 2, name: 'Golden Grass', shortName: 'Golden', hp: 3.1, unitsPerCell: 1, unitsPerBale: 10, pricePerBale: 20 },
];

export const UNITS_PER_BALE = 10;

/**
 * Runtime tuning multipliers for the ?debug=1 panel. They stay at 1 in normal play;
 * changing them marks the save as debug-assisted.
 */
export const TUNING = {
  vacuumIntakeMul: 1,
  priceMul: 1,
};

/** Price of a bale (full or mini) in integer cents: qty × tier price / 10. */
export function balePriceCents(tier: TierId, qty: number): number {
  return Math.round(((qty * TIERS[tier].pricePerBale * 100) / UNITS_PER_BALE) * TUNING.priceMul);
}

export const HARVESTER = {
  baseSpeed: 3.4,
  /** Time constant for accelerating toward the target velocity (≈95% after 3τ ≈ 90 ms). */
  accelTau: 0.03,
  /** Time constant for braking after input is released (≈99% after 5τ ≈ 100 ms). */
  stopTau: 0.02,
  /** Max spatial substep for swept cutting (world units). */
  sweepStep: 0.12,
  toolSwitchTime: 0.16,
  reachPushHintDelay: 0.6,
  reachPushHintCooldown: 6,
  reachTapCooldown: 1.2,
  /** Horizontal clamp inside the field (keeps the head over the crop). */
  fieldMargin: 0.2,
  minZ: 0.25,
};

export const BLADE = {
  maxLevel: 6,
  baseCost: 35,
  growth: 1.55,
  // Thin knife: modest at level 1, each Blade Power level is a clear step (sharper = more
  // DPS, longer knife = wider cut). L1 → L6: 2.6 → 7.8 DPS, 0.42 → 0.87 radius.
  dps: (level: number) => 2.6 * (1 + 0.4 * (level - 1)),
  radius: (level: number) => 0.42 + 0.09 * (level - 1),
  /** Extra contact slack so clumps whose leaves touch the disc count as contact. */
  contactSlack: 0.08,
  /**
   * Cutting drag: pushing the disc through standing crop slows the head. drag =
   * density / (density + dps × dragK), where density = remaining HP per unit² under the
   * disc; speed × (1 − maxDrag × drag). Blade Power (DPS) reduces the drag, tougher tiers
   * raise it, bare ground has none. maxDrag keeps it grass-light (never below 50% speed).
   */
  dragK: 1.8,
  maxDrag: 0.5,
  dragTau: 0.08,
};

export const VACUUM = {
  maxLevel: 6,
  baseCost: 40,
  growth: 1.5,
  // Base doubled from the brief (16/s felt like nibbling); each Vacuum Power level adds a
  // clearly noticeable +40% intake and wider nozzle. L1 → L6: 32 → 96 units/s, 1.3 → 2.1 radius.
  intake: (level: number) => 32 * (1 + 0.4 * (level - 1)),
  radius: (level: number) => 1.3 + 0.16 * (level - 1),
  /** Cuttings this far out (× radius) visibly drift and swirl toward the nozzle. */
  attractScale: 1.8,
};

export const REACH = {
  maxLevel: 10,
  baseCost: 50,
  growth: 1.3,
  length: (level: number) => 6.5 + 2.8 * (level - 1),
};

/**
 * Shape and feel of the reach limit. `length` above is the depth straight ahead of the
 * anchor; sideways the boundary is stretched into a rounded ellipse, so the near rows are
 * reachable across the field while the far edge still curves like a hose on a reel
 * (a flatter superellipse made the centre feel "short" compared with the diagonals).
 */
export const REACH_SHAPE = {
  sideStretch: 1.4,
  power: 2,
  /** Elastic give past the limit (world units); resistance grows toward it. */
  stretchMax: 0.5,
  /** Spring-back rate when the player stops pushing outward (1/s). */
  springBack: 14,
  /** Pull-back while still pushing (1/s): sets how far the hose "gives" when held. */
  pullWhilePushing: 5,
};

export const CARRY = {
  maxLevel: 5,
  baseCost: 60,
  growth: 1.55,
  // Base 8 = one full truck per trip (was 6 in the brief; felt too small next to the harvest).
  capacity: (level: number) => 8 + 2 * (level - 1),
  speedMultiplier: (level: number) => 1 + 0.05 * (level - 1),
};


export const PLAYER = {
  baseSpeed: 3.8,
  radius: 0.34,
  accelTau: 0.06,
  stopTau: 0.05,
  pickupDwell: 0.15,
  pickupInterval: 0.12,
  deliverInterval: 0.12,
  padDwell: 0.3,
  hirePadDwell: 0.7,
};

/**
 * Selling never waits for a truck: DELIVER always accepts bales (paid at once to the cash
 * pad) and stacks them on the loading dock; trucks just haul the dock away in the background.
 */
export const TRUCK = {
  capacity: 8,
  arriveTime: 1.5,
  /** Seconds per bale moved from the dock onto the truck bed (visual). */
  loadInterval: 0.12,
  departDelay: 0.3,
  /** A part-loaded truck leaves after the dock has been empty this long. */
  partialWait: 2.2,
  departTime: 1.4,
  waitNext: 1.0,
};

export const HAULER = {
  hireCost: 220,
  levels: [
    { level: 1, cost: 220, carry: 4, speed: 3.0 },
    { level: 2, cost: 180, carry: 6, speed: 3.2 },
    { level: 3, cost: 300, carry: 8, speed: 3.4 },
  ],
  pickupInterval: 0.14,
  unloadInterval: 0.14,
  /** How long the hauler lingers at the depot waiting for more stock before heading out with a partial load. */
  partialLoadWait: 1.6,
};

export const REPLANT = {
  duration: 1.0,
  /** Suggest replanting when this fraction of the reachable crop is collected. */
  suggestFraction: 0.6,
};

export const XP = {
  /** XP granted per 10 units sold. Fractions carry over through an accumulator. */
  perTenUnits: 5,
  toNext: (level: number) => 20 + 14 * (level - 1),
};

export const AUTOSAVE_INTERVAL = 5;

export type UpgradeId = 'blade' | 'vacuum' | 'reach' | 'carry';

export const UPGRADE_DEFS: Record<UpgradeId, { maxLevel: number; baseCost: number; growth: number }> = {
  blade: BLADE,
  vacuum: VACUUM,
  reach: REACH,
  carry: CARRY,
};

/** nextCost = round(baseCost × growth^(currentLevel − 1)) — in whole coins. */
export function upgradeCost(id: UpgradeId, currentLevel: number): number | null {
  const def = UPGRADE_DEFS[id];
  if (currentLevel >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.growth, currentLevel - 1));
}

export function haulerNextCost(level: number): number | null {
  // level 0 = not hired.
  const next = HAULER.levels[level];
  return next ? next.cost : null;
}

export const GOALS = [
  { id: 'sell6', text: 'Sell six bales' },
  { id: 'blade', text: 'Buy a blade upgrade' },
  { id: 'reach', text: 'Extend your reach' },
  { id: 'hauler', text: 'Hire a hauler' },
  { id: 'clover', text: 'Harvest Clover Patch' },
  { id: 'golden', text: 'Reach Golden Grass' },
  { id: 'sell100', text: 'Sell 100 bale equivalents' },
] as const;

export type GoalId = (typeof GOALS)[number]['id'];

/** Juice defaults (settings can scale these). */
export const JUICE = {
  shakeAmp: 0.06,
  shakeDuration: 0.09,
  toolTiltDeg: 3.2,
  stackSwayDeg: 6,
  balePop: 1.08,
};
