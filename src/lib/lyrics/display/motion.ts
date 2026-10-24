/**
 * The Compose motion the Android lyrics use, as time-based maths so it reads the same at any refresh
 * rate. Springs follow Compose's SpringSimulation (unit mass, exact step response per frame), the
 * fling Compose's exponential decay, and the specs Flow's MaterialExpressiveTheme gets from
 * MotionScheme.expressive() (material3 1.5.0-alpha26 ExpressiveMotionTokens).
 */

export interface SpringSpec {
  dampingRatio: number;
  stiffness: number;
}

export const DEFAULT_SPATIAL: SpringSpec = { dampingRatio: 0.8, stiffness: 380 };
export const SLOW_SPATIAL: SpringSpec = { dampingRatio: 0.8, stiffness: 200 };
export const DEFAULT_EFFECTS: SpringSpec = { dampingRatio: 1, stiffness: 1600 };
export const SLOW_EFFECTS: SpringSpec = { dampingRatio: 1, stiffness: 800 };
/** spring(Spring.DampingRatioLowBouncy, Spring.StiffnessLow), the karaoke line lift. */
export const LOW_BOUNCY_LOW: SpringSpec = { dampingRatio: 0.75, stiffness: 200 };

/** Compose's default visibility threshold for a Float animation. */
const DEFAULT_THRESHOLD = 0.01;

/** One animated value. `step` advances it by real elapsed time; it reports whether it still moves. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  /** Delay left before the spring starts toward a new target, for the row stagger. */
  private delayMs = 0;

  constructor(
    initial: number,
    public spec: SpringSpec,
    private readonly threshold = DEFAULT_THRESHOLD,
  ) {
    this.value = initial;
    this.target = initial;
  }

  get settled(): boolean {
    return this.delayMs <= 0 && this.value === this.target && this.velocity === 0;
  }

  animateTo(target: number, delayMs = 0, spec?: SpringSpec): void {
    if (spec) this.spec = spec;
    if (target === this.target && this.delayMs <= 0) return;
    this.target = target;
    this.delayMs = delayMs;
  }

  snapTo(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.delayMs = 0;
  }

  /** Advances by `dtMs`; true while the value is still moving or waiting to. */
  step(dtMs: number): boolean {
    if (this.settled) return false;
    if (this.delayMs > 0) {
      this.delayMs -= dtMs;
      if (this.delayMs > 0) return true;
      dtMs = -this.delayMs;
      this.delayMs = 0;
    }
    const t = dtMs / 1000;
    const { dampingRatio: zeta, stiffness } = this.spec;
    const omega = Math.sqrt(stiffness);
    const x0 = this.value - this.target;
    const v0 = this.velocity;
    let x: number;
    let v: number;
    if (zeta > 1) {
      const root = omega * Math.sqrt(zeta * zeta - 1);
      const gammaPlus = -zeta * omega + root;
      const gammaMinus = -zeta * omega - root;
      const coeffA = x0 - (gammaMinus * x0 - v0) / (gammaMinus - gammaPlus);
      const coeffB = (gammaMinus * x0 - v0) / (gammaMinus - gammaPlus);
      x = coeffA * Math.exp(gammaMinus * t) + coeffB * Math.exp(gammaPlus * t);
      v = coeffA * gammaMinus * Math.exp(gammaMinus * t) + coeffB * gammaPlus * Math.exp(gammaPlus * t);
    } else if (zeta === 1) {
      const r = -omega;
      const coeffA = x0;
      const coeffB = v0 + omega * x0;
      const decay = Math.exp(r * t);
      x = (coeffA + coeffB * t) * decay;
      v = (coeffA + coeffB * t) * decay * r + coeffB * decay;
    } else {
      const r = -zeta * omega;
      const damped = omega * Math.sqrt(1 - zeta * zeta);
      const cosCoeff = x0;
      const sinCoeff = (1 / damped) * (-r * x0 + v0);
      const decay = Math.exp(r * t);
      x = decay * (cosCoeff * Math.cos(damped * t) + sinCoeff * Math.sin(damped * t));
      v = x * r + decay * (-damped * cosCoeff * Math.sin(damped * t) + damped * sinCoeff * Math.cos(damped * t));
    }
    if (Math.abs(x) < this.threshold && Math.abs(v) < this.threshold * 10) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    this.value = this.target + x;
    this.velocity = v;
    return true;
  }
}

/** Compose's FastOutSlowInEasing, cubic-bezier(0.4, 0, 0.2, 1), the default easing of a tween. */
export function fastOutSlowIn(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.4;
  const x2 = 0.2;
  const curve = (s: number, a: number, b: number) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  let lo = 0;
  let hi = 1;
  let s = t;
  for (let i = 0; i < 20; i++) {
    const x = curve(s, x1, x2);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return curve(s, 0, 1);
}

/** A tween(duration, delay) toward a target, eased like Compose's default. */
export class Tween {
  value: number;
  private from: number;
  private to: number;
  private durationMs = 1;
  private delayMs = 0;
  private elapsedMs = 0;

  constructor(initial: number) {
    this.value = initial;
    this.from = initial;
    this.to = initial;
  }

  get target(): number {
    return this.to;
  }

  get settled(): boolean {
    return this.value === this.to;
  }

  animateTo(to: number, durationMs: number, delayMs = 0): void {
    if (to === this.to) return;
    this.from = this.value;
    this.to = to;
    this.durationMs = Math.max(1, durationMs);
    this.delayMs = delayMs;
    this.elapsedMs = 0;
  }

  snapTo(value: number): void {
    this.value = value;
    this.from = value;
    this.to = value;
  }

  step(dtMs: number): boolean {
    if (this.settled) return false;
    this.elapsedMs += dtMs;
    const t = (this.elapsedMs - this.delayMs) / this.durationMs;
    if (t <= 0) return true;
    if (t >= 1) {
      this.value = this.to;
      return false;
    }
    this.value = this.from + (this.to - this.from) * fastOutSlowIn(t);
    return true;
  }
}

const DECAY_FRICTION = -4.2;
const DECAY_VELOCITY_THRESHOLD = 0.1;

/** Compose's exponentialDecay(frictionMultiplier): where a fling is `elapsedMs` after release. */
export class Fling {
  private readonly friction: number;
  private elapsedMs = 0;

  constructor(
    private readonly start: number,
    private readonly velocity: number,
    frictionMultiplier: number,
  ) {
    this.friction = DECAY_FRICTION * Math.max(0.0001, frictionMultiplier);
  }

  /** The position after another `dtMs`, and whether the fling still moves. */
  step(dtMs: number): { value: number; moving: boolean } {
    this.elapsedMs += dtMs;
    const t = this.elapsedMs / 1000;
    const value = this.start - this.velocity / this.friction + (this.velocity / this.friction) * Math.exp(this.friction * t);
    const speed = Math.abs(this.velocity * Math.exp(this.friction * t));
    return { value, moving: speed > DECAY_VELOCITY_THRESHOLD };
  }
}

/** How far the lift has travelled `elapsedMs` after a word starts: an underdamped spring's step response. */
export function wordLiftProgress(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const t = elapsedMs / 1000;
  const zeta = 0.55;
  const omega = (2 * Math.PI) / 0.42;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(damped * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(damped * t));
}
