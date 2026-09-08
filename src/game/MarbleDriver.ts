import { HALF_W, LAYOUT, TUNING } from '../config/GameConfig';

export interface Vec3 { x: number; y: number; z: number }

/**
 * How a falling marble moves. Injected into GameModel so the SAME game logic
 * runs under two bodies: Rapier in the browser, and a cheap analytic one in
 * Node for `npm run validate`.
 *
 * Everything above this interface — chambers, dependencies, belt, receivers,
 * win/fail — is identical in both, which is what makes a headless solvability
 * proof mean something about the real game.
 */
export interface MarbleDriver {
  spawn(id: number, p: Vec3, v: Vec3): void;
  /** Add velocity to a body. Used to shove a marble off a ledge. */
  nudge(id: number, v: Vec3): void;
  step(dtSec: number): void;
  /** Write the current position into `out`. Returns false if the body is gone. */
  read(id: number, out: Vec3): boolean;
  despawn(id: number): void;
  reset(): void;
  readonly activeCount: number;
}

interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/**
 * Headless fallback: gravity, the same funnel assist and the same containment
 * as the real driver, but no marble-to-marble collision. Trajectories differ in
 * detail from Rapier's; arrival TIMING and the guarantee that everything lands
 * are what the validator actually asserts, and those hold in both.
 */
export class ScriptedDriver implements MarbleDriver {
  private bodies = new Map<number, Body>();
  get activeCount() { return this.bodies.size; }

  spawn(id: number, p: Vec3, v: Vec3) {
    this.bodies.set(id, { x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z });
  }
  despawn(id: number) { this.bodies.delete(id); }
  reset() { this.bodies.clear(); }

  nudge(id: number, v: Vec3) {
    const b = this.bodies.get(id);
    if (!b) return;
    b.vx += v.x; b.vy += v.y; b.vz += v.z;
  }

  read(id: number, out: Vec3) {
    const b = this.bodies.get(id);
    if (!b) return false;
    out.x = b.x; out.y = b.y; out.z = b.z;
    return true;
  }

  step(dt: number) {
    const r = TUNING.MARBLE_RADIUS;
    for (const b of this.bodies.values()) {
      b.vy += TUNING.MARBLE_GRAVITY * dt;
      applyAssists(b, dt);
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      if (sp > TUNING.MARBLE_MAX_SPEED) {
        const k = TUNING.MARBLE_MAX_SPEED / sp;
        b.vx *= k; b.vy *= k; b.vz *= k;
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      // Side walls — a marble may never leave the frame.
      const lim = HALF_W - r - 0.4;
      if (b.x < -lim) { b.x = -lim; b.vx = Math.abs(b.vx) * 0.4; }
      else if (b.x > lim) { b.x = lim; b.vx = -Math.abs(b.vx) * 0.4; }
    }
  }
}

/**
 * The invisible guides, shared by both drivers so headless timings stay honest.
 *
 * Physics here is spectacle, never a skill check: below the rack every marble is
 * steered toward the funnel throat and held in the front slab, so it cannot
 * miss the conveyor no matter how the collisions bounced it.
 */
export function applyAssists(b: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, dt: number) {
  // Pull into the front fall plane.
  const dz = LAYOUT.zFront - 0.8 - b.z;
  b.vz += dz * TUNING.SLAB_ASSIST_STRENGTH * dt;
  b.vz *= Math.exp(-4.5 * dt);

  // Steer toward the throat, gently high up and firmly near the mouth.
  if (b.y < LAYOUT.fallTop) {
    const depth = (LAYOUT.fallTop - b.y) / (LAYOUT.fallTop - LAYOUT.funnelBottom);
    const k = 0.30 + 0.70 * Math.min(1, Math.max(0, depth));
    const dx = -b.x;
    b.vx += Math.sign(dx) * Math.min(Math.abs(dx) * 5.5, TUNING.FUNNEL_ASSIST_STRENGTH) * k * dt;
    b.vx *= Math.exp(-2.2 * k * dt);
  }
}
