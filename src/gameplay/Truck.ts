// Buyer truck: ARRIVING → LOADING → DEPARTING → WAITING_NEXT. Cargo on the truck is already
// paid for (booked in the sold ledger), so clearing it on departure never touches money.

import { TRUCK } from '../config/balance';
import { TRUCK_LAYOUT } from '../config/worldLayout';
import type { TruckState } from '../core/GameState';
import type { EventQueue } from '../core/Events';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

export function updateTruck(truck: TruckState, dt: number, events?: EventQueue): void {
  switch (truck.state) {
    case 'ARRIVING': {
      truck.t += dt;
      const k = Math.min(1, truck.t / TRUCK.arriveTime);
      truck.x = TRUCK_LAYOUT.enterX + (TRUCK_LAYOUT.dockX - TRUCK_LAYOUT.enterX) * easeOutCubic(k);
      if (k >= 1) setState(truck, 'LOADING', events);
      break;
    }
    case 'LOADING': {
      truck.x = TRUCK_LAYOUT.dockX;
      if (truck.cargo.length >= TRUCK.capacity) {
        truck.t += dt;
        if (truck.t >= TRUCK.departDelay) setState(truck, 'DEPARTING', events);
      } else {
        truck.t = 0;
      }
      break;
    }
    case 'DEPARTING': {
      truck.t += dt;
      const k = Math.min(1, truck.t / TRUCK.departTime);
      truck.x = TRUCK_LAYOUT.dockX + (TRUCK_LAYOUT.exitX - TRUCK_LAYOUT.dockX) * easeInCubic(k);
      if (k >= 1) {
        truck.cargo = [];
        setState(truck, 'WAITING_NEXT', events);
      }
      break;
    }
    case 'WAITING_NEXT': {
      truck.t += dt;
      truck.x = TRUCK_LAYOUT.exitX;
      if (truck.t >= TRUCK.waitNext) {
        truck.x = TRUCK_LAYOUT.enterX;
        setState(truck, 'ARRIVING', events);
      }
      break;
    }
  }
}

function setState(truck: TruckState, s: TruckState['state'], events?: EventQueue): void {
  truck.state = s;
  truck.t = 0;
  events?.push({ type: 'truckState', state: s });
}

/** Normalizes a truck loaded from a save so no cargo is duplicated or sold twice. */
export function normalizeTruck(truck: TruckState): void {
  if (truck.state === 'LOADING' && truck.cargo.length < TRUCK.capacity) {
    truck.x = TRUCK_LAYOUT.dockX;
    truck.t = 0;
    return;
  }
  if (truck.state === 'ARRIVING' && truck.cargo.length === 0) {
    truck.t = 0;
    truck.x = TRUCK_LAYOUT.enterX;
    return;
  }
  // Mid-departure / full / waiting: the cargo was already paid; start a fresh truck.
  truck.cargo = [];
  truck.state = 'ARRIVING';
  truck.t = 0;
  truck.x = TRUCK_LAYOUT.enterX;
}
