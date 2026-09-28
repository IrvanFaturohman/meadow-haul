// Light post-tutorial goals. They give direction only; no rewards that bend the economy.

import { GOALS, UNITS_PER_BALE, type GoalId } from '../config/balance';
import type { GameState } from '../core/GameState';
import type { EventQueue } from '../core/Events';

export interface GoalView {
  id: GoalId;
  text: string;
  progress?: string;
}

function isComplete(state: GameState, id: GoalId): boolean {
  switch (id) {
    case 'sell6':
      return state.stats.balesSold >= 6;
    case 'blade':
      return state.upgrades.blade >= 2;
    case 'reach':
      return state.upgrades.reach >= 2;
    case 'hauler':
      return state.hauler.level >= 1;
    case 'clover':
      return state.stats.cutByTier[1] > 0;
    case 'golden':
      return state.stats.cutByTier[2] > 0;
    case 'sell100':
      return state.stats.unitsSold >= 100 * UNITS_PER_BALE;
  }
}

export function updateGoals(state: GameState, events?: EventQueue): void {
  for (const g of GOALS) {
    if (state.goalsDone.includes(g.id)) continue;
    if (isComplete(state, g.id)) {
      state.goalsDone.push(g.id);
      events?.push({ type: 'goalComplete', id: g.id });
    }
  }
}

export function currentGoal(state: GameState): GoalView | null {
  for (const g of GOALS) {
    if (state.goalsDone.includes(g.id)) continue;
    let progress: string | undefined;
    if (g.id === 'sell6') progress = `${Math.min(6, state.stats.balesSold)}/6`;
    if (g.id === 'sell100') progress = `${Math.floor(state.stats.unitsSold / UNITS_PER_BALE)}/100`;
    return { id: g.id, text: g.text, progress };
  }
  return null;
}

export function goalText(id: GoalId): string {
  return GOALS.find((g) => g.id === id)?.text ?? id;
}
