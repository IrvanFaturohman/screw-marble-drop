import * as THREE from 'three';
import { ENV, HALF_W, LAYOUT, TUNING } from '../config/GameConfig';
import type { LevelDef } from '../config/LevelConfig';
import type { GameModel } from '../game/GameModel';
import { box, frameMaterial, metalMaterial, rubberMaterial } from './Materials';

/**
 * The funnel, the deflectors, and the shared conveyor.
 *
 * The belt is an oval lying in the screen plane so it reads as a circulating
 * track from a fixed front camera — the Marble Sort silhouette. A horizontal
 * track would collapse to a line under this camera and the congestion, which is
 * the entire pressure readout, would become unreadable.
 */
export class TrackView {
  readonly group = new THREE.Group();
  private tread!: THREE.InstancedMesh;
  private treadN = 0;
  private scroll = 0;
  private gateGlow!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private ringMat!: THREE.MeshBasicMaterial;
  private t = 0;

  constructor(private model: GameModel, level: LevelDef) {
    this.buildFunnel();
    this.buildGuides(level);
    this.buildBelt();
  }

  private buildFunnel() {
    const mat = metalMaterial(ENV.metal, 0.3);
    for (const side of [-1, 1]) {
      const x1 = side * LAYOUT.funnelMouthHalf, y1 = LAYOUT.funnelTop;
      const x2 = side * LAYOUT.funnelThroatHalf, y2 = LAYOUT.funnelBottom;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const cheek = box(len, 1.1, 6.4, mat);
      cheek.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
      cheek.rotation.z = Math.atan2(dy, dx);
      cheek.castShadow = true; cheek.receiveShadow = true;
      this.group.add(cheek);
      // Bright inner edge — the surface a marble actually slides along.
      const edge = box(len, 0.22, 0.5, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      edge.position.set((x1 + x2) / 2, (y1 + y2) / 2 + 0.62, 3.3);
      edge.rotation.z = cheek.rotation.z;
      this.group.add(edge);
    }
  }

  private buildGuides(level: LevelDef) {
    const mat = frameMaterial(ENV.frameDark);
    for (const g of level.guides) {
      const m = box(g.w, g.h, g.d ?? 3.0, mat);
      m.position.set(g.x, g.y, g.z ?? LAYOUT.zFront - 0.8);
      m.rotation.z = g.rot;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      const cap = box(g.w, 0.18, (g.d ?? 3.0) * 0.6, new THREE.MeshBasicMaterial({ color: 0xfffdf6 }));
      cap.position.set(g.x, g.y, g.z ?? LAYOUT.zFront - 0.8);
      cap.position.add(new THREE.Vector3(-Math.sin(g.rot), Math.cos(g.rot), 0).multiplyScalar(g.h / 2));
      cap.position.z += (g.d ?? 3.0) / 2;
      cap.rotation.z = g.rot;
      this.group.add(cap);
    }
  }

  /** Stadium ring built as an extruded shape with a stadium-shaped hole. */
  private stadiumShape(rx: number, ry: number) {
    const a = rx - ry;
    const s = new THREE.Shape();
    s.moveTo(-a, ry);
    s.lineTo(a, ry);
    s.absarc(a, 0, ry, Math.PI / 2, -Math.PI / 2, true);
    s.lineTo(-a, -ry);
    s.absarc(-a, 0, ry, -Math.PI / 2, -Math.PI * 1.5, true);
    return s;
  }

  private ringMesh(outerRX: number, outerRY: number, innerRX: number, innerRY: number, depth: number, mat: THREE.Material) {
    const shape = this.stadiumShape(outerRX, outerRY);
    const hole = this.stadiumShape(innerRX, innerRY);
    shape.holes.push(new THREE.Path(hole.getPoints(64)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 32 });
    geo.translate(0, 0, -depth / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(LAYOUT.loopCX, LAYOUT.loopCY, 0);
    return m;
  }

  private buildBelt() {
    const { loopRX: rx, loopRY: ry, beltChannelW: cw } = LAYOUT;

    // Recessed housing.
    const housing = this.ringMesh(rx + cw / 2 + 1.5, ry + cw / 2 + 1.5, rx - cw / 2 - 1.5, ry - cw / 2 - 1.5, 1.6, metalMaterial(ENV.metalDark, 0.45));
    housing.position.z = -0.4;
    housing.receiveShadow = true;
    this.group.add(housing);

    // The rubber band the marbles ride in.
    const belt = this.ringMesh(rx + cw / 2, ry + cw / 2, rx - cw / 2, ry - cw / 2, 1.5, rubberMaterial(ENV.rubberDark));
    belt.position.z = 0.35;
    belt.receiveShadow = true;
    this.group.add(belt);

    // Guard rails, so marbles read as sitting IN a channel.
    const railMat = metalMaterial(ENV.metalDeep, 0.4);
    const outer = this.ringMesh(rx + cw / 2 + 0.55, ry + cw / 2 + 0.55, rx + cw / 2 - 0.1, ry + cw / 2 - 0.1, 2.6, railMat);
    outer.position.z = 0.9;
    const inner = this.ringMesh(rx - cw / 2 + 0.1, ry - cw / 2 + 0.1, rx - cw / 2 - 0.55, ry - cw / 2 - 0.55, 2.6, railMat);
    inner.position.z = 0.9;
    this.group.add(outer, inner);

    // Pressure ring: neutral -> amber -> pulsing red. Peripheral-vision readout.
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x8a97ab, transparent: true, opacity: 0.28 });
    this.ring = this.ringMesh(rx + cw / 2 + 2.1, ry + cw / 2 + 2.1, rx + cw / 2 + 1.5, ry + cw / 2 + 1.5, 0.5, this.ringMat);
    this.ring.position.z = 0.5;
    this.group.add(this.ring);

    // Moving tread.
    const path = this.model.sorting.path;
    this.treadN = Math.floor(path.length / 2.2);
    this.tread = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, LAYOUT.beltChannelW * 0.82, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x11151d, transparent: true, opacity: 0.5 }),
      this.treadN,
    );
    this.tread.frustumCulled = false;
    this.group.add(this.tread);

    // Collection gate at the bottom of the loop, aimed at the receivers.
    this.gateGlow = box(TUNING.EXIT_GATE_HALF * 2, LAYOUT.beltChannelW, 0.2,
      new THREE.MeshBasicMaterial({ color: 0xfff3d4, transparent: true, opacity: 0.2 }));
    const gp = path.point(path.length / 2);
    this.gateGlow.position.set(gp.x, gp.y, 1.2);
    this.group.add(this.gateGlow);

    // Chute mouth under the gate.
    const chute = box(TUNING.EXIT_GATE_HALF * 2.1, 0.5, 3.0, metalMaterial(ENV.metalDeep, 0.4));
    chute.position.set(gp.x, gp.y - LAYOUT.beltChannelW / 2 - 1.1, 0.6);
    this.group.add(chute);
  }

  update(dt: number) {
    this.t += dt;
    const path = this.model.sorting.path;
    const dummy = new THREE.Object3D();

    this.scroll = (this.scroll + TUNING.CONVEYOR_SPEED * dt) % 2.2;
    for (let i = 0; i < this.treadN; i++) {
      const s = this.scroll + i * 2.2;
      const p = path.point(s);
      dummy.position.set(p.x, p.y, 1.15);
      dummy.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
      dummy.updateMatrix();
      this.tread.setMatrixAt(i, dummy.matrix);
    }
    this.tread.instanceMatrix.needsUpdate = true;

    const p = Math.min(1, this.model.sorting.load / this.model.sorting.capacity);
    const danger = p >= 0.88, warn = p >= 0.6;
    const pulse = danger ? 0.55 + 0.45 * Math.sin(this.t * 9) : 1;
    this.ringMat.color.setHex(danger ? 0xf8443c : warn ? 0xffc02e : 0x8a97ab);
    this.ringMat.opacity = (danger ? 0.95 : warn ? 0.6 : 0.24) * pulse;

    const anyMatch = this.model.sorting.belt.some((b) => !!this.model.sorting.destinationFor(b.color));
    (this.gateGlow.material as THREE.MeshBasicMaterial).opacity =
      0.12 + (anyMatch ? 0.28 * (0.5 + 0.5 * Math.sin(this.t * 8)) : 0.04);
  }
}
