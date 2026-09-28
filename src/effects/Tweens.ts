// Easing helpers and a critically-damped-ish spring for follow-through motion.

export const ease = {
  linear: (t: number) => t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
};

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(tau: number, dt: number): number {
  return 1 - Math.exp(-dt / Math.max(1e-4, tau));
}

export class Spring {
  value = 0;
  velocity = 0;
  target = 0;
  constructor(
    public stiffness = 120,
    public damping = 14,
  ) {}

  update(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += f * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  kick(v: number): void {
    this.velocity += v;
  }
}

/** Scale pop: 1 → peak → 1 over `dur` seconds. */
export function popScale(t: number, dur: number, peak: number): number {
  if (t >= dur || t < 0) return 1;
  const k = t / dur;
  if (k < 0.35) return 1 + (peak - 1) * ease.outCubic(k / 0.35);
  return 1 + (peak - 1) * (1 - ease.inOutCubic((k - 0.35) / 0.65));
}
