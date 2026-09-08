import * as THREE from 'three';
import { COLORS, ENV, LAYOUT, TUNING } from '../config/GameConfig';
import type { GameModel } from '../game/GameModel';
import { socketPos, type Receiver } from '../game/SortingModel';
import { box, frameMaterial, GEO, metalMaterial, plasticMaterial } from './Materials';

interface ColumnView {
  root: THREE.Group;
  /** The live box. Retextured in place as the column advances. */
  box: THREE.Group;
  body: THREE.Mesh;
  sockets: THREE.Mesh[];
  tray: THREE.Mesh;
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
    model.sorting.columns.forEach((col, ci) => {
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

      // Recessed tray + three obvious sockets. The tray takes a darker shade of
      // the box colour rather than near-black: a black bar behind three black
      // holes reads as one slot, and the player has to count sockets at a glance.
      const trayMat = new THREE.MeshStandardMaterial({ color: COLORS[active.color].deep, roughness: 0.7 });
      const tray = box(LAYOUT.recvBoxW - 1.6, 3.6, 0.6, trayMat);
      tray.position.set(0, LAYOUT.recvSocketDY, 1.7);
      boxGroup.add(tray);
      const sockets: THREE.Mesh[] = [];
      for (let i = 0; i < TUNING.RECEIVER_CAPACITY; i++) {
        const rim = new THREE.Mesh(GEO.socket, new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.5 }));
        rim.scale.set(1.5, 0.35, 1.5);
        rim.rotation.x = Math.PI / 2;
        rim.position.set((i - 1) * LAYOUT.recvSocketDX, LAYOUT.recvSocketDY, 1.86);
        boxGroup.add(rim);
        const s = new THREE.Mesh(GEO.socket, new THREE.MeshStandardMaterial({ color: 0x171510, roughness: 0.95 }));
        s.scale.set(1.24, 0.5, 1.24);
        s.rotation.x = Math.PI / 2;
        s.position.set((i - 1) * LAYOUT.recvSocketDX, LAYOUT.recvSocketDY, 1.92);
        boxGroup.add(s);
        sockets.push(s);
      }
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
      this.cols.push({ root, box: boxGroup, body, sockets, tray, queued, label, active, swapT: 1, exitT: 0 });
    });
  }

  /** A marble snapped home. Punch the box so the hit registers. */
  onSocketFilled(r: Receiver) {
    const cv = this.cols[r.column];
    cv.box.scale.set(1.07, 0.93, 1);
  }

  onComplete(r: Receiver) {
    this.cols[r.column].exitT = 0.0001;
  }

  update(dt: number) {
    this.model.sorting.columns.forEach((col, ci) => {
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
        (cv.body.material as THREE.MeshPhysicalMaterial).color.setHex(COLORS[live.color].hex);
        (cv.tray.material as THREE.MeshStandardMaterial).color.setHex(COLORS[live.color].deep);
      }
      cv.box.visible = !!live;

      // Sockets light up as they fill.
      const filled = live ? Math.min(live.filled, TUNING.RECEIVER_CAPACITY) : 0;
      cv.sockets.forEach((s, i) => {
        const m = s.material as THREE.MeshStandardMaterial;
        const on = i < filled;
        m.color.setHex(on && live ? COLORS[live.color].light : 0x1b1912);
        m.emissive.setHex(on && live ? COLORS[live.color].deep : 0x000000);
      });

      // Queue slivers track the colours still to come.
      const upcoming = col.filter((r) => r.state === 'queued');
      cv.queued.forEach((q, i) => {
        const r = upcoming[i];
        q.visible = !!r;
        if (r) (q.material as THREE.MeshPhysicalMaterial).color.setHex(COLORS[r.color].hex);
      });

      drawLabel(cv.label, live ? `${filled}/${TUNING.RECEIVER_CAPACITY}` : '', upcoming.length);
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
