import './ui/styles.css';
import { Game } from './core/Game';

function fail(message: string): void {
  const frame = document.getElementById('frame');
  if (!frame) return;
  frame.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;color:#FFF1D2;font:800 16px ui-rounded,system-ui,sans-serif">${message}</div>`;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  fail('Meadow Haul needs WebGL. Please try a recent Chrome, Safari, Edge or Firefox.');
} else {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const frame = document.getElementById('frame') as HTMLElement;
  // QA helper: ?frame=390x844 forces an exact phone-sized frame on desktop.
  const forced = /^(\d{3,4})x(\d{3,4})$/.exec(new URLSearchParams(location.search).get('frame') ?? '');
  if (forced) frame.style.cssText = `width:${forced[1]}px;height:${forced[2]}px;flex:none;border-radius:0`;
  const game = new Game(frame, canvas);
  game.start();
  // Exposed for manual QA from the console (no gameplay cheats in the player HUD).
  (window as unknown as { meadow: Game }).meadow = game;
}
