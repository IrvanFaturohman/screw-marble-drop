import * as THREE from 'three';
import { ASPECT, BOARD_H, BOARD_W, ENV, TUNING } from '../config/GameConfig';

/**
 * Renderer, camera and lights.
 *
 * The camera is FIXED: front-facing, slightly elevated, orthographic. It never
 * orbits, never follows, never zooms. 3D here buys volume, real sphere physics,
 * material and shadow — not camera exploration — and an orthographic frustum is
 * what keeps a 390x844 puzzle board mapping to exact screen bands while still
 * showing the tops of the chambers.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly root = new THREE.Group();

  private shakeT = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  private baseCamPos = new THREE.Vector3();

  constructor(private stage: HTMLElement) {
    this.scene.background = new THREE.Color(ENV.bgTop);
    this.scene.add(this.root);

    // DEAD-ON. A screw puzzle is read straight down onto the board: every screw
    // head is a circle, every plank is its true rectangle, and the over/under
    // order comes from occlusion alone. The old 15 degrees of tilt turned every
    // screw into an ellipse and let you see the sides of things, which is what
    // made a flat board look like a diorama and hid half the heads.
    const dist = 120;
    const halfH = BOARD_H / 2 + 0.6;
    const halfW = halfH * ASPECT;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 400);
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.baseCamPos.copy(this.camera.position);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      // Dev only: lets the debug harness read a frame back with
      // `canvas.toDataURL()`. Without it the drawing buffer is cleared after
      // present and every grab comes back empty, which makes it impossible to
      // inspect a mid-game frame in a backgrounded tab.
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Filmic curves desaturate highlights, which is exactly the pale look we do
    // not want on glossy toy resin. Keep colours literal.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(this.renderer.domElement);

    this.scene.environment = buildEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;
    this.addLights();
    this.addBackdrop();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0xbfa87e, 0.62));

    const key = new THREE.DirectionalLight(0xfff6e6, 1.42);
    key.position.set(-30, 54, 82);
    key.target.position.set(0, 4, 0);
    key.castShadow = true;
    const small = Math.min(window.screen.width, window.screen.height) < 520;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    const s = 52;
    const cam = key.shadow.camera;
    cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
    cam.near = 20; cam.far = 190;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.35;
    this.scene.add(key, key.target);

    // Cool bounce so shadowed faces keep their hue instead of going muddy.
    const fill = new THREE.DirectionalLight(0xc8ddff, 0.34);
    fill.position.set(48, 10, 40);
    this.scene.add(fill);
  }

  /** A quiet warm table behind everything. Very low detail on purpose. */
  private addBackdrop() {
    const g = new THREE.PlaneGeometry(BOARD_W * 2.4, BOARD_H * 1.6);
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#f8f0e3');
    grad.addColorStop(0.55, '#efe3ce');
    grad.addColorStop(1, '#d8c8ab');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(0, 0, -18);
    m.renderOrder = -10;
    this.scene.add(m);

    // Catch shadows so the apparatus sits on something.
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W * 1.6, BOARD_H * 1.2),
      new THREE.ShadowMaterial({ opacity: 0.11 }),
    );
    shadowPlane.position.set(0, 0, -8);
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);
  }

  // ------------------------------------------------------------------ feel
  shake(amp: number, dur = 180) {
    if (!TUNING.juiceEnabled) return;
    if (amp * TUNING.cameraShakeIntensity <= this.shakeAmp && this.shakeT < this.shakeDur) return;
    this.shakeAmp = amp * TUNING.cameraShakeIntensity;
    this.shakeT = 0; this.shakeDur = dur;
  }

  update(rawMs: number) {
    if (this.shakeT < this.shakeDur) {
      this.shakeT += rawMs;
      const k = 1 - Math.min(1, this.shakeT / this.shakeDur);
      const a = this.shakeAmp * k * k;
      this.camera.position.set(
        this.baseCamPos.x + (Math.random() * 2 - 1) * a,
        this.baseCamPos.y + (Math.random() * 2 - 1) * a,
        this.baseCamPos.z,
      );
    } else if (!this.camera.position.equals(this.baseCamPos)) {
      this.camera.position.copy(this.baseCamPos);
      this.shakeAmp = 0;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  resize() {
    const w = this.stage.clientWidth || 1;
    const h = this.stage.clientHeight || 1;
    this.renderer.setSize(w, h, false);
  }

  /** Screen point -> world point on the z = `z` plane. For tapping screws. */
  screenToWorld(clientX: number, clientY: number, z: number, out: THREE.Vector3) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    ray.ray.intersectPlane(plane, out);
    return out;
  }
}

/** Small procedural studio env map — reflections do most of the shading work. */
function buildEnvironment(renderer: THREE.WebGLRenderer) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#dfe9f5');
  g.addColorStop(0.75, '#b9a98d');
  g.addColorStop(1, '#7d7161');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  // A soft key blob so spheres get a readable specular hit.
  const b = ctx.createRadialGradient(20, 14, 1, 20, 14, 18);
  b.addColorStop(0, 'rgba(255,255,255,1)');
  b.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = b; ctx.fillRect(0, 0, 64, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  return env;
}
