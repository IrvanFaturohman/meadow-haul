// Development panel, only loaded with ?debug=1. Actions that change progress mark the
// save as debug-assisted (stats.debugUsed) so playtest numbers stay honest.

import * as THREE from 'three';
import type { Game } from '../core/Game';
import { JUICE, REACH, TUNING } from '../config/balance';
import { HOSE_ANCHOR } from '../config/worldLayout';
import { reachMetric } from '../gameplay/Reach';
import { conservedUnitsSnapshot } from './resourceAudit';
import type { SfxName } from '../audio/AudioManager';
import type { AudioBus } from '../audio/AudioManager';

const SFX: SfxName[] = ['cut', 'vacuumTick', 'toolSwap', 'pack', 'pickup', 'drop', 'cash', 'upgrade', 'levelUp', 'uiClick', 'uiDisabled', 'footstep', 'reachTap', 'full', 'replant', 'goal', 'transition', 'hire', 'truckLoad'];

export class DebugPanel {
  private el: HTMLDivElement;
  private stats: HTMLPreElement;
  private t = 0;
  private game: Game;
  private onFrame: () => void = () => {};

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'debug';
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.stats = document.createElement('pre');
    this.stats.style.margin = '0';
    this.el.appendChild(this.stats);
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      this.el.appendChild(b);
    };
    const warn = document.createElement('div');
    warn.className = 'warnlbl';
    warn.textContent = 'DEBUG — actions below mark the save as debug-assisted';
    this.el.appendChild(warn);
    btn('+100 coins', () => game.sim.debugAddMoney(100));
    btn('+1000 coins', () => game.sim.debugAddMoney(1000));
    btn('Cut whole field', () => game.sim.debugCutAll());
    btn('Replant', () => game.sim.startReplant());
    btn('Spawn bale M', () => game.sim.debugSpawnBale(0));
    btn('Spawn bale C', () => game.sim.debugSpawnBale(1));
    btn('Spawn bale G', () => game.sim.debugSpawnBale(2));
    btn('Save now', () => game.save());
    btn('Reset save', () => {
      localStorage.removeItem('meadow-haul.save.v1');
      location.reload();
    });
    const sfxRow = document.createElement('div');
    sfxRow.style.marginTop = '4px';
    sfxRow.textContent = 'SFX: ';
    const sel = document.createElement('select');
    for (const s of SFX) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    }
    sfxRow.appendChild(sel);
    const play = document.createElement('button');
    play.textContent = '▶';
    play.addEventListener('click', () => game.audio.play(sel.value as SfxName, { intensity: 8 }));
    sfxRow.appendChild(play);
    this.el.appendChild(sfxRow);
    const buses: AudioBus[] = ['sfx', 'ambience', 'music'];
    for (const b of buses) {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => game.audio.setBusMuted(b, cb.checked));
      l.append(cb, document.createTextNode(`mute ${b}`));
      this.el.appendChild(l);
    }
    const slider = (label: string, min: number, max: number, val: number, fn: (v: number) => void) => {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String((max - min) / 100);
      i.value = String(val);
      const v = document.createElement('span');
      v.textContent = val.toFixed(2);
      i.addEventListener('input', () => {
        v.textContent = Number(i.value).toFixed(2);
        fn(Number(i.value));
      });
      l.append(document.createTextNode(label), i, v);
      this.el.appendChild(l);
    };
    slider('sway', 0, 2, 1, (v) => (game.world.field.uniforms.uWind.value = v));
    slider('motion', 0, 1, game.world.motionScale, (v) => (game.world.motionScale = v));
    slider('shake', 0, 0.3, JUICE.shakeAmp, (v) => (JUICE.shakeAmp = v));
    slider('vac×', 0.25, 4, TUNING.vacuumIntakeMul, (v) => {
      TUNING.vacuumIntakeMul = v;
      game.state.stats.debugUsed = true;
    });
    slider('price×', 0.25, 4, TUNING.priceMul, (v) => {
      TUNING.priceMul = v;
      game.state.stats.debugUsed = true;
    });
    // Visual overlays: full reach circle and field chunk bounds.
    const overlay = new THREE.Group();
    overlay.visible = false;
    game.world.scene.add(overlay);
    // Reach boundary for reach = 1 (the metric is homogeneous, so it scales uniformly).
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const d = reachMetric(dx, dz);
      pts.push(new THREE.Vector3(dx / d, 0, dz / d));
    }
    const reachRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ff5a5a', depthTest: false }));
    reachRing.position.set(HOSE_ANCHOR.x, 0.06, HOSE_ANCHOR.z);
    reachRing.renderOrder = 9;
    overlay.add(reachRing);
    game.world.field.group.traverse((o) => {
      const m = o as THREE.InstancedMesh;
      if (m.isInstancedMesh && m.boundingBox) overlay.add(new THREE.Box3Helper(m.boundingBox, new THREE.Color('#ffd35a')));
    });
    this.onFrame = () => {
      const r = REACH.length(game.state.upgrades.reach);
      reachRing.scale.set(r, 1, r);
    };
    btn('Toggle reach/chunks', () => (overlay.visible = !overlay.visible));
    root.appendChild(this.el);
  }

  update(dt: number): void {
    this.onFrame();
    this.t += dt;
    if (this.t < 0.25) return;
    this.t = 0;
    const g = this.game;
    const s = g.state;
    const r = g.sim.rt;
    const c = conservedUnitsSnapshot(s);
    const st = g.debugStats();
    this.stats.textContent = [
      `fps ${st.fps} (${st.frameMs} ms) q=${st.quality}`,
      `calls ${st.calls} tris ${st.triangles}`,
      `geo ${st.geometries} tex ${st.textures} particles ${st.particles} flights ${st.flights}`,
      `mode ${st.mode} tool ${g.sim.toolState}`,
      `units: stand ${c.standing} loose ${c.loose} raw ${c.raw}`,
      `  depot ${c.depot} carry ${c.carry} hauler ${c.hauler} sold ${c.sold}`,
      `  total ${c.total} / planted ${s.stats.unitsPlanted} ${c.total === s.stats.unitsPlanted ? 'OK' : 'MISMATCH'}`,
      `wallet ${(s.walletCents / 100).toFixed(2)} pending ${(s.pendingCashCents / 100).toFixed(2)}`,
      `upg B${s.upgrades.blade} V${s.upgrades.vacuum} R${s.upgrades.reach} C${s.upgrades.carry} H${s.hauler.level}`,
      `truck ${s.truck.state} ${s.truck.cargo.length} · hauler ${s.hauler.state}`,
      `contacts ${r.bladeContacts.toFixed(1)} vac ${r.vacuumRate.toFixed(1)}/s`,
      `audio ${JSON.stringify(g.audio.getDebugInfo())}`,
      `debugUsed ${s.stats.debugUsed} play ${Math.round(s.stats.playSeconds)}s`,
    ].join('\n');
  }
}
