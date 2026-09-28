// localStorage save/load with validation. Only committed logical state is stored.

import { CARRY, HAULER, REACH, TRUCK, UPGRADE_DEFS, TIERS, type GoalId, type TierId, type UpgradeId, GOALS } from '../config/balance';
import { FIELD } from '../config/worldLayout';
import { clampToolPosition } from '../gameplay/Harvester';
import { clampToBounds } from '../gameplay/Player';
import { normalizeTruck } from '../gameplay/Truck';
import { normalizeHauler } from '../gameplay/Hauler';
import { CELL, tierForRow, type FieldState } from '../world/FieldModel';
import {
  SCHEMA_VERSION,
  createInitialState,
  defaultSettings,
  type Bale,
  type GameState,
  type SettingsState,
} from './GameState';

export const SAVE_KEY = 'meadow-haul.save.v1';
export const SETTINGS_KEY = 'meadow-haul.settings.v1';

interface SavedField {
  state: string;
  hp: string;
  loose: string;
  generation: string;
}

type SavedState = Omit<GameState, 'field'> & { field: SavedField };

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function serialize(state: GameState): string {
  const f = state.field;
  const hpBytes = new Uint8Array(f.hp.length);
  for (let i = 0; i < f.hp.length; i++) {
    const tier = f.tier[i];
    const max = tier >= 0 ? TIERS[tier as TierId].hp : 1;
    hpBytes[i] = Math.round(Math.max(0, Math.min(1, f.hp[i] / max)) * 255);
  }
  const saved: SavedState = {
    ...state,
    savedAt: Date.now(),
    harvester: { ...state.harvester, switchT: 0, vx: 0, vz: 0 },
    player: { ...state.player, vx: 0, vz: 0 },
    field: {
      state: bytesToB64(f.state),
      hp: bytesToB64(hpBytes),
      loose: bytesToB64(f.loose),
      generation: bytesToB64(new Uint8Array(f.generation.buffer, f.generation.byteOffset, f.generation.byteLength)),
    },
  };
  return JSON.stringify(saved);
}

export class SaveError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: unknown, lo: number, hi: number, def: number) =>
  isNum(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def;
const clampNum = (v: unknown, lo: number, hi: number, def: number) => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : def);

function readBales(v: unknown, maxLen: number): Bale[] {
  if (!Array.isArray(v)) throw new SaveError('bad bale list');
  const out: Bale[] = [];
  for (const b of v.slice(0, maxLen)) {
    if (!b || typeof b !== 'object') throw new SaveError('bad bale');
    const o = b as Record<string, unknown>;
    const tier = clampInt(o.tier, 0, 2, -1);
    const qty = clampInt(o.qty, 1, 10, -1);
    const id = clampInt(o.id, 0, Number.MAX_SAFE_INTEGER, -1);
    if (tier < 0 || qty < 0 || id < 0) throw new SaveError('bad bale values');
    out.push({ id, tier: tier as TierId, qty });
  }
  return out;
}

function readField(v: unknown): FieldState {
  if (!v || typeof v !== 'object') throw new SaveError('missing field');
  const o = v as Record<string, unknown>;
  if (typeof o.state !== 'string' || typeof o.hp !== 'string' || typeof o.loose !== 'string' || typeof o.generation !== 'string')
    throw new SaveError('bad field encoding');
  const n = FIELD.cols * FIELD.rows;
  const st = b64ToBytes(o.state);
  const hp = b64ToBytes(o.hp);
  const loose = b64ToBytes(o.loose);
  const genBytes = b64ToBytes(o.generation);
  if (st.length !== n || hp.length !== n || loose.length !== n || genBytes.length !== n * 2) throw new SaveError('field size mismatch');
  const gen = new Uint16Array(genBytes.buffer.slice(genBytes.byteOffset, genBytes.byteOffset + genBytes.byteLength));
  const f: FieldState = {
    cols: FIELD.cols,
    rows: FIELD.rows,
    tier: new Int8Array(n),
    state: new Uint8Array(n),
    hp: new Float32Array(n),
    loose: new Uint8Array(n),
    generation: gen,
  };
  for (let i = 0; i < n; i++) {
    const tier = tierForRow((i / FIELD.cols) | 0);
    f.tier[i] = tier;
    if (tier < 0) {
      f.state[i] = CELL.EMPTY;
      continue;
    }
    const def = TIERS[tier];
    let s = st[i];
    if (s !== CELL.GROWING && s !== CELL.CUT && s !== CELL.COLLECTED) s = CELL.GROWING;
    let l = Math.min(loose[i], def.unitsPerCell);
    if (s === CELL.GROWING) l = 0;
    if (s === CELL.CUT && l === 0) s = CELL.COLLECTED;
    if (s === CELL.COLLECTED) l = 0;
    f.state[i] = s;
    f.loose[i] = l;
    f.hp[i] = s === CELL.GROWING ? Math.max(0.02, (hp[i] / 255) * def.hp) : 0;
  }
  return f;
}

function readSettings(v: unknown): SettingsState {
  const d = defaultSettings();
  if (!v || typeof v !== 'object') return d;
  const o = v as Record<string, unknown>;
  const q = o.quality;
  return {
    master: clampNum(o.master, 0, 1, d.master),
    sfx: clampNum(o.sfx, 0, 1, d.sfx),
    ambience: clampNum(o.ambience, 0, 1, d.ambience),
    music: clampNum(o.music, 0, 1, d.music),
    muted: typeof o.muted === 'boolean' ? o.muted : d.muted,
    quality: q === 'low' || q === 'medium' || q === 'high' || q === 'auto' ? q : d.quality,
    reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : d.reducedMotion,
    shake: typeof o.shake === 'boolean' ? o.shake : d.shake,
  };
}

/** Parses and validates a save. Throws SaveError on corrupt data. */
export function deserialize(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SaveError('not JSON');
  }
  if (!raw || typeof raw !== 'object') throw new SaveError('not an object');
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== SCHEMA_VERSION) throw new SaveError(`unsupported schema ${String(o.schemaVersion)}`);

  const seed = clampInt(o.seed, 0, 2 ** 31, 1337);
  const s = createInitialState(seed, readSettings(o.settings));
  s.savedAt = clampNum(o.savedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  s.walletCents = clampInt(o.walletCents, 0, 1e12, 0);
  s.pendingCashCents = clampInt(o.pendingCashCents, 0, 1e12, 0);

  const up = (o.upgrades ?? {}) as Record<string, unknown>;
  for (const id of Object.keys(UPGRADE_DEFS) as UpgradeId[]) s.upgrades[id] = clampInt(up[id], 1, UPGRADE_DEFS[id].maxLevel, 1);

  s.field = readField(o.field);

  const depot = (o.depot ?? {}) as Record<string, unknown>;
  const rawBuf = Array.isArray(depot.raw) ? depot.raw : [];
  s.depot.raw = [clampInt(rawBuf[0], 0, 9, 0), clampInt(rawBuf[1], 0, 9, 0), clampInt(rawBuf[2], 0, 9, 0)];
  s.depot.bales = readBales(depot.bales ?? [], 10000);

  const pl = (o.player ?? {}) as Record<string, unknown>;
  s.player.x = clampNum(pl.x, -100, 100, s.player.x);
  s.player.z = clampNum(pl.z, -100, 100, s.player.z);
  s.player.facing = clampNum(pl.facing, -10, 10, s.player.facing);
  s.player.carry = readBales(pl.carry ?? [], CARRY.capacity(CARRY.maxLevel));
  clampToBounds(s.player, 0.34);

  const hv = (o.harvester ?? {}) as Record<string, unknown>;
  s.harvester.x = clampNum(hv.x, -100, 100, s.harvester.x);
  s.harvester.z = clampNum(hv.z, -100, 100, s.harvester.z);
  s.harvester.tool = hv.tool === 'VACUUM' ? 'VACUUM' : 'BLADE';
  s.harvester.vacuumAcc = 0;
  clampToolPosition(s.harvester, REACH.length(s.upgrades.reach));

  const tr = (o.truck ?? {}) as Record<string, unknown>;
  const ts = tr.state;
  s.truck.state = ts === 'ARRIVING' || ts === 'LOADING' || ts === 'DEPARTING' || ts === 'WAITING_NEXT' ? ts : 'ARRIVING';
  s.truck.cargo = readBales(tr.cargo ?? [], TRUCK.capacity);
  s.truck.t = 0;
  normalizeTruck(s.truck);

  const ha = (o.hauler ?? {}) as Record<string, unknown>;
  s.hauler.level = clampInt(ha.level, 0, HAULER.levels.length, 0);
  const hs = ha.state;
  const validH = ['WAIT_FOR_STOCK', 'WALK_TO_DEPOT', 'PICK_UP', 'WALK_TO_TRUCK', 'UNLOAD', 'RETURN'];
  s.hauler.state = typeof hs === 'string' && validH.includes(hs) ? (hs as GameState['hauler']['state']) : 'WAIT_FOR_STOCK';
  s.hauler.x = clampNum(ha.x, -100, 100, s.hauler.x);
  s.hauler.z = clampNum(ha.z, -100, 100, s.hauler.z);
  s.hauler.carry = readBales(ha.carry ?? [], 8);
  normalizeHauler(s);

  s.xp = clampInt(o.xp, 0, 1e9, 0);
  s.level = clampInt(o.level, 1, 999, 1);
  s.xpUnitAcc = clampInt(o.xpUnitAcc, 0, 1e9, 0);
  const goalIds = GOALS.map((g) => g.id) as string[];
  s.goalsDone = Array.isArray(o.goalsDone) ? (o.goalsDone.filter((g) => typeof g === 'string' && goalIds.includes(g)) as GoalId[]) : [];

  const tu = (o.tutorial ?? {}) as Record<string, unknown>;
  s.tutorial.step = clampInt(tu.step, 0, 9, 0);
  s.tutorial.done = tu.done === true;
  s.tutorial.cutCount = clampInt(tu.cutCount, 0, 1e9, 0);
  s.tutorial.seenUpgradeInfo = tu.seenUpgradeInfo === true;
  s.tutorial.seenHauler = tu.seenHauler === true;
  s.tutorial.seenReplant = tu.seenReplant === true;

  const st = (o.stats ?? {}) as Record<string, unknown>;
  const cbt = Array.isArray(st.cutByTier) ? st.cutByTier : [];
  s.stats = {
    unitsPlanted: clampInt(st.unitsPlanted, 0, 1e12, s.stats.unitsPlanted),
    unitsCut: clampInt(st.unitsCut, 0, 1e12, 0),
    unitsCollected: clampInt(st.unitsCollected, 0, 1e12, 0),
    unitsSold: clampInt(st.unitsSold, 0, 1e12, 0),
    balesSold: clampInt(st.balesSold, 0, 1e12, 0),
    cashEarnedCents: clampInt(st.cashEarnedCents, 0, 1e14, 0),
    replants: clampInt(st.replants, 0, 1e9, 0),
    cutByTier: [clampInt(cbt[0], 0, 1e12, 0), clampInt(cbt[1], 0, 1e12, 0), clampInt(cbt[2], 0, 1e12, 0)],
    firstSaleDone: st.firstSaleDone === true,
    debugUsed: st.debugUsed === true,
    playSeconds: clampNum(st.playSeconds, 0, 1e9, 0),
  };

  // Bale ids must stay unique after load.
  let maxId = clampInt(o.nextBaleId, 1, Number.MAX_SAFE_INTEGER, 1);
  for (const list of [s.depot.bales, s.player.carry, s.hauler.carry, s.truck.cargo]) for (const b of list) maxId = Math.max(maxId, b.id + 1);
  s.nextBaleId = maxId;
  return s;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export type LoadResult = { kind: 'none' } | { kind: 'ok'; state: GameState } | { kind: 'corrupt'; error: string };

export function loadGame(store: StorageLike | null = storage()): LoadResult {
  if (!store) return { kind: 'none' };
  let json: string | null = null;
  try {
    json = store.getItem(SAVE_KEY);
  } catch {
    return { kind: 'none' };
  }
  if (!json) return { kind: 'none' };
  try {
    return { kind: 'ok', state: deserialize(json) };
  } catch (e) {
    return { kind: 'corrupt', error: e instanceof Error ? e.message : String(e) };
  }
}

export function saveGame(state: GameState, store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, serialize(state));
    store.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    return true;
  } catch {
    return false;
  }
}

/** Settings survive a save reset (mute etc. is a device preference). */
export function loadSettings(store: StorageLike | null = storage()): SettingsState {
  if (!store) return defaultSettings();
  try {
    const s = store.getItem(SETTINGS_KEY);
    return s ? readSettings(JSON.parse(s)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function clearSave(store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
