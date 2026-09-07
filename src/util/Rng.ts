/**
 * Seeded PRNG (mulberry32). The structure and screw physics run on THIS, never
 * Math.random, for two reasons the brief calls for directly:
 *
 *   1. "deterministic enough for a puzzle game" — the same taps in the same
 *      order always produce the same collapse, so a level can be authored and
 *      tuned against a known outcome.
 *   2. the headless validator can prove properties about flights and solvability
 *      that actually hold on the phone.
 *
 * Cosmetic-only jitter (belt vibration, particles) may still use Math.random —
 * it cannot change an outcome.
 */
export class Rng {
  private s: number;
  constructor(seed = 0x5cd15eed) { this.s = seed >>> 0; }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number) { return a + this.next() * (b - a); }
  /** Uniform in [-a, a). */
  spread(a: number) { return this.range(-a, a); }
  /** -1 or +1. */
  sign() { return this.next() < 0.5 ? -1 : 1; }
  reset(seed = 0x5cd15eed) { this.s = seed >>> 0; }
}
