// Serializable game state. Everything here is committed logical state: visuals are
// reconstructed from it and never decide inventory amounts.

import type { GoalId, TierId, UpgradeId } from '../config/balance';
import { PLAYER_START, TOOL_START, TRUCK_LAYOUT, HAULER_POINTS } from '../config/worldLayout';
import { createField, type FieldState } from '../world/FieldModel';

export const SCHEMA_VERSION = 1;

export interface Bale {
  id: number;
  tier: TierId;
  /** Units of crop inside. 10 = full bale, 1–9 = mini-bale from "Pack leftovers". */
  qty: number;
}

export type ToolId = 'BLADE' | 'VACUUM';
export type TruckStateName = 'ARRIVING' | 'LOADING' | 'DEPARTING' | 'WAITING_NEXT';
export type HaulerStateName = 'WAIT_FOR_STOCK' | 'WALK_TO_DEPOT' | 'PICK_UP' | 'WALK_TO_TRUCK' | 'UNLOAD' | 'RETURN';
export type QualityId = 'auto' | 'low' | 'medium' | 'high';

export interface DepotState {
  /** Loose units per tier waiting to be packed (always < 10 after packing). */
  raw: [number, number, number];
  bales: Bale[];
}

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  carry: Bale[];
}

export interface HarvesterState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  tool: ToolId;
  /** Remaining switch time; > 0 means SWITCHING toward `tool`. */
  switchT: number;
  vacuumAcc: number;
}

export interface TruckState {
  state: TruckStateName;
  t: number;
  x: number;
  cargo: Bale[];
  /** Sold bales waiting on the loading dock for the next truck (already paid; visual). */
  dock: Bale[];
  loadT: number;
}

export interface HaulerState {
  level: number; // 0 = not hired
  state: HaulerStateName;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  t: number;
  carry: Bale[];
}

export interface TutorialState {
  step: number;
  done: boolean;
  /** Units of Meadow Grass cut since the tutorial started (for the vacuum hint). */
  cutCount: number;
  seenUpgradeInfo: boolean;
  seenHauler: boolean;
  seenReplant: boolean;
}

export interface StatsState {
  unitsPlanted: number;
  unitsCut: number;
  unitsCollected: number;
  unitsSold: number;
  balesSold: number;
  cashEarnedCents: number;
  replants: number;
  cutByTier: [number, number, number];
  firstSaleDone: boolean;
  debugUsed: boolean;
  playSeconds: number;
}

export interface SettingsState {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
  quality: QualityId;
  reducedMotion: boolean;
  shake: boolean;
}

export interface GameState {
  schemaVersion: number;
  seed: number;
  savedAt: number;
  walletCents: number;
  pendingCashCents: number;
  upgrades: Record<UpgradeId, number>;
  field: FieldState;
  depot: DepotState;
  player: PlayerState;
  harvester: HarvesterState;
  truck: TruckState;
  hauler: HaulerState;
  xp: number;
  level: number;
  /** Units sold that haven't yet converted into XP (accumulator for fractional XP). */
  xpUnitAcc: number;
  goalsDone: GoalId[];
  tutorial: TutorialState;
  stats: StatsState;
  settings: SettingsState;
  nextBaleId: number;
}

export function defaultSettings(): SettingsState {
  const reduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  return {
    master: 0.9,
    sfx: 0.9,
    ambience: 0.6,
    music: 0.35,
    muted: false,
    quality: 'auto',
    reducedMotion: reduced,
    shake: true,
  };
}

export function createInitialState(seed = 1337, settings?: SettingsState): GameState {
  const field = createField(seed);
  let planted = 0;
  for (let i = 0; i < field.state.length; i++) if (field.tier[i] >= 0) planted += 1;
  return {
    schemaVersion: SCHEMA_VERSION,
    seed,
    savedAt: 0,
    walletCents: 0,
    pendingCashCents: 0,
    upgrades: { blade: 1, vacuum: 1, reach: 1, carry: 1 },
    field,
    depot: { raw: [0, 0, 0], bales: [] },
    player: { x: PLAYER_START.x, z: PLAYER_START.z, vx: 0, vz: 0, facing: Math.PI, carry: [] },
    harvester: { x: TOOL_START.x, z: TOOL_START.z, vx: 0, vz: 0, tool: 'BLADE', switchT: 0, vacuumAcc: 0 },
    truck: { state: 'ARRIVING', t: 0, x: TRUCK_LAYOUT.enterX, cargo: [], dock: [], loadT: 0 },
    hauler: {
      level: 0,
      state: 'WAIT_FOR_STOCK',
      x: HAULER_POINTS.spawn.x,
      z: HAULER_POINTS.spawn.z,
      vx: 0,
      vz: 0,
      facing: 0,
      t: 0,
      carry: [],
    },
    xp: 0,
    level: 1,
    xpUnitAcc: 0,
    goalsDone: [],
    tutorial: { step: 0, done: false, cutCount: 0, seenUpgradeInfo: false, seenHauler: false, seenReplant: false },
    stats: {
      unitsPlanted: planted,
      unitsCut: 0,
      unitsCollected: 0,
      unitsSold: 0,
      balesSold: 0,
      cashEarnedCents: 0,
      replants: 0,
      cutByTier: [0, 0, 0],
      firstSaleDone: false,
      debugUsed: false,
      playSeconds: 0,
    },
    settings: settings ?? defaultSettings(),
    nextBaleId: 1,
  };
}
