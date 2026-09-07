import * as THREE from 'three';
import { COLORS, TUNING } from '../config/GameConfig';
import type { GameModel } from '../game/GameModel';
import { GEO, marbleMaterial } from './Materials';

const MAX_MARBLES = 140;

/**
 * Every marble outside a chamber, in ONE instanced mesh.
 *
 * A batch release can put 27 spheres in the air at once and the belt holds up to
 * 24 more; individual meshes would mean ~60 draw calls and 60 shadow casters for
 * objects that are all the same sphere. One InstancedMesh with per-instance
 * colour is a single draw call, which is what keeps the mass release cheap
 * enough to be the point of the game.
 */
export class MarbleView {
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(private model: GameModel) {
    this.mesh = new THREE.InstancedMesh(GEO.marble, marbleMaterial(), MAX_MARBLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update() {
    const list = this.model.marbles;
    let n = 0;
    for (const m of list) {
      if (n >= MAX_MARBLES) break;
      this.dummy.position.set(m.x, m.y, m.z);
      // Roll about the travel axis. Cheap, but it is what makes them read as
      // spheres rather than discs while they ride the belt.
      this.dummy.rotation.set(m.spin * 0.9, m.spin * 0.5, m.spin * 0.3);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);

      // A marble with nowhere to go rides dimmer, and dimmer still once it has
      // circled a full lap — the belt shows both your debt and how old it is.
      let dim = 1;
      if (m.state === 'belt') {
        const homeless = !this.model.sorting.destinationFor(m.color);
        if (homeless) {
          const b = this.model.sorting.belt.find((x) => x.id === m.id);
          dim = b && b.laps > 0 ? 0.6 : 0.76;
        }
      }
      this.color.setHex(COLORS[m.color].hex).multiplyScalar(dim);
      this.mesh.setColorAt(n, this.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export { MAX_MARBLES };
