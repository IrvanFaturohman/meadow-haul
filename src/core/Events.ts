// Events emitted by the simulation after committed state changes. Renderers, audio and UI
// consume them for feedback only; they never change inventory in response.

import type { GoalId, TierId, UpgradeId } from '../config/balance';
import type { Bale, ToolId, TruckStateName } from './GameState';

export type Carrier = 'player' | 'hauler';

export type GameEvent =
  | { type: 'cellsCut'; cells: number[]; dirX: number; dirZ: number }
  | { type: 'vacuumed'; cells: number[]; tiers: TierId[] }
  | { type: 'balePacked'; bale: Bale; mini: boolean }
  | { type: 'toolSwitchStart'; to: ToolId }
  | { type: 'toolSwitched'; tool: ToolId }
  | { type: 'reachLimit' }
  | { type: 'reachHint' }
  | { type: 'pickup'; bale: Bale; carrier: Carrier; depotIndex: number }
  | { type: 'carryFull'; carrier: Carrier }
  | { type: 'deliver'; bale: Bale; carrier: Carrier; cents: number; dockIndex: number }
  | { type: 'truckLoad'; bale: Bale; dockIndex: number; truckSlot: number }
  | { type: 'truckState'; state: TruckStateName }
  | { type: 'cashCollected'; cents: number }
  | { type: 'upgradeBought'; id: UpgradeId; level: number; cost: number }
  | { type: 'haulerBought'; level: number; cost: number }
  | { type: 'purchaseFailed'; reason: string }
  | { type: 'xp'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'replantStart'; cells: number[] }
  | { type: 'replantDone'; cells: number }
  | { type: 'replantUnavailable' }
  | { type: 'requestHarvest' }
  | { type: 'openUpgrades' }
  | { type: 'goalComplete'; id: GoalId }
  | { type: 'footstep'; carrier: Carrier }
  | { type: 'hireNeedMoney'; need: number };

export class EventQueue {
  private items: GameEvent[] = [];

  push(e: GameEvent): void {
    this.items.push(e);
  }

  drain(): GameEvent[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get length(): number {
    return this.items.length;
  }
}
