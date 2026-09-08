import * as THREE from 'three';
import { COLORS, LAYOUT, TUNING, type MarbleColor } from '../config/GameConfig';
import type { GameModel } from '../game/GameModel';
import type { Receiver, Reservoir } from '../game/SandModel';
import { Rng } from '../util/Rng';

/**
 * THE VISUAL SAND — a view of the volumes, never the source of them.
 *
 * Three things are drawn, and none of them can change a single unit of gameplay
 * volume:
 *
 *   GRAINS   a recycled pool of instanced quads. The flow network reports how
 *            much crossed a throat this tick; we emit however many grains that
 *            is worth and let them fall. Losing one loses nothing.
 *   MOUNDS   a cone per reservoir outlet whose height and width follow that
 *            reservoir's PILE volume. This is the accumulation the player is
 *            meant to read, and it is driven by the number, so it cannot lie.
 *   CHANNEL  coloured arcs around the oval, one per run of sand, sized by volume.
 *
 * Grains are deliberately small and numerous. A handful of big spheres reads as
 * marbles, which is the exact thing this revision exists to stop being.
 */

const MAX = TUNING.VISUAL_PARTICLE_COUNT;
/** Grains drawn for sand sitting in the channel. */
const CHANNEL_MAX = 340;
const CHANNEL_UNITS_PER_GRAIN = 0.9;

/** Deterministic 0..1 from an integer, so grains do not shimmer each frame. */
function hash01(n: number) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), x | 1) >>> 0;
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

interface Grain {
  live: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  color: MarbleColor;
  /** Seconds left before it is recycled regardless. */
  life: number;
  /** Grains headed for a receiver home in on it instead of falling free. */
  target: { x: number; y: number } | null;
}

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

export class SandView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;

  private grains: Grain[] = [];
  private cursor = 0;
  private rng = new Rng(0x5a4d);
  private mounds = new Map<string, THREE.Mesh>();
  private channelMesh: THREE.InstancedMesh;
  private channelCount = 0;
  private funnelMound: THREE.Mesh;
  /** Fractional grains owed, so a slow trickle still emits. */
  private owed = new Map<string, number>();

  constructor(private model: GameModel) {
    const geo = new THREE.PlaneGeometry(TUNING.VISUAL_PARTICLE_SIZE, TUNING.VISUAL_PARTICLE_SIZE);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX;
    for (let i = 0; i < MAX; i++) {
      this.grains.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, color: 'red', life: 0, target: null });
    }
    this.group.add(this.mesh);

    // A second pool for sand at REST in the channel. Separate from the falling
    // pool so a long queue can never starve the pour of grains.
    const cgeo = new THREE.PlaneGeometry(TUNING.VISUAL_PARTICLE_SIZE * 1.15, TUNING.VISUAL_PARTICLE_SIZE * 1.15);
    this.channelMesh = new THREE.InstancedMesh(cgeo, new THREE.MeshBasicMaterial({ toneMapped: false }), CHANNEL_MAX);
    this.channelMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHANNEL_MAX * 3), 3);
    this.channelMesh.frustumCulled = false;
    this.group.add(this.channelMesh);

    // One mound per reservoir outlet.
    for (const r of model.sand.reservoirs) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14), moundMat(r.color));
      m.visible = false;
      this.group.add(m);
      this.mounds.set(r.id, m);
    }

    // And one above the shared neck, where several streams meet.
    this.funnelMound = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), moundMat('red'));
    this.funnelMound.visible = false;
    this.group.add(this.funnelMound);

    this.hideAll();
  }

  // NO event wiring here. `model.events` slots are single-assignment, and Game
  // builds the views before it wires them — a listener installed here is
  // silently clobbered a moment later, which is exactly how this view ended up
  // drawing zero grains while the volumes flowed perfectly. Game owns the
  // wiring and calls the three methods below.

  /** Turn a volume into a whole number of grains, carrying the remainder. */
  private grainsFor(key: string, volume: number) {
    const owed = (this.owed.get(key) ?? 0) + volume / TUNING.UNITS_PER_GRAIN;
    const n = Math.floor(owed);
    this.owed.set(key, owed - n);
    return Math.min(n, 40);
  }

  /** Sand crossed a reservoir's throat. Draw that much falling. */
  emitThroat(r: Reservoir, volume: number) {
    const n = this.grainsFor(`t${r.id}`, volume);
    for (let i = 0; i < n; i++) {
      // Out of the narrow hole: tight horizontally, already moving down.
      this.spawn(
        r.outX + this.rng.spread(TUNING.MAIN_THROAT_WIDTH * 0.3),
        r.outY - 0.6,
        r.outZ + 1.2 + this.rng.spread(0.5),
        this.rng.spread(1.1), -5 - this.rng.next() * 4, 0,
        r.color, 3.2,
      );
    }
  }

  /** Sand crossed the shared neck into the channel. */
  emitNeck(color: MarbleColor, volume: number) {
    const n = this.grainsFor(`n${color}`, volume);
    for (let i = 0; i < n; i++) {
      this.spawn(
        this.rng.spread(TUNING.MAIN_THROAT_WIDTH * 0.55),
        LAYOUT.funnelBottom,
        LAYOUT.beltZ + this.rng.spread(0.4),
        this.rng.spread(2.2), -9 - this.rng.next() * 4, 0,
        color, 1.4,
      );
    }
  }

  /** Sand peeled off the channel toward a jar. */
  emitReceiver(rec: Receiver, volume: number) {
    const n = this.grainsFor(`r${rec.id}`, volume);
    if (!n) return;
    const to = receiverMouth(rec);
    for (let i = 0; i < n; i++) {
      const from = this.model.sand.path.point(this.model.sand.path.length * 0.5);
      const g = this.spawn(
        from.x + this.rng.spread(2.4), from.y, LAYOUT.beltZ,
        0, 0, 0, rec.color, 1.1,
      );
      if (g) g.target = to;
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
                color: MarbleColor, life: number): Grain | null {
    // Ring buffer: the oldest grain is always the one recycled, so a heavy pour
    // thins out gracefully instead of refusing to draw.
    for (let k = 0; k < MAX; k++) {
      const g = this.grains[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (g.live && g.life > 0.25) continue;
      g.live = true; g.x = x; g.y = y; g.z = z;
      g.vx = vx; g.vy = vy; g.vz = vz;
      g.color = color; g.life = life; g.target = null;
      return g;
    }
    return null;
  }

  private hideAll() {
    dummy.position.set(0, -9999, 0);
    dummy.scale.setScalar(0.001);
    dummy.updateMatrix();
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    this.stepGrains(dt);
    this.syncMounds();
    this.syncChannel();
  }

  private stepGrains(dt: number) {
    const floor = LAYOUT.funnelBottom - 1.5;
    for (let i = 0; i < MAX; i++) {
      const g = this.grains[i];
      if (!g.live) continue;
      g.life -= dt;

      if (g.target) {
        // Homing into a receiver mouth — a peeled-off stream, not a free fall.
        const dx = g.target.x - g.x, dy = g.target.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = 34;
        g.x += (dx / d) * speed * dt;
        g.y += (dy / d) * speed * dt;
        if (d < 1.2) g.life = 0;
      } else {
        g.vy += TUNING.PARTICLE_GRAVITY * dt;
        g.vx *= Math.pow(TUNING.PARTICLE_DAMPING, dt * 60 / 60);
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        g.z += g.vz * dt;
        if (g.y < floor) g.life = 0;
      }
      if (g.life <= 0) { g.live = false; }

      if (g.live) {
        dummy.position.set(g.x, g.y, g.z);
        dummy.rotation.z = g.x * 0.7 + g.y * 0.3;
        dummy.scale.setScalar(1);
      } else {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.001);
      }
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      tint.setHex(COLORS[g.color].hex);
      this.mesh.setColorAt(i, tint);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * THE PILE. Height and width come straight from `reservoir.pile`, so what the
   * player sees stacking is exactly the volume that has arrived and not yet
   * squeezed through. Nothing here is faked with a timer.
   */
  private syncMounds() {
    for (const r of this.model.sand.reservoirs) {
      const m = this.mounds.get(r.id)!;
      const k = Math.min(1, r.pile / TUNING.PILE_FULL_VOLUME);
      if (k < 0.02) { m.visible = false; continue; }
      const h = TUNING.PILE_MAX_HEIGHT * Math.sqrt(k);
      const w = TUNING.PILE_MAX_WIDTH * Math.sqrt(k);
      m.visible = true;
      m.scale.set(w / 2, h, w / 2);
      m.position.set(r.outX, r.outY - 0.4 - h / 2, r.outZ + 1.0);
    }

    const funnelVol = this.model.sand.funnel.reduce((n, f) => n + f.volume, 0);
    const fk = Math.min(1, funnelVol / (TUNING.PILE_FULL_VOLUME * 0.8));
    if (fk < 0.02) this.funnelMound.visible = false;
    else {
      const h = TUNING.PILE_MAX_HEIGHT * 1.1 * Math.sqrt(fk);
      const w = TUNING.PILE_MAX_WIDTH * 1.5 * Math.sqrt(fk);
      this.funnelMound.visible = true;
      this.funnelMound.scale.set(w / 2, h, w / 2);
      this.funnelMound.position.set(0, LAYOUT.funnelBottom + h / 2 + 0.4, LAYOUT.beltZ - 0.2);
      (this.funnelMound.material as THREE.MeshStandardMaterial).color
        .setHex(COLORS[this.model.sand.funnel[0]?.color ?? 'red'].hex);
    }
  }

  /**
   * The channel's contents, drawn as GRAINS LYING IN THE CHANNEL.
   *
   * A straight box tangent to an oval sticks out of it, and a stretched arc
   * reads as a painted stripe. Sand in a groove is sand: place grains along the
   * arc each run occupies, as many as its volume is worth, jittered across the
   * channel width. The count follows the volume, so the ring visibly fills.
   */
  private syncChannel() {
    const path = this.model.sand.path;
    const segs = this.model.sand.segments;
    const cap = TUNING.BUFFER_CAPACITY;
    let n = 0;
    for (const seg of segs) {
      // Arc length this run occupies, and how many grains that is worth.
      const arc = (seg.volume / cap) * path.length;
      const want = Math.min(CHANNEL_MAX - n, Math.max(1, Math.round(seg.volume / CHANNEL_UNITS_PER_GRAIN)));
      for (let i = 0; i < want && n < CHANNEL_MAX; i++, n++) {
        // Deterministic jitter per slot: no per-frame shimmer.
        const j1 = hash01(seg.id * 7919 + i * 131);
        const j2 = hash01(seg.id * 104729 + i * 977);
        const p = path.point(path.wrap(seg.s - arc * (i + 0.5) / want));
        const across = (j1 - 0.5) * LAYOUT.beltChannelW * 0.78;
        dummy.position.set(p.x - p.ty * across, p.y + p.tx * across, LAYOUT.beltZ + 0.25 + j2 * 0.2);
        dummy.rotation.set(0, 0, j2 * 6.28);
        dummy.scale.setScalar(0.85 + j2 * 0.5);
        dummy.updateMatrix();
        this.channelMesh.setMatrixAt(n, dummy.matrix);
        tint.setHex(COLORS[seg.color].hex);
        this.channelMesh.setColorAt(n, tint);
      }
    }
    // Park the rest far away rather than resizing the buffer every frame.
    for (let i = n; i < CHANNEL_MAX; i++) {
      dummy.position.set(0, -9999, 0);
      dummy.scale.setScalar(0.001);
      dummy.updateMatrix();
      this.channelMesh.setMatrixAt(i, dummy.matrix);
    }
    this.channelMesh.instanceMatrix.needsUpdate = true;
    if (this.channelMesh.instanceColor) this.channelMesh.instanceColor.needsUpdate = true;
    this.channelCount = n;
  }

  get liveGrains() { return this.grains.reduce((n, g) => n + (g.live ? 1 : 0), 0) + this.channelCount; }
}

function moundMat(color: MarbleColor) {
  return new THREE.MeshStandardMaterial({
    color: COLORS[color].hex, roughness: 0.92, metalness: 0,
    // Matte and slightly rough: loose material, not a polished sphere.
    flatShading: true,
  });
}

/** Where a receiver's mouth is, in world coordinates. */
export function receiverMouth(r: Receiver) {
  const x = LAYOUT.recvColX[r.column] ?? 0;
  return { x, y: LAYOUT.recvBoxY + LAYOUT.recvBoxH * 0.5 };
}
