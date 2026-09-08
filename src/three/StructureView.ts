import * as THREE from 'three';
import { COLORS, ENV, LAYOUT, plateShade, TUNING } from '../config/GameConfig';
import { plateTint, pocketLayout, pocketSlot } from '../config/LevelConfig';
import type { GameModel } from '../game/GameModel';
import type { Plate, Pocket, Screw } from '../game/SourceModel';
import type { ShapeDef } from '../game/PlateShapes';
import { GEO, metalMaterial } from './Materials';
import { Rng } from '../util/Rng';

interface PlateView {
  plate: Plate;
  /** Sits AT the pivot; the body is offset inside it, so rotating the group is
   *  literally "swing about the remaining screw". */
  group: THREE.Group;
  body: THREE.Mesh;
  rim: THREE.LineLoop;
  shade: THREE.LineLoop;
  baseOpacity: number;
  baseRim: THREE.Color;
  mat: THREE.MeshPhysicalMaterial;
  rimMat: THREE.LineBasicMaterial;
  pockets: { pocket: Pocket; mesh: THREE.InstancedMesh }[];
  wells: THREE.Mesh[];
  /** One per screw through this plank, uncovered when that screw comes out. */
  holes: { mesh: THREE.Mesh; screw: Screw; sx: number; sy: number }[];
  loosePulse: number;
}

interface ScrewView {
  screw: Screw;
  group: THREE.Group;
  head: THREE.Group;
  ready: THREE.Mesh;
  locked: THREE.Mesh;
  pulse: number;
  baseZ: number;
  /** This screw's own materials, so it can fade out independently. */
  mats: THREE.Material[];
  /** 0..1 through the leave animation. */
  gone: number;
}

const dummy = new THREE.Object3D();

/** Cut-ply thickness. Must stay under the smallest gap between depth layers. */
const PLATE_THICK = 0.24;
/** Front face of a plate in its own local space. */
const PLATE_FACE = PLATE_THICK / 2 + 0.05;
/** A seated bead, flat in the channel — deliberately smaller than a marble. */
const PIP_R = TUNING.MARBLE_RADIUS * 0.62;

/**
 * The screw sculpture.
 *
 * Every plate group is positioned AT its pivot with the body offset inside it,
 * so "rotate about the remaining screw" is one `group.rotation.z` rather than a
 * matrix the renderer has to keep in sync with the rules. Pockets are children
 * of their plate's group, which means a tray's marbles tilt with the tray for
 * free — and the batch you can see through the acrylic is literally the batch
 * that will spill.
 */
export class StructureView {
  readonly group = new THREE.Group();
  private views: PlateView[] = [];
  private screwViews: ScrewView[] = [];
  private byPlate = new Map<string, PlateView>();
  private byScrew = new Map<string, ScrewView>();

  constructor(private model: GameModel) {
    this.buildBoard();
    // Back to front, so translucency sorts sanely without per-frame sorting.
    const ordered = [...model.source.plates].sort((a, b) => a.z - b.z);
    for (const p of ordered) this.buildPlate(p);
    for (const s of model.source.screws) this.buildScrew(s);
  }

  /**
   * The board the whole lattice is screwed to.
   *
   * Without it the sticks read as ten objects floating in space; with it they
   * read as one assembly. The empty holes are the same affordance a real screw
   * puzzle uses — they say "screws go here" before anything has been removed.
   */
  private buildBoard() {
    const w = 38, h = 29.5, cx = 0, cy = 22.25;
    const g = new THREE.Group();
    g.position.set(cx, cy, -6.5);

    const shape = buildShape({ kind: 'bar', w, h, r: 3.0 });
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 2.2, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.4, bevelSegments: 2, curveSegments: 8,
    });
    geo.translate(0, 0, -1.1);
    const board = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: woodTexture(), roughness: 0.72, metalness: 0.0,
    }));
    board.receiveShadow = true;
    g.add(board);

    // A darker inset panel, so the plank has a rim like the reference boards.
    const inner = new THREE.Mesh(
      new THREE.ExtrudeGeometry(buildShape({ kind: 'bar', w: w - 2.6, h: h - 2.6, r: 2.4 }),
        { depth: 0.3, bevelEnabled: false, curveSegments: 8 }),
      new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.10, roughness: 1 }),
    );
    inner.position.z = 1.12;
    g.add(inner);

    // NO decorative holes. A neat row of five on the bare board reads as a UI
    // element — five slots for something — not as spare drilled holes. The only
    // holes on this board are real ones: see `buildPlate`, where every screw
    // leaves the hole it came out of.

    this.group.add(g);
  }

  // ------------------------------------------------------------------ build

  private buildPlate(plate: Plate) {
    const d = plate.def;
    const tint = plateShade(plateTint(this.model.level, d.id), d.z);
    const shape = buildShape(d.shape);

    // THIN. The depth layers are as little as 0.4 apart, so a 1.5-deep slab
    // physically intersected its neighbours — that interpenetration is what
    // made the stack read as mush rather than as sticks laid over each other.
    // Cut-ply thickness reads flat, almost 2D, and every crossing stays clean.
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: PLATE_THICK, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05,
      bevelSegments: 1, curveSegments: 44,
    });
    geo.translate(0, 0, -PLATE_THICK / 2);

    // SOLID, and painted the colour of what it holds.
    //
    // Stacked translucency was unreadable — six layers of tinted glass average
    // out to one mush and you cannot tell which plate is in front, let alone
    // what it is carrying. An opaque plate occludes cleanly, so depth is
    // unambiguous, and its colour does the job the transparency was failing at:
    // saying what this screw will spill.
    //
    // Satin, not glossy: the marbles are the shiny things on the board.
    const mat = new THREE.MeshPhysicalMaterial({
      color: tint.hex, roughness: 0.42, metalness: 0.02,
      clearcoat: 0.35, clearcoatRoughness: 0.35,
      side: THREE.FrontSide,
    });
    const baseOpacity = 1;
    const body = new THREE.Mesh(geo, mat);
    body.castShadow = true;
    body.receiveShadow = true;

    // Crisp rim. With the bodies this glassy the OUTLINE is what tells the
    // player which plate is in front and where one ends — so it is drawn bright,
    // at the plate's front face, and it never fades until the plate does.
    const pts = shape.getPoints(72).map((p) => new THREE.Vector3(p.x, p.y, PLATE_FACE + 0.04));
    const rimMat = new THREE.LineBasicMaterial({ color: tint.rim, transparent: true, opacity: 1 });
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), rimMat);
    // A second, darker loop just behind reads as thickness — Three cannot be
    // relied on for linewidth > 1 on any platform that matters.
    const shadePts = shape.getPoints(72).map((p) => new THREE.Vector3(p.x * 1.006, p.y * 1.006, PLATE_FACE));
    const shade = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(shadePts),
      new THREE.LineBasicMaterial({ color: tint.edge, transparent: true, opacity: 0.85 }),
    );

    const group = new THREE.Group();
    group.add(body, shade, rim);

    const view: PlateView = { plate, group, body, rim, shade, mat, rimMat, baseOpacity, baseRim: new THREE.Color(tint.rim), pockets: [], wells: [], holes: [], loosePulse: 0 };

    // Pockets ride inside the plate group, so they move with what holds them.
    for (const pk of this.model.source.pockets) {
      if (pk.def.plate !== plate.id) continue;
      // A LOADED BEAD IS A FLUSH PIP, NOT A MARBLE.
      //
      // Spheres sat a full radius proud of the stick and visibly hung over its
      // edges — marbles that looked like they were already falling out. A real
      // board does not show its contents in relief; it shows drilled seats. So
      // while a batch is stored it is a flat disc set into the channel, and the
      // actual 3D marbles only exist once they are pouring.
      const mesh = new THREE.InstancedMesh(GEO.socket, pipMat(pk.color), pk.total);
      mesh.frustumCulled = false;
      const lay = pocketLayout(this.model.level, pk.def);
      for (let i = 0; i < pk.total; i++) {
        const slot = pocketSlot(pk.def, i, lay);
        dummy.position.set(pk.lx + slot.dx, pk.ly + slot.dy, PLATE_FACE + 0.02);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(PIP_R, 0.06, PIP_R);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      view.pockets.push({ pocket: pk, mesh });
    }

    // A darker well behind each batch, so glossy marbles read against a plate
    // that now shares their hue instead of dissolving into it.
    for (const pk of this.model.source.pockets) {
      if (pk.def.plate !== plate.id) continue;
      const cols = pk.def.cols;
      const rows = Math.ceil(pk.total / cols);
      const sp = pk.def.spacing ?? LAYOUT.pocketSpacing;
      const w = (cols - 1) * sp + PIP_R * 3.4;
      const h = (rows - 1) * sp + PIP_R * 3.4;
      const wellShape = buildShape({ kind: 'bar', w, h, r: PIP_R * 1.6 });
      const wellGeo = new THREE.ExtrudeGeometry(wellShape, { depth: 0.04, bevelEnabled: false, curveSegments: 12 });
      const well = new THREE.Mesh(wellGeo, new THREE.MeshStandardMaterial({ color: tint.well, roughness: 0.9 }));
      // Flush with the face: on a stick this thin a raised well would be most
      // of its depth. It reads as a routed channel, not a box.
      well.position.set(pk.lx, pk.ly, PLATE_FACE);
      group.add(well);
      view.wells.push(well);
    }

    // THE HOLE THE SCREW CAME OUT OF.
    //
    // A screw passes through this plank, so there is a hole in it. It is hidden
    // while the screw is in and uncovered as the screw fades, which is what
    // makes the fade read as "unscrewed" rather than "vanished" — and it is the
    // only kind of hole worth drawing, because it means something.
    for (const sc of plate.screws) {
      const hole = new THREE.Mesh(GEO.socket, new THREE.MeshStandardMaterial({
        color: 0x3a2f24, roughness: 0.95, metalness: 0,
      }));
      // A DRILLED HOLE, not a crater. At 0.78 of the head radius it came out
      // wider than the beads sitting beside it in the same plank, which read as
      // a gap in the plank rather than a hole a screw came out of. A real one is
      // the shank, well inside the head that covered it.
      hole.scale.set(LAYOUT.screwR * 0.34, 0.05, LAYOUT.screwR * 0.34);
      hole.rotation.x = Math.PI / 2;
      hole.visible = false;
      group.add(hole);
      view.holes.push({ mesh: hole, screw: sc, sx: sc.x, sy: sc.y });
    }

    this.group.add(group);
    this.views.push(view);
    this.byPlate.set(plate.id, view);
    this.syncPlate(view);
  }

  private buildScrew(screw: Screw) {
    const plate = this.model.source.plateById.get(screw.plateId)!;
    const baseZ = plate.z + LAYOUT.screwZ;
    const g = new THREE.Group();
    g.position.set(screw.x, screw.y, baseZ);

    const head = new THREE.Group();
    // Chunky, dark, and unmistakably not a marble.
    const boss = new THREE.Mesh(GEO.screwHead, metalMaterial(ENV.metalDeep, 0.45));
    boss.scale.set(LAYOUT.screwR * 1.3, 0.55, LAYOUT.screwR * 1.3);
    boss.rotation.x = Math.PI / 2;
    head.add(boss);
    const cap = new THREE.Mesh(GEO.screwHead, metalMaterial(ENV.metal, 0.22));
    cap.scale.set(LAYOUT.screwR, 0.8, LAYOUT.screwR);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.45;
    cap.castShadow = true;
    head.add(cap);
    // Neutral hardware ring. Now that plates carry the batch colour, a coloured
    // screw would imply screw colour feeds the receivers. It never does.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(LAYOUT.screwR * 0.8, 0.16, 8, 22), metalMaterial(0x8b93a0, 0.35));
    ring.position.z = 0.86;
    head.add(ring);
    for (const a of [0, Math.PI / 2]) {
      const slot = new THREE.Mesh(GEO.box, metalMaterial(0x2a2f38, 0.55));
      slot.scale.set(LAYOUT.screwR * 1.3, 0.32, 0.26);
      slot.position.z = 0.88;
      slot.rotation.z = a;
      head.add(slot);
    }
    g.add(head);

    // NO "tappable" ring. Every screw on the board is tappable, so a highlight
    // on all thirteen is thirteen highlights and no information — it just buried
    // the planks. What is worth flagging is the opposite: a plank whose screws
    // are all out and which is only waiting for the one on top of it to go.
    // That cue lives on the PLANK (see `loose` in update), not on the screw.
    const ready = new THREE.Mesh(
      new THREE.TorusGeometry(LAYOUT.screwR * 1.45, 0.16, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0 }),
    );
    ready.position.z = 1.0;
    ready.visible = false;
    const locked = new THREE.Mesh(
      new THREE.TorusGeometry(LAYOUT.screwR * 1.34, 0.13, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0x544d43, transparent: true, opacity: 0.75 }),
    );
    locked.position.z = 0.9;
    locked.visible = false;
    g.add(ready, locked);

    this.group.add(g);
    // metalMaterial() mints a fresh material per call, so each screw owns its
    // own and can fade without touching its neighbours.
    const mats: THREE.Material[] = [];
    head.traverse((o) => { if ((o as THREE.Mesh).isMesh) mats.push((o as THREE.Mesh).material as THREE.Material); });
    const v: ScrewView = { screw, group: g, head, ready, locked, pulse: Math.random() * 6.28, baseZ, mats, gone: 0 };
    this.screwViews.push(v);
    this.byScrew.set(screw.id, v);
  }

  // ----------------------------------------------------------------- update

  /** Copy the plate's authored pose onto its group. */
  private syncPlate(v: PlateView) {
    const p = v.plate;
    v.group.position.set(p.pivotX + p.dx, p.pivotY + p.dy, p.z + p.dz);
    v.group.rotation.z = p.angle;
    v.group.rotation.x = p.tip;
    // Body offset inside the group = plate origin relative to the pivot.
    v.body.position.set(p.def.x - p.pivotX, p.def.y - p.pivotY, 0);
    v.body.rotation.z = p.def.rot ?? 0;
    v.rim.position.copy(v.body.position); v.rim.rotation.z = v.body.rotation.z;
    v.shade.position.copy(v.body.position); v.shade.rotation.z = v.body.rotation.z;
    for (const pk of v.pockets) { pk.mesh.position.copy(v.body.position); pk.mesh.rotation.z = v.body.rotation.z; }
    for (const w of v.wells) { w.position.copy(v.body.position); w.rotation.z = v.body.rotation.z; }
    // Holes are authored in world space, so they hang off the pivot directly
    // rather than off the body — the group's own rotation carries them.
    for (const h of v.holes) {
      // In front of the seated beads: a screw goes THROUGH the plank, so where
      // it was there is a hole, not a bead.
      h.mesh.position.set(h.sx - p.pivotX, h.sy - p.pivotY, PLATE_FACE + 0.04);
      h.mesh.visible = h.screw.removed;
    }
  }

  /** Bump the plate that just refused a tap, so the refusal teaches the rule. */
  nudge(plate: Plate) {
    const v = this.byPlate.get(plate.id);
    if (!v) return;
    v.group.position.z += 0.9;
    v.rimMat.color.setHex(0xff6a5f);
  }

  update(dt: number) {
    for (const v of this.views) {
      const p = v.plate;
      if (!p.present) { v.group.visible = false; continue; }
      this.syncPlate(v);
      if (p.alpha < 1) {
        // Only turn transparent while the plate is actually leaving — a
        // permanently transparent material sorts badly against ten neighbours.
        if (!v.mat.transparent) { v.mat.transparent = true; v.mat.depthWrite = false; v.mat.needsUpdate = true; }
        v.mat.opacity = p.alpha;
      }
      v.rimMat.opacity = p.alpha;
      (v.shade.material as THREE.LineBasicMaterial).opacity = 0.85 * p.alpha;
      // Ease the blocked-tap flash back to the plank's own rim colour.
      v.rimMat.color.lerp(v.baseRim, Math.min(1, dt * 6));

      // LOOSE: every screw is out and it is only waiting for the plank lying on
      // top of it. It lifts a little and breathes, so the player can see the
      // chain they have already set up.
      if (p.loose) {
        v.loosePulse += dt * 3.2;
        v.group.position.z = 0.55 + 0.12 * Math.sin(v.loosePulse);
      } else if (v.group.position.z !== 0) {
        v.group.position.z += (0 - v.group.position.z) * Math.min(1, dt * 8);
      }

      for (const pk of v.pockets) {
        const shown = pk.pocket.pending;
        if (pk.mesh.count !== shown) pk.mesh.count = Math.max(0, shown);
      }
    }

    for (const v of this.screwViews) {
      const s = v.screw;
      if (s.removed && !s.unscrewing) {
        // OUT OF THE WAY, not down the board.
        //
        // A pulled screw used to fall the length of the frame — straight across
        // the fall space and onto the conveyor, where it sat looking like a
        // piece of the machine. It reads as debris and it hides the thing the
        // player is actually watching. So it leaves the way a plank does:
        // keeps spinning, lifts toward the camera, and fades out where it was.
        v.gone = Math.min(1, v.gone + dt / 0.24);
        const e = v.gone;
        v.group.position.z = v.baseZ + TUNING.UNSCREW_LIFT + e * 2.6;
        v.head.rotation.z -= dt * 7;
        v.head.scale.setScalar(1 + e * 0.3);
        for (const m of v.mats) {
          const mm = m as THREE.MeshStandardMaterial;
          if (!mm.transparent) { mm.transparent = true; mm.depthWrite = false; mm.needsUpdate = true; }
          mm.opacity = 1 - e;
        }
        v.group.visible = e < 1;
        continue;
      }
      if (s.unscrewing) {
        v.head.rotation.z = -s.t * TUNING.UNSCREW_TURNS * Math.PI * 2;
        v.group.position.z = v.baseZ + s.t * TUNING.UNSCREW_LIFT;
        v.ready.visible = false; v.locked.visible = false;
        continue;
      }
      // Every head sits proud of whatever it is driven through, at the same
      // height, because from straight above that is what a screw looks like.
      const targetZ = v.baseZ + 0.35;
      v.group.position.z += (targetZ - v.group.position.z) * Math.min(1, dt * 8);
      v.head.scale.setScalar(1);
    }
  }

  screwWorld(s: Screw, out: THREE.Vector3) {
    const v = this.byScrew.get(s.id);
    return v ? v.group.getWorldPosition(out) : out.set(s.x, s.y, 0);
  }

  /** World position of a pocket's mouth, for release effects. */
  pocketWorld(pk: Pocket, out: THREE.Vector3) {
    const plate = this.model.source.plateById.get(pk.def.plate)!;
    const [x, y] = plate.localToWorld(pk.lx, pk.ly);
    return out.set(x, y, plate.z + 1);
  }
}

/** Procedural pine grain. One canvas, no asset file. */
let woodTex: THREE.CanvasTexture | null = null;
function woodTexture() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  const rng = new Rng(0x77009d);
  ctx.fillStyle = '#d9a86a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const y = rng.next() * 256;
    ctx.strokeStyle = `rgba(${150 + rng.range(0, 40) | 0},${100 + rng.range(0, 30) | 0},${50 + rng.range(0, 25) | 0},${rng.range(0.06, 0.18).toFixed(3)})`;
    ctx.lineWidth = rng.range(0.6, 3.6);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin((x / 256) * Math.PI * 2 + i) * 3);
    ctx.stroke();
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  return woodTex;
}

// ------------------------------------------------------------------ shapes ---

/** ShapeDef -> THREE.Shape, in the plate's local frame. */
function buildShape(def: ShapeDef): THREE.Shape {
  const s = new THREE.Shape();
  switch (def.kind) {
    case 'arc': {
      s.absarc(0, 0, def.ro, def.a0, def.a1, false);
      s.absarc(0, 0, def.ri, def.a1, def.a0, true);
      s.closePath();
      break;
    }
    case 'wedge': {
      s.moveTo(0, 0);
      s.absarc(0, 0, def.r, def.a0, def.a1, false);
      s.closePath();
      break;
    }
    case 'disc':
      s.absarc(0, 0, def.r, 0, Math.PI * 2, false);
      break;
    case 'ring': {
      s.absarc(0, 0, def.ro, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, def.ri, 0, Math.PI * 2, true);
      s.holes.push(hole);
      break;
    }
    case 'bar': {
      const hw = def.w / 2, hh = def.h / 2;
      const r = Math.min(def.r ?? Math.min(hw, hh) * 0.5, hw, hh);
      s.moveTo(-hw + r, -hh);
      s.lineTo(hw - r, -hh);
      s.quadraticCurveTo(hw, -hh, hw, -hh + r);
      s.lineTo(hw, hh - r);
      s.quadraticCurveTo(hw, hh, hw - r, hh);
      s.lineTo(-hw + r, hh);
      s.quadraticCurveTo(-hw, hh, -hw, hh - r);
      s.lineTo(-hw, -hh + r);
      s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      break;
    }
  }
  return s;
}

/** A bead at rest in its seat: matte and flat, so it never competes with a
 *  real marble in flight. */
function pipMat(color: keyof typeof COLORS) {
  return new THREE.MeshStandardMaterial({
    color: COLORS[color].hex, roughness: 0.55, metalness: 0,
  });
}
