// Bottom sheet with Machine / Farm tabs. Rows are built once; refresh() only touches
// text and classes that changed, so purchases update instantly without DOM rebuilds.

import { describeUpgrade, UPGRADE_ORDER, type UpgradeInfo, type UpgradeKey } from '../gameplay/UpgradeSystem';
import type { GameState } from '../core/GameState';
import { ICONS, type IconName } from './icons';
import { bindButton } from './HUD';

const ROW_ICON: Record<UpgradeKey, IconName> = {
  blade: 'blade',
  vacuum: 'vacuum',
  reach: 'hose',
  carry: 'carry',
  hauler: 'worker',
};

interface Row {
  key: UpgradeKey;
  root: HTMLDivElement;
  name: HTMLDivElement;
  stat: HTMLDivElement;
  dots: HTMLDivElement;
  buy: HTMLButtonElement;
  cacheKey: string;
}

export class UpgradePanel {
  readonly scrim: HTMLDivElement;
  readonly sheet: HTMLDivElement;
  private rows: Row[] = [];
  private tabBtns: Record<'machine' | 'farm', HTMLButtonElement>;
  private open = false;
  onBuy: (key: UpgradeKey) => void = () => {};
  onClose: () => void = () => {};
  uiSound: (k: 'click' | 'disabled') => void = () => {};

  constructor(root: HTMLElement) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'scrim hidden';
    this.scrim.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.onClose();
    });
    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet ui';
    this.sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.sheet.innerHTML = `
      <div class="sheet-head"><span style="width:34px;height:34px;display:inline-block">${ICONS.gear}</span><h2>Workshop</h2></div>
      <div class="tabs"></div>
      <div class="rows"></div>`;
    const close = document.createElement('button');
    close.className = 'btn icon-btn';
    close.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#263C33" stroke-width="3.2" stroke-linecap="round"/></svg>';
    close.setAttribute('aria-label', 'Close');
    bindButton(close, () => this.onClose(), (k) => this.uiSound(k));
    this.sheet.querySelector('.sheet-head')!.appendChild(close);

    const tabs = this.sheet.querySelector('.tabs')!;
    const mk = (id: 'machine' | 'farm', label: string) => {
      const b = document.createElement('button');
      b.className = 'btn tab';
      b.textContent = label;
      bindButton(b, () => this.setTab(id), (k) => this.uiSound(k));
      tabs.appendChild(b);
      return b;
    };
    this.tabBtns = { machine: mk('machine', 'Machine'), farm: mk('farm', 'Farm') };

    const rowsEl = this.sheet.querySelector('.rows')!;
    for (const key of UPGRADE_ORDER) {
      const r = document.createElement('div');
      r.className = 'urow';
      r.innerHTML = `<div class="uico">${ICONS[ROW_ICON[key]]}</div><div><div class="name"></div><div class="stat"></div><div class="blurb"></div><div class="lvl-dots"></div></div>`;
      const buy = document.createElement('button');
      buy.className = 'btn warm buy';
      r.appendChild(buy);
      bindButton(buy, () => this.onBuy(key), (k) => this.uiSound(k));
      rowsEl.appendChild(r);
      this.rows.push({
        key,
        root: r,
        name: r.querySelector('.name')!,
        stat: r.querySelector('.stat')!,
        dots: r.querySelector('.lvl-dots')!,
        buy,
        cacheKey: '',
      });
    }
    root.append(this.scrim, this.sheet);
    this.setTab('machine');
  }

  get isOpen(): boolean {
    return this.open;
  }

  setTab(t: 'machine' | 'farm'): void {
    this.tabBtns.machine.classList.toggle('on', t === 'machine');
    this.tabBtns.farm.classList.toggle('on', t === 'farm');
    for (const r of this.rows) r.root.classList.toggle('hidden', describeTab(r.key) !== t);
  }

  show(state: GameState, tab?: 'machine' | 'farm'): void {
    this.open = true;
    if (tab) this.setTab(tab);
    this.refresh(state);
    this.scrim.classList.remove('hidden');
    requestAnimationFrame(() => {
      // The panel may have been closed again before this frame (fast open/close).
      if (!this.open) return;
      this.scrim.classList.add('show');
      this.sheet.classList.add('show');
    });
  }

  hide(): void {
    this.open = false;
    this.scrim.classList.remove('show');
    this.sheet.classList.remove('show');
    setTimeout(() => {
      if (!this.open) this.scrim.classList.add('hidden');
    }, 200);
  }

  refresh(state: GameState): void {
    for (const r of this.rows) {
      const info = describeUpgrade(state, r.key);
      const afford = info.cost !== null && state.walletCents >= info.cost * 100;
      const locked = r.key === 'hauler' && !state.stats.firstSaleDone && state.hauler.level === 0;
      const key = `${info.level}|${info.cost}|${afford}|${locked}|${state.walletCents}`;
      if (key === r.cacheKey) continue;
      const levelChanged = r.cacheKey !== '' && !r.cacheKey.startsWith(`${info.level}|`);
      r.cacheKey = key;
      this.renderRow(r, info, afford, locked, state.walletCents);
      if (levelChanged) {
        r.root.classList.remove('pop');
        void r.root.offsetWidth;
        r.root.classList.add('pop');
      }
    }
  }

  private renderRow(r: Row, info: UpgradeInfo, afford: boolean, locked: boolean, wallet: number): void {
    const lvlText = info.key === 'hauler' ? (info.level === 0 ? '' : `Lv ${info.level}`) : `Lv ${info.level}`;
    r.name.innerHTML = `${info.name} <small>${lvlText}</small>`;
    r.stat.innerHTML = info.next ? `${info.current} → <b>${info.next}</b>` : `${info.current} · <b>MAX</b>`;
    (r.root.querySelector('.blurb') as HTMLElement).textContent = info.blurb;
    const total = info.maxLevel;
    let dots = '';
    for (let i = 1; i <= total; i++) dots += `<i class="${i <= info.level ? 'on' : ''}"></i>`;
    r.dots.innerHTML = dots;
    const b = r.buy;
    if (info.cost === null) {
      b.className = 'btn buy disabled';
      b.innerHTML = 'MAX';
    } else if (locked) {
      b.className = 'btn buy disabled';
      b.innerHTML = `${ICONS.lock}<small>after 1st sale</small>`;
    } else if (!afford) {
      const need = Math.ceil((info.cost * 100 - wallet) / 100);
      b.className = 'btn buy disabled';
      b.innerHTML = `<span style="display:flex;align-items:center;gap:3px">${ICONS.coin}${info.cost}</span><small>Need ${need} more</small>`;
    } else {
      b.className = 'btn warm buy';
      b.innerHTML = `<span style="display:flex;align-items:center;gap:3px">${ICONS.coin}${info.cost}</span><small>${info.key === 'hauler' && info.level === 0 ? 'HIRE' : 'BUY'}</small>`;
    }
  }

  /** Screen-space centre of a row's icon (for celebration effects). */
  rowRect(key: UpgradeKey): DOMRect | null {
    const r = this.rows.find((q) => q.key === key);
    return r ? r.root.getBoundingClientRect() : null;
  }
}

function describeTab(key: UpgradeKey): 'machine' | 'farm' {
  return key === 'blade' || key === 'vacuum' || key === 'reach' ? 'machine' : 'farm';
}
