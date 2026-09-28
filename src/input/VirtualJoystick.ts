// Floating virtual joystick: a touch (or mouse drag) on empty game space spawns the stick
// at the contact point. Pointer capture + pointer-id tracking keep a second finger on a
// button from interfering; cancel/blur/visibility changes always release it.

export interface StickValue {
  /** Screen-space, right positive. */
  x: number;
  /** Screen-space, up positive. */
  y: number;
  /** Curved magnitude 0..1. */
  mag: number;
}

export class VirtualJoystick {
  private surface: HTMLElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private cx = 0;
  private cy = 0;
  radius = 52;
  deadZone = 0.12;
  enabled = true;
  readonly value: StickValue = { x: 0, y: 0, mag: 0 };
  onStart: ((pointerType: string) => void) | null = null;

  constructor(surface: HTMLElement, overlay: HTMLElement) {
    this.surface = surface;
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    overlay.appendChild(this.base);

    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMove);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('lostpointercapture', this.onUp);
    this.calibrate();
  }

  /** Radius ≈ 46–60 CSS px, calibrated for a 390 px wide screen. */
  calibrate(): void {
    const r = this.surface.getBoundingClientRect();
    const w = Math.max(1, Math.min(r.width, r.height * 0.75));
    this.radius = Math.round(Math.max(46, Math.min(60, (w / 390) * 52)));
    this.base.style.setProperty('--joy-r', `${this.radius}px`);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Only start on the game surface itself, never on UI (UI stops propagation anyway).
    if (e.target !== this.surface) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* capture can fail on synthetic events */
    }
    const r = this.surface.getBoundingClientRect();
    this.ox = this.cx = e.clientX - r.left;
    this.oy = this.cy = e.clientY - r.top;
    this.base.classList.add('on');
    this.layout();
    this.onStart?.(e.pointerType);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const r = this.surface.getBoundingClientRect();
    this.cx = e.clientX - r.left;
    this.cy = e.clientY - r.top;
    // Float: drag the base along when the finger goes past the rim.
    const dx = this.cx - this.ox;
    const dy = this.cy - this.oy;
    const d = Math.hypot(dx, dy);
    const max = this.radius * 1.15;
    if (d > max) {
      this.ox = this.cx - (dx / d) * max;
      this.oy = this.cy - (dy / d) * max;
    }
    this.layout();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  };

  release(): void {
    if (this.pointerId !== null) {
      try {
        if (this.surface.hasPointerCapture(this.pointerId)) this.surface.releasePointerCapture(this.pointerId);
      } catch {
        /* ignore */
      }
    }
    this.pointerId = null;
    this.value.x = 0;
    this.value.y = 0;
    this.value.mag = 0;
    this.base.classList.remove('on');
  }

  private layout(): void {
    const dx = this.cx - this.ox;
    const dy = this.cy - this.oy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / this.radius);
    const nx = d > 0 ? dx / d : 0;
    const ny = d > 0 ? dy / d : 0;
    let mag = 0;
    if (m > this.deadZone) {
      const t = (m - this.deadZone) / (1 - this.deadZone);
      mag = Math.min(1, 0.12 + 0.88 * Math.pow(t, 1.25));
    }
    this.value.x = nx * mag;
    this.value.y = -ny * mag;
    this.value.mag = mag;
    this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
    this.knob.style.transform = `translate(${nx * m * this.radius}px, ${ny * m * this.radius}px)`;
  }
}
