// DOM HUD: top bar, tool buttons, carry meter, coach bubble, toasts, floating
// text, flying coins, world-anchored labels and the off-screen tutorial arrow.
// Every DOM write is guarded so nothing is rebuilt per frame.

import { formatMoney } from '../gameplay/Economy';
import type { GoalView } from '../gameplay/Goals';
import type { TutorialView } from '../gameplay/Tutorial';
import type { ToolId } from '../core/GameState';
import { TIER_COLORS } from '../config/palette';
import { ICONS } from './icons';

export interface HudCallbacks {
  onTool(tool: ToolId): void;
  onBack(): void;
  onSettings(): void;
  onReplant(): void;
  onPackLeftovers(): void;
  onEnableAudio(): void;
  uiSound(kind: 'click' | 'disabled'): void;
}

export interface HudView {
  walletCents: number;
  level: number;
  xp: number;
  xpToNext: number;
  tool: ToolId;
  switching: boolean;
  tierName: string | null;
  tierIndex: number;
  carry: number;
  carryCap: number;
  replantAvailable: boolean;
  replantReason: string | null;
  replantSuggest: boolean;
  replanting: boolean;
  /** Hide the replant button until the player has harvested something. */
  replantVisible: boolean;
}

export type HudMode = 'TITLE' | 'FARM' | 'HARVEST' | 'TRANSITION' | 'MODAL' | 'PANEL';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Makes a button respond on press (for responsiveness) without letting the press reach the game. */
export function bindButton(b: HTMLElement, fn: () => void, sound?: (kind: 'click' | 'disabled') => void): void {
  let lock = false;
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    b.classList.add('pressed');
  });
  const up = () => b.classList.remove('pressed');
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (lock) return;
    lock = true;
    // Guards against double-activation from rapid taps.
    setTimeout(() => (lock = false), 180);
    const disabled = b.classList.contains('disabled') || (b as HTMLButtonElement).disabled;
    sound?.(disabled ? 'disabled' : 'click');
    fn();
  });
}

interface FloatItem {
  el: HTMLDivElement;
  t: number;
  dur: number;
  x: number;
  y: number;
  active: boolean;
}

interface CoinItem {
  el: HTMLDivElement;
  t: number;
  dur: number;
  x0: number;
  y0: number;
  active: boolean;
  delay: number;
}

interface WorldLabel {
  el: HTMLDivElement;
  text: string;
  cls: string;
  visible: boolean;
  width: number;
}

export class HUD {
  readonly root: HTMLElement;
  private top: HTMLDivElement;
  private moneyPill: HTMLDivElement;
  private moneyVal: HTMLSpanElement;
  private levelNum: HTMLDivElement;
  private xpFill: HTMLElement;
  private coach: HTMLDivElement;
  private coachT: HTMLDivElement;
  private coachS: HTMLDivElement;
  private tierChip: HTMLDivElement;
  private carryPill: HTMLDivElement;
  private carryText: HTMLSpanElement;
  private harvestBar: HTMLDivElement;
  private farmBar: HTMLDivElement;
  private bladeBtn: HTMLButtonElement;
  private vacBtn: HTMLButtonElement;
  private backBtn: HTMLButtonElement;
  private replantBtn: HTMLButtonElement;
  private replantSub: HTMLElement;
  private packBtn: HTMLButtonElement;
  private kbdHint: HTMLDivElement;
  private dragHint: HTMLDivElement;
  private toastWrap: HTMLDivElement;
  private floatLayer: HTMLDivElement;
  private labelLayer: HTMLDivElement;
  private edge: HTMLDivElement;
  private audioBtn: HTMLButtonElement;
  private floats: FloatItem[] = [];
  private coins: CoinItem[] = [];
  private labels = new Map<string, WorldLabel>();
  private toastCooldown = new Map<string, number>();
  private time = 0;
  private shownMoney = 0;
  private moneyFrom = 0;
  private moneyTo = 0;
  private moneyT = 1;
  private cache: Record<string, string | number | boolean> = {};
  private mode: HudMode = 'TITLE';
  private desktop = false;
  private tutorialTarget: string | null = null;
  private viewW = 390;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    this.root = root;

    this.labelLayer = el('div', 'layer');
    root.appendChild(this.labelLayer);

    // Top bar
    this.top = el('div', 'hud-top');
    this.moneyPill = el('div', 'pill money');
    this.moneyPill.innerHTML = ICONS.coin;
    this.moneyVal = el('span', 'val', '0');
    this.moneyPill.appendChild(this.moneyVal);
    const lvl = el('div', 'level-badge');
    this.levelNum = el('div', 'lv', '1');
    const xpbar = el('div', 'xpbar');
    this.xpFill = el('i');
    xpbar.appendChild(this.xpFill);
    lvl.append(this.levelNum, xpbar);
    const spacer = el('div', 'grow');
    const settings = el('button', 'btn icon-btn ui', ICONS.settings);
    settings.setAttribute('aria-label', 'Settings');
    bindButton(settings, () => cb.onSettings(), cb.uiSound);
    this.top.append(this.moneyPill, lvl, spacer, settings);
    root.appendChild(this.top);

    // Coach / goal bubble
    this.coach = el('div', 'coach fade');
    this.coachT = el('div', 't');
    this.coachS = el('div', 's');
    this.coach.append(this.coachT, this.coachS);
    root.appendChild(this.coach);

    this.tierChip = el('div', 'tier-chip chip');
    root.appendChild(this.tierChip);

    // Carry pill (farm)
    this.carryPill = el('div', 'carry-pill');
    const cp = el('div', 'pill');
    cp.innerHTML = ICONS.carry;
    this.carryText = el('span', '', '0/6');
    cp.appendChild(this.carryText);
    this.carryPill.appendChild(cp);
    root.appendChild(this.carryPill);

    // Harvest bottom bar
    this.harvestBar = el('div', 'bottom');
    this.backBtn = el('button', 'btn back-btn ui', `${ICONS.barn}<span>FARM</span>`);
    this.backBtn.setAttribute('aria-label', 'Back to farm');
    bindButton(this.backBtn, () => cb.onBack(), cb.uiSound);
    const tools = el('div', 'tool-group');
    this.bladeBtn = el('button', 'btn tool-btn ui', `${ICONS.blade}<span>CUT</span><span class="key">1</span>`);
    this.vacBtn = el('button', 'btn tool-btn vac ui', `${ICONS.vacuum}<span>VACUUM</span><span class="key">2</span>`);
    this.bladeBtn.setAttribute('aria-label', 'Blade');
    this.vacBtn.setAttribute('aria-label', 'Vacuum');
    // Tools switch on press for responsiveness.
    for (const [b, t] of [
      [this.bladeBtn, 'BLADE'],
      [this.vacBtn, 'VACUUM'],
    ] as const) {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        b.classList.add('pressed');
        cb.onTool(t);
      });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // Keyboard activation (Enter/Space on focused button) arrives as click without pointerdown.
        if ((e as MouseEvent).detail === 0) cb.onTool(t);
      });
    }
    tools.append(this.bladeBtn, this.vacBtn);
    this.harvestBar.append(this.backBtn, tools);
    root.appendChild(this.harvestBar);

    // Farm bottom bar
    this.farmBar = el('div', 'bottom');
    const farmActions = el('div', 'farm-actions');
    this.replantBtn = el('button', 'btn replant-btn ui', `<span style="display:flex;align-items:center;gap:4px">${ICONS.sprout}REPLANT</span><small>free</small>`);
    this.replantSub = this.replantBtn.querySelector('small')!;
    bindButton(this.replantBtn, () => cb.onReplant(), cb.uiSound);
    this.packBtn = el('button', 'btn warm replant-btn ui hidden', `<span style="display:flex;align-items:center;gap:4px">${ICONS.bale}PACK</span><small>leftovers → mini-bales</small>`);
    bindButton(this.packBtn, () => cb.onPackLeftovers(), cb.uiSound);
    farmActions.append(this.replantBtn, this.packBtn);
    this.farmBar.append(farmActions, el('div'));
    root.appendChild(this.farmBar);

    this.kbdHint = el('div', 'kbd-hint hidden');
    root.appendChild(this.kbdHint);
    this.dragHint = el('div', 'drag-hint hidden', '<div class="dot"></div>');
    root.appendChild(this.dragHint);

    this.toastWrap = el('div', 'toast-wrap');
    root.appendChild(this.toastWrap);
    this.floatLayer = el('div', 'layer');
    root.appendChild(this.floatLayer);
    for (let i = 0; i < 14; i++) {
      const f = el('div', 'float-text');
      f.style.display = 'none';
      this.floatLayer.appendChild(f);
      this.floats.push({ el: f, t: 0, dur: 1, x: 0, y: 0, active: false });
    }
    for (let i = 0; i < 14; i++) {
      const c = el('div', 'float-coin', ICONS.coin);
      c.style.display = 'none';
      this.floatLayer.appendChild(c);
      this.coins.push({ el: c, t: 0, dur: 0.55, x0: 0, y0: 0, active: false, delay: 0 });
    }

    this.edge = el('div', 'edge-arrow hidden', ICONS.arrowUp);
    root.appendChild(this.edge);

    this.audioBtn = el('button', 'btn audio-btn ui hidden', `${ICONS.sound}<span>Enable audio</span>`);
    bindButton(this.audioBtn, () => cb.onEnableAudio());
    root.appendChild(this.audioBtn);

    this.setMode('TITLE');
  }

  setMode(mode: HudMode): void {
    this.mode = mode;
    const harvest = mode === 'HARVEST';
    const farm = mode === 'FARM';
    const playing = mode !== 'TITLE';
    this.top.classList.toggle('hidden', !playing);
    this.harvestBar.classList.toggle('hidden', !harvest);
    this.farmBar.classList.toggle('hidden', !farm);
    this.tierChip.classList.toggle('hidden', !harvest);
    this.labelLayer.classList.toggle('hidden', !playing || mode === 'MODAL');
    this.root.classList.toggle('hud-harvest', harvest);
    if (!farm) this.carryPill.classList.add('hidden');
    if (!playing) this.coach.classList.add('fade');
    this.refreshKbdHint();
  }

  setViewport(w: number): void {
    this.viewW = w;
    for (const l of this.labels.values()) l.width = 0;
  }

  setDesktop(on: boolean): void {
    this.desktop = on;
    this.refreshKbdHint();
  }

  private refreshKbdHint(): void {
    const show = this.desktop && (this.mode === 'HARVEST' || this.mode === 'FARM');
    this.kbdHint.classList.toggle('hidden', !show);
    if (!show) return;
    this.kbdHint.innerHTML =
      this.mode === 'HARVEST'
        ? '<b>WASD</b> move · <b>1</b>/<b>2</b>/<b>Space</b> tool · <b>E</b> farm · <b>Esc</b> pause'
        : '<b>WASD</b> move · <b>E</b> harvest (on pad) · <b>Esc</b> pause';
  }

  setPackButton(visible: boolean, units: number): void {
    if (this.set('pack', `${visible}|${units}`)) {
      this.packBtn.classList.toggle('hidden', !visible);
      this.packBtn.querySelector('small')!.textContent = `${units} leftover units → mini-bales`;
    }
  }

  setAudioButton(visible: boolean): void {
    this.audioBtn.classList.toggle('hidden', !visible);
  }

  private set(key: string, value: string | number | boolean): boolean {
    if (this.cache[key] === value) return false;
    this.cache[key] = value;
    return true;
  }

  update(v: HudView, dt: number): void {
    this.time += dt;
    // Money count-up (300–500 ms) on gains; spending shows immediately.
    if (v.walletCents !== this.moneyTo) {
      if (v.walletCents > this.moneyTo) {
        this.moneyFrom = this.shownMoney;
        this.moneyT = 0;
      } else {
        this.shownMoney = v.walletCents;
        this.moneyFrom = v.walletCents;
        this.moneyT = 1;
      }
      this.moneyTo = v.walletCents;
    }
    if (this.moneyT < 1) {
      this.moneyT = Math.min(1, this.moneyT + dt / 0.42);
      const k = 1 - Math.pow(1 - this.moneyT, 3);
      this.shownMoney = Math.round(this.moneyFrom + (this.moneyTo - this.moneyFrom) * k);
    } else {
      this.shownMoney = this.moneyTo;
    }
    const whole = this.moneyT >= 1 ? this.shownMoney : Math.floor(this.shownMoney / 100) * 100;
    if (this.set('money', whole)) this.moneyVal.textContent = formatMoney(whole);
    if (this.set('level', v.level)) {
      this.levelNum.textContent = String(v.level);
      this.levelNum.classList.remove('pop');
      void this.levelNum.offsetWidth;
      this.levelNum.classList.add('pop');
    }
    const xpPct = Math.round((v.xp / Math.max(1, v.xpToNext)) * 100);
    if (this.set('xp', xpPct)) this.xpFill.style.width = `${xpPct}%`;

    if (this.mode === 'HARVEST') {
      const tierKey = v.tierName ?? '';
      if (this.set('tier', tierKey)) {
        this.tierChip.classList.toggle('hidden', !v.tierName);
        if (v.tierName) this.tierChip.innerHTML = `<i style="background:${TIER_COLORS[v.tierIndex].ui}"></i>${v.tierName}`;
      }
      const toolKey = `${v.tool}${v.switching}`;
      if (this.set('tool', toolKey)) {
        this.bladeBtn.classList.toggle('active', v.tool === 'BLADE');
        this.vacBtn.classList.toggle('active', v.tool === 'VACUUM');
      }
    }
    if (this.mode === 'FARM') {
      const showCarry = v.carry > 0;
      if (this.set('carryShow', showCarry)) this.carryPill.classList.toggle('hidden', !showCarry);
      if (this.set('carry', `${v.carry}/${v.carryCap}`)) this.carryText.textContent = `${v.carry}/${v.carryCap}`;
      const full = v.carry >= v.carryCap;
      if (this.set('carryFull', full)) this.carryPill.classList.toggle('full', full);
      const rKey = `${v.replantAvailable}|${v.replantReason}|${v.replantSuggest}|${v.replanting}|${v.replantVisible}`;
      if (this.set('replant', rKey)) {
        this.replantBtn.classList.toggle('hidden', !v.replantVisible);
        this.replantBtn.classList.toggle('disabled', !v.replantAvailable);
        this.replantBtn.classList.toggle('green', v.replantAvailable);
        this.replantBtn.classList.toggle('suggest', v.replantSuggest && v.replantAvailable);
        this.replantSub.textContent = v.replanting ? 'growing…' : v.replantAvailable ? 'free · regrow field' : v.replantReason ?? '';
      }
    }

    this.updateFloats(dt);
    this.updateCoins(dt);
  }

  // ---- Coach / tutorial / goals --------------------------------------------------------

  setCoach(tut: TutorialView | null, goal: GoalView | null, extra: { text: string; sub?: string } | null): void {
    let t = '';
    let s = '';
    let isGoal = false;
    if (tut) {
      t = tut.text;
      s = tut.sub ?? '';
    } else if (extra) {
      t = extra.text;
      s = extra.sub ?? '';
    } else if (goal) {
      t = goal.text;
      s = goal.progress ?? '';
      isGoal = true;
    }
    const key = `${t}|${s}|${isGoal}|${this.mode}`;
    if (!this.set('coach', key)) return;
    const hide = !t || this.mode === 'TITLE' || this.mode === 'MODAL';
    this.coach.classList.toggle('fade', hide);
    this.coach.classList.toggle('goal', isGoal);
    if (isGoal) {
      this.coach.innerHTML = `<span class="flag">${ICONS.flag}</span><div><div class="t"></div><div class="s"></div></div>`;
      this.coachT = this.coach.querySelector('.t')!;
      this.coachS = this.coach.querySelector('.s')!;
    } else if (!this.coach.querySelector(':scope > .t')) {
      this.coach.innerHTML = '';
      this.coachT = el('div', 't');
      this.coachS = el('div', 's');
      this.coach.append(this.coachT, this.coachS);
    }
    this.coachT.textContent = t;
    this.coachS.textContent = s;
    this.coachS.style.display = s ? '' : 'none';
    // UI highlight targets
    const target = tut?.target ?? null;
    if (target !== this.tutorialTarget) {
      this.tutorialTarget = target;
      this.vacBtn.classList.toggle('tut-ring', target === 'ui:vacuum');
      this.backBtn.classList.toggle('tut-ring', target === 'ui:back');
    }
    this.dragHint.classList.toggle('hidden', !(target === 'ui:joystick' && this.mode === 'HARVEST'));
  }

  hideDragHint(): void {
    this.dragHint.classList.add('hidden');
  }

  /** Off-screen pointer toward a world target (screen coords in CSS px), or null to hide. */
  setEdgeArrow(p: { x: number; y: number; angle: number } | null): void {
    if (!p) {
      if (this.set('edge', false)) this.edge.classList.add('hidden');
      return;
    }
    if (this.set('edge', true)) this.edge.classList.remove('hidden');
    this.edge.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.angle}rad)`;
  }

  // ---- Toasts, float text, coins -------------------------------------------------------

  toast(text: string, kind: 'info' | 'warn' | 'good' = 'info', key = text, cooldown = 2.5): void {
    const until = this.toastCooldown.get(key) ?? -1;
    if (this.time < until) return;
    this.toastCooldown.set(key, this.time + cooldown);
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const t = el('div', `toast ${kind === 'info' ? '' : kind}`, '');
    t.textContent = text;
    this.toastWrap.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1700);
    setTimeout(() => t.remove(), 2000);
  }

  floatText(text: string, x: number, y: number, cls = ''): void {
    const f = this.floats.find((q) => !q.active) ?? this.floats[0];
    f.active = true;
    f.t = 0;
    f.dur = 0.9;
    f.x = x;
    f.y = y;
    f.el.className = `float-text ${cls}`;
    f.el.textContent = text;
    f.el.style.display = '';
  }

  private updateFloats(dt: number): void {
    for (const f of this.floats) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      const y = f.y - 46 * (1 - Math.pow(1 - k, 2));
      const s = k < 0.15 ? 0.7 + k * 2.2 : 1;
      f.el.style.transform = `translate(${f.x}px, ${y}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
      f.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }

  /** Coins fly from a screen point to the money pill; count-up happens as they land. */
  flyCoins(x: number, y: number, count: number): void {
    const n = Math.min(this.coins.length, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const c = this.coins.find((q) => !q.active);
      if (!c) return;
      c.active = true;
      c.t = 0;
      c.delay = i * 0.045;
      c.dur = 0.5 + Math.random() * 0.1;
      c.x0 = x + (Math.random() - 0.5) * 30;
      c.y0 = y + (Math.random() - 0.5) * 20;
      c.el.style.display = 'none';
    }
  }

  private updateCoins(dt: number): void {
    const frame = this.root.getBoundingClientRect();
    const pill = this.moneyPill.getBoundingClientRect();
    const tx = pill.left - frame.left + 20;
    const ty = pill.top - frame.top + 20;
    let landed = false;
    for (const c of this.coins) {
      if (!c.active) continue;
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k * k * (3 - 2 * k);
      const cx = (c.x0 + tx) / 2 + 40;
      const cy = Math.min(c.y0, ty) - 60;
      const x = (1 - e) * (1 - e) * c.x0 + 2 * (1 - e) * e * cx + e * e * tx;
      const y = (1 - e) * (1 - e) * c.y0 + 2 * (1 - e) * e * cy + e * e * ty;
      c.el.style.display = '';
      c.el.style.transform = `translate(${x}px, ${y}px) scale(${(1 - k * 0.3).toFixed(3)})`;
      if (k >= 1) {
        c.active = false;
        c.el.style.display = 'none';
        landed = true;
      }
    }
    if (landed) this.bump(this.moneyPill);
  }

  bump(e: HTMLElement): void {
    e.classList.remove('bounce');
    void e.offsetWidth;
    e.classList.add('bounce');
  }

  bumpCarry(): void {
    this.bump(this.carryPill);
  }

  bumpTool(tool: ToolId): void {
    this.bump(tool === 'BLADE' ? this.bladeBtn : this.vacBtn);
  }

  // ---- World labels --------------------------------------------------------------------

  label(key: string, text: string, cls: string, x: number, y: number, visible: boolean, html = false): void {
    let l = this.labels.get(key);
    if (!l) {
      const e = el('div', 'wlabel');
      this.labelLayer.appendChild(e);
      l = { el: e, text: '', cls: '', visible: true, width: 0 };
      this.labels.set(key, l);
    }
    if (l.visible !== visible) {
      l.visible = visible;
      l.el.style.display = visible ? '' : 'none';
    }
    if (!visible) return;
    if (l.text !== text) {
      l.text = text;
      l.width = 0;
      if (html) l.el.innerHTML = text;
      else l.el.textContent = text;
    }
    if (l.cls !== cls) {
      l.cls = cls;
      l.el.className = `wlabel ${cls}`;
      l.width = 0;
    }
    // Measure only when content changed; keep the label fully inside the frame.
    if (l.width === 0) l.width = l.el.offsetWidth;
    const half = l.width / 2 + 4;
    const cx = Math.max(half, Math.min(this.viewW - half, x));
    l.el.style.transform = `translate(${cx.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  labelElement(key: string): HTMLDivElement | null {
    return this.labels.get(key)?.el ?? null;
  }
}
