import * as THREE from 'three';
import { COLORS, ENV, LAYOUT, TUNING } from '../config/GameConfig';
import type { GameModel } from '../game/GameModel';
import type { Receiver } from '../game/SandModel';
import { box, frameMaterial, GEO, metalMaterial, plasticMaterial } from './Materials';

interface ColumnView {
  root: THREE.Group;
  /** The live box. Retextured in place as the column advances. */
  box: THREE.Group;
  body: THREE.Mesh;
  /** The sand actually sitting in the jar. Scales with fill. */
  fill: THREE.Mesh;
  /** A slightly uneven crown on top of it, so the surface reads as loose. */
  crown: THREE.Mesh;
  /** The small heap in the mouth while a stream is arriving. */
  inlet: THREE.Mesh;
  glass: THREE.Mesh;
  queued: THREE.Mesh[];
  label: THREE.Sprite;
  active: Receiver | null;
  swapT: number;
  exitT: number;
}

/**
 * Three stacked receiver columns. Only the TOP box of each is a destination;
 * the rest peek out beneath it as a visible magazine.
 *
 * Showing the queue is what turns "should I open the green chamber now?" into a
 * decision with readable odds instead of a gamble — you can see green coming two
 * boxes away and judge whether you can carry 9 green marbles until then.
 */
export class ReceiverView {
  readonly group = new THREE.Group();
  private cols: ColumnView[] = [];

  constructor(private model: GameModel) {
    model.sand.columns.forEach((col, ci) => {
      const root = new THREE.Group();
      root.position.set(LAYOUT.recvColX[ci], 0, 0);

      // Rail the magazine sits in.
      const rail = box(LAYOUT.recvBoxW + 1.6, LAYOUT.recvBoxH + 9.5, 2.2, frameMaterial(ENV.frame));
      rail.position.set(0, LAYOUT.recvBoxY - 3.2, -1.6);
      rail.receiveShadow = true;
      root.add(rail);

      const active = col[0];
      const boxGroup = new THREE.Group();
      boxGroup.position.set(0, LAYOUT.recvBoxY, 1.0);
      const body = box(LAYOUT.recvBoxW, LAYOUT.recvBoxH, 3.4, plasticMaterial(active.color));
      body.castShadow = true; body.receiveShadow = true;
      boxGroup.add(body);

      // A JAR, NOT A SOCKET STRIP.
      //
      // The container is open-fronted and the sand inside is a real column whose
      // height is the fill fraction, so the number and the picture cannot
      // disagree. Three round holes could only ever say 0, 1, 2 or 3.
      const inner = LAYOUT.recvBoxW - 2.2;
      const innerH = LAYOUT.recvBoxH - 2.0;
      const well = box(inner, innerH, 0.5, new THREE.MeshStandardMaterial({
        color: COLORS[active.color].deep, roughness: 0.95,
      }));
      well.position.set(0, 0, 1.55);
      boxGroup.add(well);

      const fill = box(inner - 0.5, 1, 1.1, new THREE.MeshStandardMaterial({
        color: COLORS[active.color].light, roughness: 0.95, flatShading: true,
      }));
      boxGroup.add(fill);

      // A shallow cone riding the surface: loose material never sits flat.
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(inner * 0.42, 1.0, 12),
        new THREE.MeshStandardMaterial({ color: COLORS[active.color].light, roughness: 0.95, flatShading: true }),
      );
      boxGroup.add(crown);

      // The mouth. Deliberately narrower than the jar, so a stream heaps here
      // for a moment before it drops in.
      const inletMesh = new THREE.Mesh(
        new THREE.ConeGeometry(TUNING.RECEIVER_INLET_WIDTH, 1, 12),
        new THREE.MeshStandardMaterial({ color: COLORS[active.color].light, roughness: 0.95, flatShading: true }),
      );
      inletMesh.visible = false;
      boxGroup.add(inletMesh);

      // Plain transparency, NOT `transmission`. A transmissive material makes
      // Three re-render the entire scene into a transmission target every frame;
      // one pane of it here took the frame from 35ms to 99ms.
      const glass = box(inner + 0.6, innerH + 0.6, 0.35, new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.14, metalness: 0,
        transparent: true, opacity: 0.16, depthWrite: false,
      }));
      glass.position.set(0, 0, 2.35);
      boxGroup.add(glass);

      root.add(boxGroup);

      // Queue slivers beneath the live box.
      const queued: THREE.Mesh[] = [];
      for (let i = 1; i <= LAYOUT.recvQueueVisible && i < col.length; i++) {
        const q = box(LAYOUT.recvBoxW - 1.4, LAYOUT.recvQueueStep - 0.7, 2.0, plasticMaterial(col[i].color));
        q.position.set(0, LAYOUT.recvQueueY - (i - 1) * LAYOUT.recvQueueStep, 0.4);
        q.castShadow = true;
        root.add(q);
        queued.push(q);
      }

      const label = makeLabel();
      label.position.set(0, LAYOUT.recvBoxY - 2.9, 2.4);
      root.add(label);

      this.group.add(root);
      this.cols.push({ root, box: boxGroup, body, fill, crown, inlet: inletMesh, glass, queued, label, active, swapT: 1, exitT: 0 });
    });
  }

  onComplete(r: Receiver) {
    this.cols[r.column].exitT = 0.0001;
  }

  private t = 0;

  update(dt: number) {
    this.t += dt;
    this.model.sand.columns.forEach((col, ci) => {
      const cv = this.cols[ci];
      const live = col.find((r) => r.state === 'active' || r.state === 'completing') ?? null;

      // Box exit + the next colour rising into the slot. One motion, no cut.
      if (cv.exitT > 0) {
        cv.exitT += dt * 1000 / (TUNING.RECEIVER_COMPLETE_DELAY + TUNING.RECEIVER_SWAP_DURATION);
        const t = Math.min(1, cv.exitT);
        const hold = TUNING.RECEIVER_COMPLETE_DELAY / (TUNING.RECEIVER_COMPLETE_DELAY + TUNING.RECEIVER_SWAP_DURATION);
        if (t < hold) {
          cv.box.position.y = LAYOUT.recvBoxY;
        } else {
          const k = (t - hold) / (1 - hold);
          cv.box.position.y = LAYOUT.recvBoxY - k * 16;
          cv.box.scale.setScalar(1 - k * 0.35);
        }
        if (t >= 1) {
          cv.exitT = 0;
          cv.swapT = 0;
          cv.box.scale.setScalar(1);
        }
      } else if (cv.swapT < 1) {
        cv.swapT = Math.min(1, cv.swapT + dt * 1000 / TUNING.RECEIVER_SWAP_DURATION);
        const e = 1 - Math.pow(1 - cv.swapT, 3);
        cv.box.position.y = LAYOUT.recvBoxY - 9 * (1 - e);
        cv.box.visible = !!live;
      } else {
        cv.box.position.y = LAYOUT.recvBoxY;
        cv.box.scale.x += (1 - cv.box.scale.x) * Math.min(1, dt * 14);
        cv.box.scale.y += (1 - cv.box.scale.y) * Math.min(1, dt * 14);
      }

      if (live && live !== cv.active) {
        cv.active = live;
        const c = COLORS[live.color];
        (cv.body.material as THREE.MeshPhysicalMaterial).color.setHex(c.hex);
        for (const m of [cv.fill, cv.crown, cv.inlet]) {
          (m.material as THREE.MeshStandardMaterial).color.setHex(c.light);
        }
      }
      cv.box.visible = !!live;

      // THE FILL IS THE PERCENTAGE. One number drives the column height, the
      // crown that rides on it, and the label — they cannot drift apart.
      const pct = live ? Math.min(1, live.fill / TUNING.RECEIVER_CAPACITY) : 0;
      const innerH = LAYOUT.recvBoxH - 2.0;
      const h = Math.max(0.001, innerH * pct);
      cv.fill.visible = pct > 0.002;
      cv.fill.scale.y = h;
      cv.fill.position.set(0, -innerH / 2 + h / 2, 1.7);
      cv.crown.visible = pct > 0.02 && pct < 0.995;
      cv.crown.scale.set(1, 0.5 + Math.sin(this.t * 2.2 + ci) * 0.06, 1);
      cv.crown.position.set(0, -innerH / 2 + h + 0.22, 1.7);

      // A heap in the mouth while sand is actually arriving.
      const heap = live ? Math.min(1, live.inlet / 14) : 0;
      cv.inlet.visible = heap > 0.03;
      cv.inlet.scale.set(0.5 + heap * 0.7, 0.6 + heap * 1.5, 0.5 + heap * 0.7);
      cv.inlet.position.set(0, innerH / 2 + 0.5, 1.9);

      // The completion pulse.
      if (live && live.pulse > 0) {
        const k = 1 + live.pulse * 0.09;
        cv.box.scale.set(k, 2 - k, 1);
      }

      // Queue slivers track the colours still to come — seeing GREEN two boxes
      // away is what turns "should I open that reservoir now?" into a judgement.
      const upcoming = col.filter((r) => r.state === 'queued');
      cv.queued.forEach((q, i) => {
        const r = upcoming[i];
        q.visible = !!r;
        if (r) (q.material as THREE.MeshPhysicalMaterial).color.setHex(COLORS[r.color].hex);
      });

      drawLabel(cv.label, live ? `${Math.round(live.fill)}%` : '', upcoming.length);
    });
  }
}

// ------------------------------------------------------------------ labels ---

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(8.2, 4.1, 1);
  sp.userData.canvas = canvas;
  sp.userData.tex = tex;
  sp.userData.last = '';
  return sp;
}

function drawLabel(sp: THREE.Sprite, text: string, remaining: number) {
  const key = `${text}|${remaining}`;
  if (sp.userData.last === key) return;
  sp.userData.last = key;
  const canvas = sp.userData.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  if (text) {
    ctx.font = 'bold 62px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(30,22,10,0.75)';
    ctx.strokeText(text, 128, 52);
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(text, 128, 52);
    if (remaining > 0) {
      ctx.font = 'bold 30px Arial, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeText(`+${remaining}`, 128, 104);
      ctx.fillStyle = '#f0e2c8';
      ctx.fillText(`+${remaining}`, 128, 104);
    }
  }
  (sp.userData.tex as THREE.CanvasTexture).needsUpdate = true;
}
