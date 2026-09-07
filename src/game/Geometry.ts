/**
 * Pure geometry shared by the simulation and the renderer.
 *
 * No Three, no Rapier — the validator runs this exact code in Node.
 */

/**
 * The conveyor loop: a stadium (two semicircles + two straights) lying in the
 * XY plane and facing the player, parameterised by ARC LENGTH so a marble's
 * speed in units/second is honest all the way round.
 *
 * s = 0 is top centre, where the funnel throat feeds it, and s increases
 * clockwise — which puts the collection gate at exactly half a lap.
 */
export class LoopPath {
  readonly a: number;
  readonly R: number;
  readonly length: number;

  constructor(readonly cx: number, readonly cy: number, rx: number, ry: number) {
    this.R = ry;
    this.a = Math.max(0, rx - ry);
    this.length = 4 * this.a + 2 * Math.PI * this.R;
  }

  wrap(s: number) { const L = this.length; return ((s % L) + L) % L; }

  /** Shortest signed difference b - a around the loop, in (-L/2, L/2]. */
  delta(a: number, b: number) {
    const L = this.length;
    let d = this.wrap(b - a);
    if (d > L / 2) d -= L;
    return d;
  }

  point(s: number): { x: number; y: number; tx: number; ty: number } {
    const { a, R, cx, cy } = this;
    s = this.wrap(s);
    const arc = Math.PI * R;
    if (s < a) return { x: cx + s, y: cy + R, tx: 1, ty: 0 };
    s -= a;
    if (s < arc) {
      const th = Math.PI / 2 - s / R;
      return { x: cx + a + R * Math.cos(th), y: cy + R * Math.sin(th), tx: Math.sin(th), ty: -Math.cos(th) };
    }
    s -= arc;
    if (s < 2 * a) return { x: cx + a - s, y: cy - R, tx: -1, ty: 0 };
    s -= 2 * a;
    if (s < arc) {
      const th = -Math.PI / 2 - s / R;
      return { x: cx - a + R * Math.cos(th), y: cy + R * Math.sin(th), tx: Math.sin(th), ty: -Math.cos(th) };
    }
    s -= arc;
    return { x: cx - a + s, y: cy + R, tx: 1, ty: 0 };
  }

  /** Arc position closest to a world point. Coarse scan + refine; called rarely. */
  nearest(x: number, y: number): number {
    let best = 0, bestD = Infinity;
    const N = 96;
    for (let i = 0; i < N; i++) {
      const s = (i / N) * this.length;
      const p = this.point(s);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    let step = this.length / N;
    for (let it = 0; it < 5; it++) {
      step *= 0.5;
      for (const cand of [best - step, best + step]) {
        const p = this.point(cand);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) { bestD = d; best = this.wrap(cand); }
      }
    }
    return best;
  }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smoothstep = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
