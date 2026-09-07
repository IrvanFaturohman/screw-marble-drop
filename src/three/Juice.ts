import * as THREE from 'three';
import { COLORS, TUNING, type MarbleColor } from '../config/GameConfig';

const MAX = 260;

/**
 * Restrained particles. The brief is explicit that the juice here is SYSTEM
 * motion — nine marbles pouring, a belt bunching, a box sliding out — so this
 * exists only to punctuate moments that already moved something.
 */
export class Juice {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private n = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, color: MarbleColor, count = 8, speed = 16) {
    if (!TUNING.juiceEnabled) return;
    const n = Math.round(count * TUNING.particleMultiplier);
    const c = new THREE.Color(COLORS[color].light);
    for (let i = 0; i < n && this.n < MAX; i++) {
      const k = this.n++;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.4;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[k * 3] = Math.cos(a) * s;
      this.vel[k * 3 + 1] = Math.sin(e) * s + 6;
      this.vel[k * 3 + 2] = Math.sin(a) * s * 0.4 + 4;
      this.col[k * 3] = c.r; this.col[k * 3 + 1] = c.g; this.col[k * 3 + 2] = c.b;
      this.max[k] = 0.45 + Math.random() * 0.3;
      this.life[k] = this.max[k];
    }
  }

  /** Colourless spark — for structural events that are not about a marble. */
  burstPlain(x: number, y: number, z: number, count = 6, speed = 12) {
    if (!TUNING.juiceEnabled) return;
    const n = Math.round(count * TUNING.particleMultiplier);
    for (let i = 0; i < n && this.n < MAX; i++) {
      const k = this.n++;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.vel[k * 3] = Math.cos(a) * s;
      this.vel[k * 3 + 1] = Math.sin(a) * s * 0.6 + 4;
      this.vel[k * 3 + 2] = Math.random() * 6;
      this.col[k * 3] = 1; this.col[k * 3 + 1] = 0.95; this.col[k * 3 + 2] = 0.8;
      this.max[k] = 0.3 + Math.random() * 0.22;
      this.life[k] = this.max[k];
    }
  }

  celebrate() {
    if (!TUNING.juiceEnabled) return;
    const colors: MarbleColor[] = ['red', 'blue', 'yellow', 'green'];
    for (let i = 0; i < 4; i++) {
      this.burst((Math.random() - 0.5) * 26, 6 + Math.random() * 14, 4, colors[i], 22, 30);
    }
  }

  update(dt: number) {
    for (let k = this.n - 1; k >= 0; k--) {
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        const last = --this.n;
        if (k !== last) {
          for (let j = 0; j < 3; j++) {
            this.pos[k * 3 + j] = this.pos[last * 3 + j];
            this.vel[k * 3 + j] = this.vel[last * 3 + j];
            this.col[k * 3 + j] = this.col[last * 3 + j];
          }
          this.life[k] = this.life[last]; this.max[k] = this.max[last];
        }
        continue;
      }
      this.vel[k * 3 + 1] -= 46 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 0.95;
  }

  reset() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}
