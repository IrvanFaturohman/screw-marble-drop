/**
 * The whole game as data.
 *
 * Wires the one causal chain the design is about:
 *
 *   tap screw -> screw backs out -> gate tips -> WHOLE BATCH pours
 *      -> marbles fall, collide, funnel -> shared conveyor
 *      -> exposed receivers auto-collect fast (tik tik tik SNAP)
 *      -> box closes -> next colour exposed -> belt re-checked
 *      -> marbles that were stuck suddenly drain
 *      -> the opened gate uncovers the screw below it
 *
 * Neither Three nor Rapier appears here. `GameScene` renders this; the
 * validator plays it headlessly with a scripted driver. Both run the identical
 * simulation.
 */

import { HALF_W, LAYOUT, TUNING, type MarbleColor } from '../config/GameConfig';
import type { LevelDef } from '../config/LevelConfig';
import { SourceModel, type Plate, type Pocket, type Screw } from './SourceModel';
import { SortingModel, type BeltMarble, type Receiver } from './SortingModel';
import { ScriptedDriver, type MarbleDriver, type Vec3 } from './MarbleDriver';
import { Rng } from '../util/Rng';
import { clamp, smoothstep } from './Geometry';

export type Phase = 'play' | 'won' | 'lost';

export type MarbleState = 'falling' | 'intake' | 'belt' | 'delivering' | 'socketed';

export interface Marble {
  id: number;
  color: MarbleColor;
  state: MarbleState;
  x: number; y: number; z: number;
  spin: number;
  age: number;
  /** intake easing */
  t: number;
  /** ms this marble has spent effectively stationary while falling. */
  stillMs: number;
  lastX: number; lastY: number;
  fromX: number; fromY: number; fromZ: number;
  /** Chamber it came from, for effects. */
  origin: string;
  /** Receiver it was delivered into, so it can leave with the box. */
  receiverId: string;
}

export interface GameEvents {
  onTap?: (s: Screw) => void;
  onBlockedTap?: (s: Screw, blocker: Plate | null) => void;
  onScrewOut?: (s: Screw, plate: Plate) => void;
  onPlatePartial?: (p: Plate) => void;
  onPlateRelease?: (p: Plate) => void;
  onPlateGone?: (p: Plate) => void;
  onPocketOpen?: (pk: Pocket) => void;
  onRelease?: (pk: Pocket, m: Marble) => void;
  onUnlocked?: (s: Screw) => void;
  onMarbleLanded?: (m: Marble) => void;
  onDispatch?: (m: BeltMarble, r: Receiver, socket: number) => void;
  onSocketFilled?: (r: Receiver, socket: number) => void;
  onReceiverComplete?: (r: Receiver) => void;
  onReceiverExposed?: (r: Receiver) => void;
  /** A marble reached a full belt and had to queue. Pressure, not death. */
  onBeltFull?: (color: MarbleColor) => void;
  onWin?: () => void;
  onLose?: () => void;
}

/** Marbles are captured onto the belt just above the loop's top straight. */
const CAPTURE_Y = LAYOUT.loopCY + LAYOUT.loopRY + 1.3;

export class GameModel {
  readonly source: SourceModel;
  readonly sorting: SortingModel;
  readonly driver: MarbleDriver;
  readonly rng: Rng;

  /** Every marble outside a chamber, in id order. */
  readonly marbles: Marble[] = [];
  private byId = new Map<number, Marble>();
  private nextId = 1;
  private scratch: Vec3 = { x: 0, y: 0, z: 0 };

  events: GameEvents = {};
  phase: Phase = 'play';
  elapsed = 0;
  taps = 0;
  private completing: { r: Receiver; t: number }[] = [];

  constructor(readonly level: LevelDef, driver?: MarbleDriver, seed?: number) {
    this.rng = new Rng(seed);
    this.driver = driver ?? new ScriptedDriver();
    this.source = new SourceModel(level);
    this.sorting = new SortingModel(level.receiverStacks);

    // Own every sub-model event, then re-emit. Internal bookkeeping runs first,
    // so a view handler can never pre-empt it.
    this.source.events.onScrewOut = (s, p) => this.events.onScrewOut?.(s, p);
    this.source.events.onPlatePartial = (p) => this.events.onPlatePartial?.(p);
    this.source.events.onPlateRelease = (p) => this.events.onPlateRelease?.(p);
    this.source.events.onPlateGone = (p) => this.events.onPlateGone?.(p);
    this.source.events.onPocketOpen = (pk) => this.events.onPocketOpen?.(pk);
    this.source.events.onUnlocked = (s) => this.events.onUnlocked?.(s);
    this.source.events.onRelease = (pk, i, x, y, z) => this.spawnMarble(pk, i, x, y, z);

    this.sorting.events.onReceiverComplete = (r) => {
      this.completing.push({ r, t: TUNING.RECEIVER_COMPLETE_DELAY + TUNING.RECEIVER_SWAP_DURATION });
      this.events.onReceiverComplete?.(r);
    };
    // A refused marble is not a failure — it waits. See `checkEnd`.
    this.sorting.events.onRefused = (c) => this.events.onBeltFull?.(c);
    this.sorting.events.onDispatch = (m, r, i) => this.events.onDispatch?.(m, r, i);
    this.sorting.events.onSocketFilled = (r, i) => this.events.onSocketFilled?.(r, i);
    this.sorting.events.onReceiverExposed = (r) => this.events.onReceiverExposed?.(r);
  }

  // ------------------------------------------------------------------- input

  /** The game's only verb: tap a screw. */
  tap(wx: number, wy: number): { hit: Screw | null; blocked: Screw | null } {
    if (this.phase !== 'play') return { hit: null, blocked: null };
    const { screw, blocked } = this.source.pick(wx, wy, LAYOUT.screwR * 2.6);
    if (blocked) {
      this.events.onBlockedTap?.(blocked, this.source.blockerOf(blocked));
      return { hit: null, blocked };
    }
    if (!screw) return { hit: null, blocked: null };
    this.pull(screw);
    return { hit: screw, blocked: null };
  }

  /** Programmatic pull (debug harness + validator). */
  pull(s: Screw): boolean {
    if (this.phase !== 'play') return false;
    if (!this.source.pull(s)) return false;
    this.taps++;
    this.events.onTap?.(s);
    return true;
  }

  // -------------------------------------------------------------- simulation

  update(dtMs: number) {
    const scaled = dtMs * TUNING.GAME_SPEED;
    // Fixed sub-steps keep collisions stable at 4x debug speed and on a 120Hz
    // screen alike, and give the validator a deterministic march.
    const step = 1000 / 120;
    let left = Math.min(scaled, 200);
    while (left > 0) {
      const h = Math.min(step, left);
      this.substep(h / 1000);
      left -= h;
    }
  }

  private substep(dt: number) {
    this.elapsed += dt * 1000;
    this.source.update(dt);
    this.driver.step(dt);
    this.stepMarbles(dt);
    this.sorting.update(dt);
    this.syncBelt();
    this.stepCompletions(dt);
    if (this.phase === 'play') this.checkEnd();
  }

  // ------------------------------------------------------------- marbles ---

  private spawnMarble(pk: Pocket, index: number, x: number, y: number, z: number) {
    const id = this.nextId++;
    const m: Marble = {
      id, color: pk.color, state: 'falling',
      x, y, z, spin: 0, age: 0, t: 0,
      stillMs: 0, lastX: x, lastY: y,
      fromX: x, fromY: y, fromZ: z, origin: pk.id, receiverId: '',
    };
    this.marbles.push(m);
    this.byId.set(id, m);

    // Every batch is thrown FORWARD out of the sculpture into the fall slab.
    // That is what stops a pocket high in the structure raining onto the plates
    // below it, and it is why the pour reads as a pour rather than a leak.
    // The launch differs by container so the five pocket types feel different:
    const spread = TUNING.BATCH_RELEASE_SPREAD;
    let vx = this.rng.spread(spread);
    let vy = -2 - this.rng.next() * 3;
    switch (pk.def.kind) {
      case 'hopper':        // straight down out of a bottom gate
        vx *= 0.45; vy = -7 - this.rng.next() * 3; break;
      case 'tray':          // tips and rolls off the low edge
        vx = this.rng.spread(spread * 0.7) + (x < LAYOUT.structCX ? -4 : 4);
        vy = -1 - this.rng.next() * 2; break;
      case 'rotatingCup':   // flung outward along the arm
        vx = (x < LAYOUT.structCX ? -1 : 1) * (5 + this.rng.next() * 4);
        vy = -1 - this.rng.next() * 3; break;
      case 'wedge':         // avalanches sideways as the wall leaves
        vx = (x < LAYOUT.structCX ? -1 : 1) * (3 + this.rng.next() * 5);
        vy = -3 - this.rng.next() * 3; break;
      case 'pocketBehind':  // simply loses its wall and spills forward
        vy = -2 - this.rng.next() * 2; break;
    }
    this.driver.spawn(id, { x, y, z }, { x: vx, y: vy, z: 7 + this.rng.next() * 4 });
    this.events.onRelease?.(pk, m);
  }

  /** Marbles stacked above the belt entry this tick, waiting for a slot. */
  private queued = 0;

  private stepMarbles(dt: number) {
    this.queued = 0;
    const ms = dt * 1000;
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      m.age += ms;

      if (m.state === 'falling') {
        if (this.driver.read(m.id, this.scratch)) {
          m.x = this.scratch.x; m.y = this.scratch.y; m.z = this.scratch.z;
        }
        m.spin += dt * 7;

        // Anti-rest. A marble balanced on a guide or wedged in a corner would
        // otherwise sit there until the rescue timer teleported it, which reads
        // as the game freezing. Shove it toward the funnel instead.
        const moved = Math.hypot(m.x - m.lastX, m.y - m.lastY);
        m.lastX = m.x; m.lastY = m.y;
        if (moved < 0.035) {
          m.stillMs += ms;
          if (m.stillMs > TUNING.ANTI_REST_MS) {
            m.stillMs = 0;
            const imp = TUNING.ANTI_REST_IMPULSE;
            this.driver.nudge(m.id, {
              x: (m.x === 0 ? this.rng.sign() : -Math.sign(m.x)) * imp * 0.55 + this.rng.spread(imp * 0.3),
              y: -imp * 0.7,
              z: this.rng.spread(imp * 0.2),
            });
          }
        } else {
          m.stillMs = 0;
        }

        const rescued = m.age > TUNING.MARBLE_RESCUE_MS;
        if (m.y <= CAPTURE_Y || rescued) {
          this.driver.despawn(m.id);
          m.state = 'intake';
          m.t = 0;
          m.fromX = rescued ? m.x : m.x; m.fromY = rescued ? m.y : m.y; m.fromZ = m.z;
        }
        continue;
      }

      if (m.state === 'intake') {
        m.t = Math.min(1, m.t + ms / TUNING.CONVEYOR_INTAKE_MS);
        const p = this.sorting.path.point(0);
        const e = smoothstep(m.t);
        m.x = m.fromX + (p.x - m.fromX) * e;
        m.y = m.fromY + (p.y - m.fromY) * e;
        m.z = m.fromZ + (LAYOUT.beltZ - m.fromZ) * e;
        m.spin += dt * 6;
        if (m.t >= 1) {
          const b = this.sorting.admit(m.id, m.color, 0);
          if (b) {
            m.state = 'belt';
            this.events.onMarbleLanded?.(m);
          } else {
            // BELT FULL — STACK UP, do not disappear.
            //
            // The marble keeps trying every tick, so the moment a matching box
            // pulls one off the ring the whole stack drops in behind it. It has
            // to READ as a backlog, so they pile two abreast and touching, the
            // way marbles actually queue in a chute — a single ball hovering in
            // the gap said nothing about how close to full the belt was.
            const k = this.queued++;
            const row = Math.floor(k / 2);
            const d = TUNING.MARBLE_RADIUS * 2;
            m.x = p.x + (k % 2 ? d * 0.5 : -d * 0.5);
            // Rows nest into each other's gaps, so the column looks packed.
            m.y = p.y + d * 0.95 + row * d * 0.88;
            m.z = LAYOUT.beltZ;
          }
        }
        continue;
      }

      if (m.state === 'delivering') {
        // Position is written by syncBelt from the delivery record.
        continue;
      }
    }
  }

  /** Copy belt/delivery positions onto the marble objects the renderer reads. */
  private syncBelt() {
    for (const b of this.sorting.belt) {
      const m = this.byId.get(b.id);
      if (!m) continue;
      const p = this.sorting.path.point(b.s);
      m.state = 'belt';
      m.x = p.x; m.y = p.y; m.z = LAYOUT.beltZ;
      m.spin = b.spin;
    }
    for (const d of this.sorting.deliveries) {
      const m = this.byId.get(d.marble.id);
      if (!m) continue;
      m.state = 'delivering';
      m.receiverId = d.receiver.id;
      const t = clamp(d.t, 0, 1);
      const e = smoothstep(t);
      m.x = d.fromX + (d.toX - d.fromX) * e;
      m.y = d.fromY + (d.toY - d.fromY) * e - Math.sin(Math.PI * t) * 2.2;
      m.z = d.toZ * e;
      m.spin += 0.25;
    }
    // Anything that finished delivering is now sitting in a socket.
    for (const m of this.marbles) {
      if (m.state !== 'delivering') continue;
      if (!this.sorting.deliveries.some((d) => d.marble.id === m.id)) m.state = 'socketed';
    }
  }

  private removeMarble(index: number) {
    const m = this.marbles[index];
    this.marbles.splice(index, 1);
    this.byId.delete(m.id);
  }

  private stepCompletions(dt: number) {
    for (let i = this.completing.length - 1; i >= 0; i--) {
      const c = this.completing[i];
      c.t -= dt * 1000;
      if (c.t > 0) continue;
      this.completing.splice(i, 1);
      this.sorting.advanceColumn(c.r);
      // The marbles go with the box. Leaving them behind was leaving three
      // spheres hanging in mid-air where a receiver used to be.
      for (let k = this.marbles.length - 1; k >= 0; k--) {
        if (this.marbles[k].receiverId === c.r.id) this.removeMarble(k);
      }
    }
  }

  // ------------------------------------------------------------- end states

  /** Full belt with nothing on it that can leave. */
  get jammed() { return this.sorting.jammed; }

  get airborne() { return this.marbles.filter((m) => m.state === 'falling' || m.state === 'intake').length; }

  /**
   * How long the belt has been jammed. A jam has to HOLD before it ends the
   * game: a single frame where nothing matches can be undone by a box finishing
   * a moment later, and the player deserves to watch the pile-up happen rather
   * than have it announced.
   */
  private jamMs = 0;

  private checkEnd() {
    // The board keeps simulating after a loss — marbles still in the air have
    // to land somewhere, and where they land is the pile. So a finished run
    // must never be re-decided.
    if (this.phase !== 'play') return;

    // A FULL BELT IS NOT A LOSS. Losing means the belt is full AND not one
    // colour on it has an open receiver — nothing can drain, so no box can
    // complete, so no new colour can ever appear. That is a dead end; a full
    // belt with a servable colour on it is just a tight spot.
    if (this.sorting.jammed) {
      this.jamMs += 1000 / 120;
      if (this.jamMs >= TUNING.JAM_GRACE_MS) return this.fail();
    } else {
      this.jamMs = 0;
    }
    if (
      this.source.allEmpty &&
      this.airborne === 0 &&
      this.sorting.idle &&
      this.sorting.allDone &&
      this.completing.length === 0
    ) {
      this.phase = 'won';
      this.events.onWin?.();
    }
  }

  private fail() {
    if (this.phase !== 'play') return;
    this.phase = 'lost';
    this.events.onLose?.();
  }

  // ------------------------------------------------------------------ debug

  debugClearConveyor() {
    for (const b of this.sorting.belt) {
      const i = this.marbles.findIndex((m) => m.id === b.id);
      if (i >= 0) this.removeMarble(i);
    }
    this.sorting.debugClear();
  }

  /** Park `n` marbles of a colour that currently has nowhere to go. */
  debugFillConveyor(n = TUNING.CONVEYOR_CAPACITY - 2) {
    const exposed = this.sorting.exposedColors();
    const dead = (['green', 'red', 'blue', 'yellow'] as MarbleColor[]).filter((c) => !exposed.has(c));
    const pool = dead.length ? dead : (['green'] as MarbleColor[]);
    let i = 0;
    while (this.sorting.load < n && i < 64) {
      const id = this.nextId++;
      const color = pool[i % pool.length];
      const s = this.sorting.path.wrap(i * TUNING.CONVEYOR_MIN_GAP * 1.35);
      const b = this.sorting.admit(id, color, s);
      if (!b) break;
      const p = this.sorting.path.point(b.s);
      const m: Marble = {
        id, color, state: 'belt', x: p.x, y: p.y, z: LAYOUT.beltZ,
        spin: 0, age: 0, t: 0, stillMs: 0, lastX: p.x, lastY: p.y,
        fromX: p.x, fromY: p.y, fromZ: 0, origin: 'debug', receiverId: '',
      };
      this.marbles.push(m); this.byId.set(id, m);
      i++;
    }
  }

  /** Snapshot for assertions and the console harness. */
  state() {
    return {
      phase: this.phase,
      taps: this.taps,
      screwsLeft: this.source.remaining().length,
      platesLeft: this.source.platesLeft,
      marblesInRack: this.source.marblesLeft,
      accessible: this.source.accessible().map((s) => s.id),
      airborne: this.airborne,
      belt: `${this.sorting.load}/${this.sorting.capacity}`,
      jammed: this.sorting.jammed,
      beltColors: this.sorting.belt.map((b) => b.color[0]).join(''),
      exposed: this.sorting.activeReceivers().map((r) => `${r.color}:${r.filled}/${TUNING.RECEIVER_CAPACITY}`),
      boxesLeft: this.sorting.boxesLeft,
    };
  }
}

export type { Plate, Pocket, Screw, Receiver, BeltMarble };
