// Contextual onboarding driven by real gameplay state. It never blocks the player: if they
// act ahead of the script the step jumps forward instead of asking for finished actions.

import type { GameState } from '../core/GameState';

export type TutorialTarget =
  | 'pad:harvest'
  | 'pad:depot'
  | 'pad:deliver'
  | 'pad:cash'
  | 'pad:upgrade'
  | 'pad:hauler'
  | 'ui:vacuum'
  | 'ui:back'
  | 'ui:joystick'
  | null;

export interface TutorialView {
  step: number;
  text: string;
  sub?: string;
  target: TutorialTarget;
}

export interface TutorialContext {
  mode: 'FARM' | 'HARVEST' | 'OTHER';
  upgradePanelOpen: boolean;
}

export const TUTORIAL_STEPS = {
  WALK: 0,
  CUT: 1,
  SWITCH: 2,
  COLLECT: 3,
  BACK: 4,
  PICKUP: 5,
  DELIVER: 6,
  CASH: 7,
  UPGRADE: 8,
  DONE: 9,
} as const;

const TARGET_BALES = 6;
const CUT_BEFORE_VACUUM = 60;

export function updateTutorial(state: GameState, ctx: TutorialContext): TutorialView | null {
  const t = state.tutorial;
  if (t.done) return null;
  const S = TUTORIAL_STEPS;
  const depotBales = state.depot.bales.length;
  const carrying = state.player.carry.length;
  const anyUpgrade = Object.values(state.upgrades).some((l) => l > 1) || state.hauler.level > 0;

  // Skip-ahead rules so the tutorial never asks for something already done.
  if (anyUpgrade) t.step = S.DONE;
  if (t.step < S.CASH && state.stats.balesSold > 0) {
    t.step = state.pendingCashCents > 0 ? S.CASH : S.UPGRADE;
  }
  if (t.step === S.CASH && state.pendingCashCents === 0 && state.walletCents > 0) t.step = S.UPGRADE;

  if (ctx.mode === 'FARM' && t.step >= S.CUT && t.step <= S.BACK) {
    if (carrying > 0) t.step = S.DELIVER;
    else if (depotBales > 0) t.step = S.PICKUP;
  }
  if (t.step === S.PICKUP && carrying > 0) t.step = S.DELIVER;
  if (t.step === S.WALK && ctx.mode === 'HARVEST') t.step = S.CUT;
  if (t.step === S.CUT && (t.cutCount >= CUT_BEFORE_VACUUM || state.harvester.tool === 'VACUUM')) {
    t.step = state.harvester.tool === 'VACUUM' ? S.COLLECT : S.SWITCH;
  }
  if (t.step === S.SWITCH && state.harvester.tool === 'VACUUM') t.step = S.COLLECT;
  if (t.step === S.COLLECT && depotBales >= TARGET_BALES) t.step = S.BACK;
  if (t.step === S.BACK && ctx.mode === 'FARM') t.step = depotBales > 0 ? S.PICKUP : S.WALK;

  if (t.step >= S.DONE) {
    t.done = true;
    return null;
  }

  switch (t.step) {
    case S.WALK:
      if (ctx.mode === 'HARVEST') return { step: t.step, text: 'Drag to cut the grass', target: 'ui:joystick' };
      return { step: t.step, text: 'Walk to the harvester', sub: 'Stand on the HARVEST pad', target: 'pad:harvest' };
    case S.CUT:
      if (ctx.mode !== 'HARVEST') return { step: t.step, text: 'Walk to the harvester', target: 'pad:harvest' };
      return { step: t.step, text: 'Drag to cut the grass', sub: 'Sweep the cutter through the meadow', target: 'ui:joystick' };
    case S.SWITCH:
      if (ctx.mode !== 'HARVEST') return { step: t.step, text: 'Walk to the harvester', target: 'pad:harvest' };
      return { step: t.step, text: 'Switch tools to collect cuttings', target: 'ui:vacuum' };
    case S.COLLECT: {
      if (ctx.mode !== 'HARVEST') return { step: t.step, text: 'Walk to the harvester', target: 'pad:harvest' };
      const sub = `${Math.min(depotBales, TARGET_BALES)}/${TARGET_BALES} bales packed`;
      if (state.harvester.tool !== 'VACUUM') return { step: t.step, text: 'Switch tools to collect cuttings', sub, target: 'ui:vacuum' };
      return { step: t.step, text: 'Vacuum up the cuttings', sub, target: null };
    }
    case S.BACK:
      return { step: t.step, text: 'Back to farm', sub: 'Your bales are waiting at the farm', target: 'ui:back' };
    case S.PICKUP:
      if (ctx.mode === 'HARVEST') return { step: t.step, text: 'Back to farm', target: 'ui:back' };
      return { step: t.step, text: 'Pick up your harvest', sub: 'Stand by the bale pile', target: 'pad:depot' };
    case S.DELIVER:
      if (ctx.mode === 'HARVEST') return { step: t.step, text: 'Back to farm', target: 'ui:back' };
      if (carrying === 0 && depotBales > 0) return { step: t.step, text: 'Pick up your harvest', target: 'pad:depot' };
      return { step: t.step, text: 'Deliver bales to the truck', sub: 'Stand on DELIVER', target: 'pad:deliver' };
    case S.CASH:
      if (ctx.mode === 'HARVEST') return { step: t.step, text: 'Back to farm', target: 'ui:back' };
      return { step: t.step, text: 'Collect your earnings', target: 'pad:cash' };
    case S.UPGRADE:
      if (ctx.mode === 'HARVEST') return { step: t.step, text: 'Back to farm to upgrade', target: 'ui:back' };
      if (ctx.upgradePanelOpen) {
        t.seenUpgradeInfo = true;
        return { step: t.step, text: 'Buy Blade Power', sub: 'Cuts faster with a bigger disc', target: null };
      }
      return { step: t.step, text: 'Upgrade at the workshop', sub: 'Blade Power costs 35', target: 'pad:upgrade' };
  }
  return null;
}
