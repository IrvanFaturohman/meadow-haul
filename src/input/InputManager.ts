// Combines the virtual joystick and keyboard into one screen-space move vector plus
// discrete actions. `enabled = false` (modals, transitions) zeroes movement at the source.

import { VirtualJoystick } from './VirtualJoystick';

export interface InputActions {
  tool1: () => void;
  tool2: () => void;
  toggleTool: () => void;
  interact: () => void;
  escape: () => void;
  desktopDetected: () => void;
  firstGesture: () => void;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class InputManager {
  readonly joystick: VirtualJoystick;
  private keys = new Set<string>();
  private kx = 0;
  private ky = 0;
  private _enabled = true;
  private desktop = false;
  private gestured = false;
  readonly move = { x: 0, y: 0, mag: 0 };

  constructor(
    surface: HTMLElement,
    overlay: HTMLElement,
    private actions: InputActions,
  ) {
    this.joystick = new VirtualJoystick(surface, overlay);
    this.joystick.onStart = (type) => {
      if (type === 'mouse') this.markDesktop();
      this.markGesture();
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
    window.addEventListener('orientationchange', this.reset);
    window.addEventListener('pointerdown', this.onAnyPointer, { capture: true });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    this.joystick.enabled = v;
    if (!v) this.joystick.release();
  }

  get isDesktop(): boolean {
    return this.desktop;
  }

  private onAnyPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.markDesktop();
    this.markGesture();
  };

  private markDesktop(): void {
    if (this.desktop) return;
    this.desktop = true;
    this.actions.desktopDetected();
  }

  private markGesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.actions.firstGesture();
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e) && e.code !== 'Escape') return;
    this.markDesktop();
    this.markGesture();
    if (MOVE_KEYS[e.code]) {
      this.keys.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'Digit1':
      case 'Numpad1':
        this.actions.tool1();
        break;
      case 'Digit2':
      case 'Numpad2':
        this.actions.tool2();
        break;
      case 'Space':
        e.preventDefault();
        this.actions.toggleTool();
        break;
      case 'KeyE':
        this.actions.interact();
        break;
      case 'Escape':
        this.actions.escape();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** Clears held keys and the stick — used on blur, tab switch, orientation change. */
  reset = () => {
    this.keys.clear();
    this.joystick.release();
    this.kx = this.ky = 0;
  };

  update(): void {
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const v = MOVE_KEYS[k];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    const l = Math.hypot(x, y);
    // Keyboard ramps slightly so taps feel analog-ish but still immediate.
    this.kx = l > 0 ? x / l : 0;
    this.ky = l > 0 ? y / l : 0;
    if (!this._enabled) {
      this.move.x = this.move.y = this.move.mag = 0;
      return;
    }
    const j = this.joystick.value;
    if (this.joystick.active && j.mag > 0) {
      this.move.x = j.x;
      this.move.y = j.y;
      this.move.mag = j.mag;
    } else if (l > 0) {
      this.move.x = this.kx;
      this.move.y = this.ky;
      this.move.mag = 1;
    } else {
      this.move.x = this.move.y = this.move.mag = 0;
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.reset);
    window.removeEventListener('orientationchange', this.reset);
  }
}
