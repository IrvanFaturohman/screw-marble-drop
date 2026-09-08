import RAPIER from '@dimforge/rapier3d-compat';
import { HALF_W, LAYOUT, TUNING } from '../config/GameConfig';
import type { LevelDef } from '../config/LevelConfig';
import { applyAssists, type MarbleDriver, type Vec3 } from '../game/MarbleDriver';

/**
 * Real 3D rigid-body marbles, on Rapier.
 *
 * The static scene is deliberately tiny — two funnel cheeks, three deflectors,
 * four containment walls. A batch of nine spheres colliding with each other on
 * the way down is where the spectacle comes from; a plinko field of pegs would
 * only make it less predictable, and the brief explicitly does not want one.
 *
 * The same `applyAssists` the headless driver uses runs here every step, so the
 * guarantee "no marble can miss the conveyor" is one rule with one
 * implementation rather than two that can disagree.
 */
export class RapierDriver implements MarbleDriver {
  private world: RAPIER.World;
  private bodies = new Map<number, RAPIER.RigidBody>();
  private tmp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

  get activeCount() { return this.bodies.size; }
  get physicsWorld() { return this.world; }

  static async create(level: LevelDef) {
    await RAPIER.init();
    return new RapierDriver(level);
  }

  private constructor(level: LevelDef) {
    this.world = new RAPIER.World({ x: 0, y: TUNING.MARBLE_GRAVITY, z: 0 });
    this.world.timestep = 1 / 120;
    this.buildStatics(level);
  }

  // ------------------------------------------------------------- the scene

  private fixedBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotZ = 0) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: 0, z: Math.sin(rotZ / 2), w: Math.cos(rotZ / 2) }),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.32).setFriction(0.3),
      body,
    );
    return body;
  }

  private buildStatics(level: LevelDef) {
    const zMid = (LAYOUT.zFront + LAYOUT.zBack) / 2;
    const zHalf = (LAYOUT.zFront - LAYOUT.zBack) / 2;

    // Containment: the play slab. A marble may never leave the frame.
    const wall = 2;
    this.fixedBox(-HALF_W - wall + 0.4, 0, zMid, wall, 60, zHalf + 4);
    this.fixedBox(HALF_W + wall - 0.4, 0, zMid, wall, 60, zHalf + 4);
    this.fixedBox(0, 0, LAYOUT.zBack - wall, HALF_W + 6, 60, wall);
    this.fixedBox(0, 0, LAYOUT.zFront + wall, HALF_W + 6, 60, wall);

    // Funnel cheeks: two long slabs narrowing to the throat.
    for (const side of [-1, 1]) {
      const x1 = side * LAYOUT.funnelMouthHalf, y1 = LAYOUT.funnelTop;
      const x2 = side * LAYOUT.funnelThroatHalf, y2 = LAYOUT.funnelBottom;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      this.fixedBox((x1 + x2) / 2, (y1 + y2) / 2, zMid, len / 2, 0.55, zHalf, ang);
    }

    // Authored deflectors. Three, not thirty.
    for (const g of level.guides) {
      this.fixedBox(g.x, g.y, g.z ?? LAYOUT.zFront - 0.8, g.w / 2, g.h / 2, (g.d ?? 3.0) / 2, g.rot);
    }
  }

  // ---------------------------------------------------------------- driver

  spawn(id: number, p: Vec3, v: Vec3) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setLinvel(v.x, v.y, v.z)
        .setLinearDamping(TUNING.MARBLE_LINEAR_DAMPING)
        .setAngularDamping(TUNING.MARBLE_ANGULAR_DAMPING)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(TUNING.MARBLE_RADIUS)
        .setRestitution(TUNING.MARBLE_RESTITUTION)
        .setFriction(TUNING.MARBLE_FRICTION)
        .setMass(TUNING.MARBLE_MASS),
      body,
    );
    this.bodies.set(id, body);
  }

  nudge(id: number, v: Vec3) {
    const b = this.bodies.get(id);
    if (!b) return;
    const cur = b.linvel();
    b.setLinvel({ x: cur.x + v.x, y: cur.y + v.y, z: cur.z + v.z }, true);
    b.wakeUp();
  }

  despawn(id: number) {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b);
    this.bodies.delete(id);
  }

  reset() {
    for (const b of this.bodies.values()) this.world.removeRigidBody(b);
    this.bodies.clear();
  }

  read(id: number, out: Vec3) {
    const b = this.bodies.get(id);
    if (!b) return false;
    const t = b.translation();
    out.x = t.x; out.y = t.y; out.z = t.z;
    return true;
  }

  step(dt: number) {
    this.world.gravity.y = TUNING.MARBLE_GRAVITY;
    for (const b of this.bodies.values()) {
      const t = b.translation();
      const v = b.linvel();
      this.tmp.x = t.x; this.tmp.y = t.y; this.tmp.z = t.z;
      this.tmp.vx = v.x; this.tmp.vy = v.y; this.tmp.vz = v.z;
      applyAssists(this.tmp, dt);
      // Clamp before writing back — a tunnelled marble is a lost marble.
      const sp = Math.hypot(this.tmp.vx, this.tmp.vy, this.tmp.vz);
      if (sp > TUNING.MARBLE_MAX_SPEED) {
        const k = TUNING.MARBLE_MAX_SPEED / sp;
        this.tmp.vx *= k; this.tmp.vy *= k; this.tmp.vz *= k;
      }
      b.setLinvel({ x: this.tmp.vx, y: this.tmp.vy, z: this.tmp.vz }, true);
    }
    this.world.timestep = dt;
    this.world.step();
  }
}
