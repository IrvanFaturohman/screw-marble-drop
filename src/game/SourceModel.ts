/**
 * The screw sculpture: overlapping plates, structural screws, occlusion, and the
 * marble pockets embedded in it.
 *
 * Pure TypeScript — no Three, no Rapier — so the validator can prove the level
 * is solvable and that what covers a screw on screen is what blocks it in the
 * rules.
 *
 * Two deliberate choices:
 *
 *  - PLATE MOTION IS AUTHORED, NOT SIMULATED. A plate swings to an authored
 *    angle about an authored pivot over an authored duration. Rigid-body plates
 *    would make the puzzle's own state depend on a solver's mood; the marbles
 *    are where the physics belongs.
 *
 *  - ACCESSIBILITY IS A GRAPH, NOT A RAYCAST. A screw is blocked because a
 *    named plate is listed as covering it. The validator separately checks that
 *    the named plate GEOMETRICALLY covers it and that nothing else does at the
 *    moment it becomes legal, so the deterministic rule and the picture agree.
 */

import { LAYOUT, TUNING, type MarbleColor } from '../config/GameConfig';
import {
  pocketSlot, type LevelDef, type PlateDef, type PocketDef, type ScrewDef,
} from '../config/LevelConfig';
import { containsWorld, shapeBounds, shapeBoxRot, toLocal, toWorld, type PlateTransform } from './PlateShapes';
import { clamp, smoothstep } from './Geometry';

export type PlateState = 'fixed' | 'partial' | 'releasing' | 'gone';

const easeOutBack = (t: number) => {
  const c = 1.34;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

export class Screw {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly plateId: string;
  removed = false;
  /** 0..1 through the unscrew animation. */
  t = 0;
  unscrewing = false;

  constructor(def: ScrewDef) {
    this.id = def.id; this.x = def.x; this.y = def.y; this.plateId = def.plate;
  }
}

export class Plate {
  readonly def: PlateDef;
  readonly id: string;
  readonly z: number;
  state: PlateState = 'fixed';
  /** Live supports. */
  screws: Screw[] = [];
  initialSupports: number;

  /** Current pose. `angle` is about (pivotX, pivotY); dx/dy come after. */
  angle = 0; dx = 0; dy = 0; dz = 0;
  pivotX: number; pivotY: number;
  /** View-only: how far it has tipped toward the camera. */
  tip = 0;
  alpha = 1;
  /** 0..1 through the current transition. */
  t = 0;
  private targetAngle = 0;
  private fallVY = 0;

  constructor(def: PlateDef) {
    this.def = def;
    this.id = def.id;
    this.z = def.z;
    this.initialSupports = 0;
    this.pivotX = def.x; this.pivotY = def.y;
  }

  get transform(): PlateTransform {
    return {
      x: this.def.x, y: this.def.y, rot: this.def.rot ?? 0,
      pivotX: this.pivotX, pivotY: this.pivotY,
      angle: this.angle, dx: this.dx, dy: this.dy,
    };
  }
  /** Unscrewed, but still pinned under a plank above it. */
  loose = false;
  get supports() { return this.screws.length; }
  get present() { return this.state !== 'gone'; }
  /** Far enough through its partial swing that whatever it covered is clear. */
  get movedOff() {
    if (this.state === 'gone' || this.state === 'releasing') return true;
    return this.state === 'partial' && this.t >= 0.6;
  }

  containsWorld(wx: number, wy: number, pad = 0) {
    return containsWorld(this.def.shape, this.transform, wx, wy, pad);
  }

  /** Local point on the plate -> its current world position. */
  localToWorld(lx: number, ly: number) {
    return toWorld(this.transform, lx, ly);
  }

  // --------------------------------------------------------------- motion --
  /**
   * One support gone: the stick now hangs on the survivor.
   *
   * GRAVITY picks the direction, not the level file. Torque about the pin is
   * -g*(cx - px), so the side of the pivot the mass sits on is the side that
   * drops: pull the LEFT screw of a two-screw stick and its left end swings
   * DOWN about the right one. `partialDeg` is therefore a magnitude — an
   * authored sign here produced a stick that swung UP when the wrong screw was
   * pulled, which is the one thing a screw puzzle can never do.
   */
  beginPartial(anchor: Screw) {
    this.state = 'partial';
    this.t = 0;
    this.pivotX = anchor.x; this.pivotY = anchor.y;
    const mag = Math.abs(this.def.partialDeg ?? 30);
    const dx = this.def.x - anchor.x;
    // Centre directly over the pin is the balanced case — nothing decides it,
    // so fall back to the authored sign rather than freezing mid-puzzle.
    const dir = Math.abs(dx) < 0.05 ? Math.sign(this.def.partialDeg ?? 1) || 1 : -Math.sign(dx);
    this.targetAngle = (dir * mag * Math.PI) / 180;
  }

  beginRelease() {
    this.state = 'releasing';
    this.t = 0;
    const d = this.def;
    if (d.release === 'swingOpen') {
      const p = d.releasePivot ?? (this.screws[0] ? { x: this.screws[0].x, y: this.screws[0].y } : { x: d.x, y: d.y });
      this.pivotX = p.x; this.pivotY = p.y;
      this.targetAngle = this.angle + ((d.releaseDeg ?? -90) * Math.PI) / 180;
    } else if (d.release === 'fallAway') {
      this.targetAngle = this.angle + ((d.releaseDeg ?? 34) * Math.PI) / 180;
      this.fallVY = 0;
    } else if (d.release === 'tipForward') {
      this.targetAngle = this.angle;
    }
  }

  step(dt: number) {
    const ms = dt * 1000;
    if (this.state === 'partial') {
      if (this.t >= 1) return;
      this.t = Math.min(1, this.t + ms / TUNING.PLATE_PARTIAL_MS);
      this.angle = this.targetAngle * easeOutBack(this.t);
      return;
    }
    if (this.state !== 'releasing') return;

    this.t = Math.min(1.6, this.t + ms / TUNING.PLATE_RELEASE_MS);
    const d = this.def;
    const e = smoothstep(Math.min(1, this.t));
    switch (d.release) {
      case 'swingOpen':
        this.angle = this.angle + (this.targetAngle - this.angle) * Math.min(1, ms / TUNING.PLATE_RELEASE_MS * 2.2);
        this.dz = 1.2 * e;
        break;
      case 'slideOut': {
        const dir = d.releaseDir ?? { x: -1, y: 0 };
        const n = Math.hypot(dir.x, dir.y) || 1;
        this.dx = (dir.x / n) * 26 * e;
        this.dy = (dir.y / n) * 26 * e;
        this.dz = 1.6 * e;
        break;
      }
      case 'tipForward':
        this.tip = Math.min(1, this.t) * 1.15;
        this.dz = 2.4 * e;
        break;
      case 'fallAway':
      default:
        // Falls FORWARD as well as down, so a dismantled plate leaves through
        // the front of the board instead of raining through the marbles.
        this.fallVY += TUNING.PLATE_FALL_GRAVITY * dt;
        this.dy += this.fallVY * dt;
        this.dx += (this.def.x - LAYOUT.structCX) * 0.35 * dt;
        this.dz += 22 * dt;
        this.angle += ((d.releaseDeg ?? 34) * Math.PI) / 180 * dt * 1.6;
        break;
    }
    // Fade out at the end of the move so nothing pops.
    this.alpha = 1 - clamp((this.t - 0.72) / 0.5, 0, 1);
    if (this.t >= 1.35 || this.alpha <= 0.01) { this.state = 'gone'; this.alpha = 0; }
  }
}

export class Pocket {
  readonly def: PocketDef;
  readonly id: string;
  readonly color: MarbleColor;
  readonly total: number;
  pending: number;
  open = false;
  releaseTimer = 0;
  /** Anchor in the plate's LOCAL frame, so it travels with the plate. */
  readonly lx: number;
  readonly ly: number;

  constructor(def: PocketDef, plate: Plate) {
    this.def = def; this.id = def.id; this.color = def.color;
    this.total = def.count; this.pending = def.count;
    // The anchor is authored in WORLD space; convert it into the plate's local
    // frame ONCE, at rest. Storing a world-space delta and then handing it to
    // localToWorld would apply the plate's tilt a second time, which put every
    // row on a tilted stick outside the stick.
    const [lx, ly] = toLocal(
      { x: plate.def.x, y: plate.def.y, rot: plate.def.rot ?? 0, pivotX: plate.def.x, pivotY: plate.def.y, angle: 0, dx: 0, dy: 0 },
      def.x, def.y,
    );
    this.lx = lx;
    this.ly = ly;
  }
  get drained() { return this.pending <= 0; }
}

export interface SourceEvents {
  onScrewOut?: (s: Screw, plate: Plate) => void;
  onPlatePartial?: (p: Plate) => void;
  onPlateRelease?: (p: Plate) => void;
  onPlateGone?: (p: Plate) => void;
  onPocketOpen?: (pk: Pocket) => void;
  onRelease?: (pk: Pocket, index: number, x: number, y: number, z: number) => void;
  onUnlocked?: (s: Screw) => void;
}

/** True when two planks share any board area at rest. */
export function platesTouch(a: Plate, b: Plate, steps = 44): boolean {
  const bb = shapeBoxRot(a.def.shape, a.def.rot ?? 0);
  for (let u = 0; u <= steps; u++) {
    for (let v = 0; v <= steps; v++) {
      const wx = a.def.x + bb.minX + ((bb.maxX - bb.minX) * u) / steps;
      const wy = a.def.y + bb.minY + ((bb.maxY - bb.minY) * v) / steps;
      if (containsWorld(a.def.shape, restOf(a), wx, wy) && containsWorld(b.def.shape, restOf(b), wx, wy)) return true;
    }
  }
  return false;
}

const restOf = (p: Plate) => ({
  x: p.def.x, y: p.def.y, rot: p.def.rot ?? 0,
  pivotX: p.def.x, pivotY: p.def.y, angle: 0, dx: 0, dy: 0,
});

export class SourceModel {
  readonly plates: Plate[] = [];
  readonly screws: Screw[] = [];
  readonly pockets: Pocket[] = [];
  readonly plateById = new Map<string, Plate>();
  readonly screwById = new Map<string, Screw>();
  /** Every plank a screw passes through — a joint screw holds more than one. */
  readonly platesByScrew = new Map<string, Plate[]>();
  /** Static overlap graph, from the rest poses. */
  readonly overlapsWith = new Map<string, Plate[]>();
  /** screwId -> plates that cover it, and whether a partial move clears them. */
  private blockers = new Map<string, { plate: Plate; atPartial: boolean }[]>();
  events: SourceEvents = {};
  revision = 0;
  private wasAccessible = new Set<string>();

  constructor(readonly level: LevelDef) {
    for (const d of level.plates) {
      const p = new Plate(d);
      this.plates.push(p);
      this.plateById.set(p.id, p);
    }
    for (const d of level.screws) {
      const s = new Screw(d);
      this.screws.push(s);
      this.screwById.set(s.id, s);
      this.blockers.set(s.id, []);
    }
    // WHICH SCREWS HOLD WHICH PLANK IS GEOMETRY, NOT A LIST.
    //
    // A screw passes through every plank it physically sits on — that is what a
    // screw is. Deriving it means a crossing can never be left unpinned in the
    // picture while the rules pretend it is held, and it makes the shared joint
    // automatic: one screw through two crossing planks holds both.
    for (const d of level.plates) {
      const plate = this.plateById.get(d.id)!;
      for (const s of this.screws) {
        if (!containsWorld(d.shape, restOf(plate), s.x, s.y, LAYOUT.screwR * 0.35)) continue;
        plate.screws.push(s);
        const held = this.platesByScrew.get(s.id);
        if (held) held.push(plate); else this.platesByScrew.set(s.id, [plate]);
      }
      plate.initialSupports = plate.screws.length;
      if (!plate.screws.length) throw new Error(`plank ${d.id} has no screw on it`);
    }
    this.buildOverlapGraph();
    for (const d of level.pockets) {
      const plate = this.plateById.get(d.plate);
      if (!plate) throw new Error(`pocket ${d.id} names unknown plate "${d.plate}"`);
      this.pockets.push(new Pocket(d, plate));
    }
    this.wasAccessible = new Set(this.accessible().map((s) => s.id));
  }

  private addBlocker(screwId: string, plate: Plate, atPartial: boolean) {
    const list = this.blockers.get(screwId);
    if (!list) throw new Error(`plate ${plate.id} blocks unknown screw "${screwId}"`);
    list.push({ plate, atPartial });
  }

  // ------------------------------------------------------------ accessibility

  /** Plates currently covering this screw's removal path. */
  activeBlockers(s: Screw): Plate[] {
    const out: Plate[] = [];
    for (const b of this.blockers.get(s.id) ?? []) {
      const cleared = b.atPartial ? b.plate.movedOff : b.plate.state === 'gone';
      if (!cleared) out.push(b.plate);
    }
    return out;
  }

  /**
   * Every screw on the board is tappable.
   *
   * A screw at a joint is driven through the TOPMOST plank at that point, so it
   * is always visible from above — there is no such thing as a buried screw on
   * a real board, and pretending otherwise is what made the old build unreadable.
   * The sequencing pressure comes from `trappedBy` instead: a plank with no
   * screws left still cannot move while another plank lies across it.
   */
  isAccessible(s: Screw): boolean {
    if (s.removed || s.unscrewing) return false;
    return (this.platesByScrew.get(s.id) ?? []).some((p) => p.present);
  }

  blockerOf(s: Screw): Plate | null { return this.activeBlockers(s)[0] ?? null; }

  accessible(): Screw[] { return this.screws.filter((s) => this.isAccessible(s)); }
  remaining(): Screw[] { return this.screws.filter((s) => !s.removed); }
  get marblesLeft() { return this.pockets.reduce((n, p) => n + p.pending, 0); }
  get allEmpty() { return this.pockets.every((p) => p.drained); }
  get platesLeft() { return this.plates.filter((p) => p.present).length; }

  // ------------------------------------------------------------------ input

  /** Begin unscrewing. False if this screw is not currently legal. */
  pull(s: Screw): boolean {
    if (!this.isAccessible(s)) return false;
    s.unscrewing = true;
    s.t = 0;
    this.revision++;
    return true;
  }

  /** Nearest legal screw to a world point, plus the blocked one if any. */
  pick(wx: number, wy: number, radius: number): { screw: Screw | null; blocked: Screw | null } {
    let best: Screw | null = null, bestD = Infinity;
    let blocked: Screw | null = null, blockedD = Infinity;
    for (const s of this.screws) {
      if (s.removed || s.unscrewing) continue;
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d > radius) continue;
      if (this.isAccessible(s)) { if (d < bestD) { bestD = d; best = s; } }
      else if (d < blockedD) { blockedD = d; blocked = s; }
    }
    return { screw: best, blocked: best ? null : blocked };
  }

  // ------------------------------------------------------------- simulation

  update(dt: number) {
    const ms = dt * 1000;

    for (const s of this.screws) {
      if (!s.unscrewing) continue;
      s.t = Math.min(1, s.t + ms / TUNING.UNSCREW_DURATION);
      if (s.t < 1) continue;
      s.unscrewing = false;
      s.removed = true;
      // A screw driven through a CROSSING holds every plank it passes through,
      // so pulling it releases all of them at once. That shared joint is the
      // whole reason a woven board is a puzzle rather than a list.
      const held = this.platesByScrew.get(s.id) ?? [];
      for (const plate of held) {
        const i = plate.screws.indexOf(s);
        if (i >= 0) plate.screws.splice(i, 1);
      }
      this.events.onScrewOut?.(s, this.plateById.get(s.plateId)!);
      for (const plate of held) this.reactTo(plate);
      this.revision++;
    }

    for (const p of this.plates) {
      const before = p.state;
      p.step(dt);
      if (before !== 'gone' && p.state === 'gone') {
        this.events.onPlateGone?.(p);
        this.releaseFreed();
        this.revision++;
      }
      if (before === 'fixed' && p.state === 'releasing') this.releaseFreed();
      if (p.state === 'partial' && p.t >= 0.6 && before === 'partial') this.revision++;
    }

    this.checkPockets();
    for (const pk of this.pockets) if (pk.open && pk.pending > 0) this.pour(pk, ms);
    this.checkUnlocks();
  }

  /**
   * Which present plank lies ACROSS this one, higher up the stack.
   *
   * Overlap is fixed geometry, computed once from the rest poses — planks only
   * ever move while they are leaving, and a leaving plank has already stopped
   * counting as something you are trapped under.
   */
  trappedBy(plate: Plate): Plate | null {
    for (const q of this.overlapsWith.get(plate.id) ?? []) {
      if (q.z > plate.z && q.state !== 'gone' && q.state !== 'releasing') return q;
    }
    return null;
  }

  /** A plate just lost a support. Authored behaviour, not a simulation. */
  private reactTo(plate: Plate) {
    if (plate.state === 'releasing' || plate.state === 'gone') return;
    if (plate.supports === 0) {
      // Unscrewed but pinned under something: it waits, visibly, and leaves the
      // moment whatever is lying on it does. That wait is the chain reaction.
      if (this.trappedBy(plate)) { plate.loose = true; return; }
      plate.loose = false;
      plate.beginRelease();
      this.events.onPlateRelease?.(plate);
      return;
    }
    if (plate.supports === 1 && plate.state === 'fixed' && plate.def.partial !== 'none'
        && !this.trappedBy(plate)) {
      plate.beginPartial(plate.screws[0]);
      this.events.onPlatePartial?.(plate);
    }
  }

  /** Something left the board: anything it was pinning may now be free. */
  private releaseFreed() {
    for (const p of this.plates) {
      if (!p.present || p.state === 'releasing') continue;
      if (p.supports > 0) continue;
      if (this.trappedBy(p)) continue;
      p.loose = false;
      p.beginRelease();
      this.events.onPlateRelease?.(p);
    }
  }

  /**
   * A pocket opens because the plate holding it physically moved — never
   * because a screw "belongs" to it.
   */
  private checkPockets() {
    for (const pk of this.pockets) {
      if (pk.open || pk.drained) continue;
      const plate = this.plateById.get(pk.def.plate)!;
      const ready = pk.def.releaseAt === 'partial'
        ? (plate.state === 'partial' ? plate.t >= 0.45 : plate.state === 'releasing' || plate.state === 'gone')
        : (plate.state === 'releasing' ? plate.t >= 0.3 : plate.state === 'gone');
      if (!ready) continue;
      pk.open = true;
      this.events.onPocketOpen?.(pk);
    }
  }

  private pour(pk: Pocket, ms: number) {
    pk.releaseTimer -= ms;
    const plate = this.plateById.get(pk.def.plate)!;
    let guard = 0;
    while (pk.pending > 0 && pk.releaseTimer <= 0 && guard++ < 20) {
      const index = pk.total - pk.pending;
      const slot = pocketSlot(pk.def, index);
      const [wx, wy] = plate.localToWorld(pk.lx + slot.dx, pk.ly + slot.dy);
      this.events.onRelease?.(pk, index, wx, wy, plate.z);
      pk.pending--;
      pk.releaseTimer += TUNING.BATCH_RELEASE_INTERVAL;
    }
  }

  private checkUnlocks() {
    const now = new Set(this.accessible().map((s) => s.id));
    for (const id of now) {
      if (!this.wasAccessible.has(id)) {
        const s = this.screwById.get(id)!;
        this.events.onUnlocked?.(s);
      }
    }
    this.wasAccessible = now;
  }

  // ------------------------------------------------------------------ debug

  /**
   * Which planks physically lie across which, sampled once from the rest poses.
   * `containsWorld` on a rounded bar is exact enough that a grid this fine never
   * misses a real crossing — and `npm run validate` re-derives it independently.
   */
  private buildOverlapGraph() {
    for (const p of this.plates) this.overlapsWith.set(p.id, []);
    for (let i = 0; i < this.plates.length; i++) {
      for (let j = i + 1; j < this.plates.length; j++) {
        const a = this.plates[i], b = this.plates[j];
        if (!platesTouch(a, b)) continue;
        this.overlapsWith.get(a.id)!.push(b);
        this.overlapsWith.get(b.id)!.push(a);
      }
    }
  }

  /** Which plates geometrically cover this screw right now, front of its own. */
  coveringPlates(s: Screw): Plate[] {
    const own = this.plateById.get(s.plateId);
    const ownZ = own ? own.z : -Infinity;
    const pad = LAYOUT.screwR * 0.5;
    return this.plates.filter((p) => p.present && p.z > ownZ && p.containsWorld(s.x, s.y, pad));
  }

  /** Force a pocket open — debug key M. */
  debugOpenPocket(pk: Pocket) {
    const plate = this.plateById.get(pk.def.plate)!;
    if (plate.state === 'fixed') { plate.beginRelease(); this.events.onPlateRelease?.(plate); }
    pk.open = true;
    this.events.onPocketOpen?.(pk);
  }

  static bounds(p: Plate) { return shapeBounds(p.def.shape); }
}
