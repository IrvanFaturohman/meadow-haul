// Pause / settings modal: audio buses, mute, quality, reduced motion, shake, reset save.

import type { QualityId, SettingsState } from '../core/GameState';
import { bindButton } from './HUD';

export interface SettingsCallbacks {
  onChange(s: SettingsState): void;
  onResume(): void;
  onReset(): void;
  onEnableAudio(): void;
  uiSound(k: 'click' | 'disabled'): void;
}

export class SettingsPanel {
  readonly scrim: HTMLDivElement;
  readonly modal: HTMLDivElement;
  private confirm: HTMLDivElement;
  private s: SettingsState;
  private open = false;
  private sliders: Record<'master' | 'sfx' | 'ambience' | 'music', { input: HTMLInputElement; val: HTMLSpanElement }>;
  private muteBtn: HTMLButtonElement;
  private motionBtn: HTMLButtonElement;
  private shakeBtn: HTMLButtonElement;
  private qualityBtns: Record<QualityId, HTMLButtonElement>;
  private audioRow: HTMLDivElement;
  private info: HTMLDivElement;

  constructor(root: HTMLElement, initial: SettingsState, cb: SettingsCallbacks) {
    this.s = { ...initial };
    this.scrim = document.createElement('div');
    this.scrim.className = 'scrim hidden';
    this.scrim.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.confirm.classList.contains('show')) cb.onResume();
    });
    this.modal = document.createElement('div');
    this.modal.className = 'modal ui';
    this.modal.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.modal.innerHTML = `<h2>Paused</h2>`;

    const mkSlider = (key: 'master' | 'sfx' | 'ambience' | 'music', label: string) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<label>${label}</label>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.setAttribute('aria-label', label);
      const val = document.createElement('span');
      val.className = 'val';
      input.addEventListener('input', () => {
        this.s[key] = Number(input.value) / 100;
        val.textContent = input.value;
        cb.onChange({ ...this.s });
      });
      row.append(input, val);
      this.modal.appendChild(row);
      return { input, val };
    };
    this.sliders = {
      master: mkSlider('master', 'Master'),
      sfx: mkSlider('sfx', 'Effects'),
      ambience: mkSlider('ambience', 'Ambience'),
      music: mkSlider('music', 'Music'),
    };

    const toggleRow = (label: string, fn: () => void) => {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<label>${label}</label>`;
      const wrap = document.createElement('div');
      wrap.className = 'toggle';
      const b = document.createElement('button');
      b.className = 'btn';
      bindButton(b, fn, (k) => cb.uiSound(k));
      wrap.appendChild(b);
      row.appendChild(wrap);
      this.modal.appendChild(row);
      return b;
    };
    this.muteBtn = toggleRow('Sound', () => {
      this.s.muted = !this.s.muted;
      this.sync();
      cb.onChange({ ...this.s });
    });

    const qRow = document.createElement('div');
    qRow.className = 'set-row';
    qRow.innerHTML = '<label>Quality</label>';
    const seg = document.createElement('div');
    seg.className = 'seg';
    const qb = (q: QualityId, label: string) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      bindButton(b, () => {
        this.s.quality = q;
        this.sync();
        cb.onChange({ ...this.s });
      }, (k) => cb.uiSound(k));
      seg.appendChild(b);
      return b;
    };
    this.qualityBtns = { auto: qb('auto', 'Auto'), low: qb('low', 'Low'), medium: qb('medium', 'Med'), high: qb('high', 'High') };
    qRow.appendChild(seg);
    this.modal.appendChild(qRow);

    this.motionBtn = toggleRow('Motion', () => {
      this.s.reducedMotion = !this.s.reducedMotion;
      this.sync();
      cb.onChange({ ...this.s });
    });
    this.shakeBtn = toggleRow('Shake', () => {
      this.s.shake = !this.s.shake;
      this.sync();
      cb.onChange({ ...this.s });
    });

    this.audioRow = document.createElement('div');
    this.audioRow.className = 'set-row hidden';
    const ab = document.createElement('button');
    ab.className = 'btn cool';
    ab.style.flex = '1';
    ab.textContent = 'Enable audio';
    bindButton(ab, () => cb.onEnableAudio(), (k) => cb.uiSound(k));
    this.audioRow.appendChild(ab);
    this.modal.appendChild(this.audioRow);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const reset = document.createElement('button');
    reset.className = 'btn danger';
    reset.textContent = 'Reset save';
    bindButton(reset, () => this.showConfirm(true), (k) => cb.uiSound(k));
    const resume = document.createElement('button');
    resume.className = 'btn warm';
    resume.textContent = 'Resume';
    bindButton(resume, () => cb.onResume(), (k) => cb.uiSound(k));
    actions.append(reset, resume);
    this.modal.appendChild(actions);

    this.info = document.createElement('div');
    this.info.className = 'help';
    this.modal.appendChild(this.info);

    // Confirmation dialog for destructive reset.
    this.confirm = document.createElement('div');
    this.confirm.className = 'modal ui';
    this.confirm.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.confirm.innerHTML = `<h2>Reset save?</h2><div class="help" style="font-size:14px;opacity:.85">This erases your farm, money and upgrades. Audio and graphics settings are kept. This can't be undone.</div>`;
    const cActions = document.createElement('div');
    cActions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    bindButton(cancel, () => this.showConfirm(false), (k) => cb.uiSound(k));
    const yes = document.createElement('button');
    yes.className = 'btn warm';
    yes.textContent = 'Erase & restart';
    bindButton(yes, () => {
      this.showConfirm(false);
      cb.onReset();
    }, (k) => cb.uiSound(k));
    cActions.append(cancel, yes);
    this.confirm.appendChild(cActions);

    root.append(this.scrim, this.modal, this.confirm);
    this.sync();
  }

  private showConfirm(on: boolean): void {
    this.confirm.classList.toggle('show', on);
    this.modal.classList.toggle('show', !on && this.open);
  }

  setInfo(html: string): void {
    this.info.innerHTML = html;
  }

  setAudioNeeded(on: boolean): void {
    this.audioRow.classList.toggle('hidden', !on);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get confirming(): boolean {
    return this.confirm.classList.contains('show');
  }

  cancelConfirm(): void {
    this.showConfirm(false);
  }

  show(s: SettingsState): void {
    this.s = { ...s };
    this.sync();
    this.open = true;
    this.scrim.classList.remove('hidden');
    requestAnimationFrame(() => {
      if (!this.open) return;
      this.scrim.classList.add('show');
      this.modal.classList.add('show');
    });
  }

  hide(): void {
    this.open = false;
    this.confirm.classList.remove('show');
    this.scrim.classList.remove('show');
    this.modal.classList.remove('show');
    setTimeout(() => {
      if (!this.open) this.scrim.classList.add('hidden');
    }, 200);
  }

  private sync(): void {
    for (const k of ['master', 'sfx', 'ambience', 'music'] as const) {
      const v = Math.round(this.s[k] * 100);
      this.sliders[k].input.value = String(v);
      this.sliders[k].val.textContent = String(v);
    }
    this.muteBtn.textContent = this.s.muted ? 'Muted' : 'On';
    this.muteBtn.className = `btn ${this.s.muted ? '' : 'green'}`;
    this.motionBtn.textContent = this.s.reducedMotion ? 'Reduced' : 'Full';
    this.motionBtn.className = `btn ${this.s.reducedMotion ? '' : 'green'}`;
    this.shakeBtn.textContent = this.s.shake ? 'On' : 'Off';
    this.shakeBtn.className = `btn ${this.s.shake ? 'green' : ''}`;
    for (const [q, b] of Object.entries(this.qualityBtns)) b.classList.toggle('on', q === this.s.quality);
  }
}
