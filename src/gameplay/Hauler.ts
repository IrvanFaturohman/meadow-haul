// Hauler worker: a real carrier that walks depot → truck. It never creates resources or money;
// its sales go through the same deliverOne() path and land on the shared cash pad.

import { HAULER } from '../config/balance';
import { HAULER_POINTS } from '../config/worldLayout';
import type { GameState } from '../core/GameState';
import type { EventQueue } from '../core/Events';
import { deliverOne, haulerStats } from './Economy';
import { takeTopBale } from './Inventory';
import { walkToward } from './Player';

export interface HaulerRuntime {
  stepTimer: number;
  waitTimer: number;
  footTimer: number;
}

export function createHaulerRuntime(): HaulerRuntime {
  return { stepTimer: 0, waitTimer: 0, footTimer: 0 };
}

export function updateHauler(state: GameState, rt: HaulerRuntime, dt: number, events?: EventQueue): void {
  const h = state.hauler;
  if (h.level <= 0) return;
  const { carry, speed } = haulerStats(h.level);
  const moving = (tx: number, tz: number) => {
    const arrived = walkToward(h, tx, tz, speed, dt);
    if (!arrived) {
      rt.footTimer -= dt;
      if (rt.footTimer <= 0) {
        rt.footTimer = 0.32;
        events?.push({ type: 'footstep', carrier: 'hauler' });
      }
    }
    return arrived;
  };

  switch (h.state) {
    case 'WAIT_FOR_STOCK': {
      if (h.carry.length > 0) {
        h.state = 'WALK_TO_TRUCK';
        break;
      }
      if (state.depot.bales.length > 0) {
        h.state = 'WALK_TO_DEPOT';
        break;
      }
      moving(HAULER_POINTS.idle.x, HAULER_POINTS.idle.z);
      break;
    }
    case 'WALK_TO_DEPOT':
    case 'RETURN': {
      if (moving(HAULER_POINTS.depot.x, HAULER_POINTS.depot.z)) {
        h.state = 'PICK_UP';
        rt.stepTimer = HAULER.pickupInterval;
        rt.waitTimer = 0;
      }
      break;
    }
    case 'PICK_UP': {
      if (h.carry.length >= carry) {
        h.state = 'WALK_TO_TRUCK';
        break;
      }
      if (state.depot.bales.length === 0) {
        if (h.carry.length === 0) {
          h.state = 'WAIT_FOR_STOCK';
          break;
        }
        rt.waitTimer += dt;
        if (rt.waitTimer >= HAULER.partialLoadWait) h.state = 'WALK_TO_TRUCK';
        break;
      }
      rt.stepTimer -= dt;
      if (rt.stepTimer <= 0) {
        rt.stepTimer = HAULER.pickupInterval;
        const idx = state.depot.bales.length - 1;
        const bale = takeTopBale(state.depot);
        if (bale) {
          h.carry.push(bale);
          rt.waitTimer = 0;
          events?.push({ type: 'pickup', bale, carrier: 'hauler', depotIndex: idx });
        }
      }
      break;
    }
    case 'WALK_TO_TRUCK': {
      if (h.carry.length === 0) {
        h.state = 'RETURN';
        break;
      }
      // Selling never waits for a truck: walk to the dock and unload.
      if (moving(HAULER_POINTS.truck.x, HAULER_POINTS.truck.z)) {
        h.state = 'UNLOAD';
        rt.stepTimer = HAULER.unloadInterval * 0.5;
      }
      break;
    }
    case 'UNLOAD': {
      if (h.carry.length === 0) {
        h.state = 'RETURN';
        break;
      }
      rt.stepTimer -= dt;
      if (rt.stepTimer <= 0) {
        rt.stepTimer = HAULER.unloadInterval;
        deliverOne(state, 'hauler', events);
      }
      break;
    }
  }
}

/** After loading a save: put the hauler somewhere safe without touching its cargo. */
export function normalizeHauler(state: GameState): void {
  const h = state.hauler;
  if (h.level <= 0) {
    h.carry = [];
    h.state = 'WAIT_FOR_STOCK';
    h.x = HAULER_POINTS.spawn.x;
    h.z = HAULER_POINTS.spawn.z;
    return;
  }
  if (h.state === 'PICK_UP' || h.state === 'UNLOAD') h.state = h.carry.length > 0 ? 'WALK_TO_TRUCK' : 'WALK_TO_DEPOT';
  if (!Number.isFinite(h.x) || !Number.isFinite(h.z)) {
    h.x = HAULER_POINTS.idle.x;
    h.z = HAULER_POINTS.idle.z;
  }
}
