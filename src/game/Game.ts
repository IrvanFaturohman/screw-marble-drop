import * as THREE from 'three';
import { LAYOUT, TUNING } from '../config/GameConfig';
import { LEVELS } from '../config/LevelConfig';
import { GameModel } from './GameModel';
import { World } from '../three/World';
import { StructureView } from '../three/StructureView';
import { TrackView } from '../three/TrackView';
import { SandView } from '../three/SandView';
import { ReceiverView } from '../three/ReceiverView';
import { Juice } from '../three/Juice';
import { Hud } from '../ui/Hud';
import { audio, debugPanel, haptics } from '../services';

/**
 * Glue: owns the model, the 3D views, and the feel layer.
 *
 * Every gameplay decision lives in GameModel; this file only listens and reacts.
 * Views subscribe exclusively to `model.events` — never to the sub-models —
 * because those slots are single-assignment and overwriting one would silently
 * disable the model's own bookkeeping.
 */
export class Game {
  model!: GameModel;
  private world: World;
  private structure!: StructureView;
  private track!: TrackView;
  private sand!: SandView;
  /** Volume that crossed a throat this frame; drives the pour hiss. */
  private pourLoudness = 0;
  private receivers!: ReceiverView;
  private juice!: Juice;
  private hud: Hud;

  private last = 0;
  private raf = 0;
  private ended = false;
  private tmp = new THREE.Vector3();
  private warnedAt = 0;
  showDebug = false;

  constructor(private stage: HTMLElement) {
    this.world = new World(stage);
    this.hud = new Hud(() => this.advance());
  }

  async start() {
    await this.build();
    this.bindInput();
    this.last = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Index into LEVELS. Winning advances it; losing replays the same board. */
  private levelIndex = 0;
  get level() { return LEVELS[this.levelIndex]; }

  private async build() {
    const level = this.level;
    this.model = new GameModel(level);
    this.ended = false;

    this.structure = new StructureView(this.model);
    this.track = new TrackView(this.model, level);
    this.sand = new SandView(this.model);
    this.receivers = new ReceiverView(this.model);
    this.juice = new Juice();

    this.world.root.add(this.structure.group, this.track.group, this.receivers.group, this.sand.group, this.juice.points);
    this.wireEvents();
    this.hud.reset();
    this.hud.setLevel(this.levelIndex + 1, LEVELS.length, level.name);

    debugPanel.attach({
      restart: () => this.restart(),
      releaseBatch: () => {
        const pk = this.model.source.pockets.find((x) => !x.open);
        if (pk) this.model.source.debugOpenPocket(pk);
      },
      clearConveyor: () => this.model.debugClearBuffer(),
      fillConveyor: () => this.model.debugFillBuffer(0.9),
      completeExposed: () => this.model.debugCompleteExposed(),
      toggleDebug: () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); },
      stats: () => {
        const s = this.model.state();
        return `${this.fps.toFixed(0)}fps  buffer ${s.buffer}  grains ${this.sand.liveGrains}`
          + `  sand ${s.sandInStructure.toFixed(0)}  flight ${s.inFlight.toFixed(0)}  recv ${s.receiversLeft}`;
      },
    });
  }

  // ------------------------------------------------------------------ wiring

  private wireEvents() {
    const m = this.model;

    m.events.onTap = () => { audio.twist(); haptics.twist(); };
    m.events.onBlockedTap = (_s, blocker) => {
      audio.blocked(); haptics.blocked();
      if (blocker) this.structure.nudge(blocker);
      this.hud.flashHint(blocker ? `COVERED BY ${blocker.id.toUpperCase()}` : 'COVERED');
    };
    m.events.onScrewOut = (screw, plate) => {
      audio.pop(); haptics.pop();
      this.structure.screwWorld(screw, this.tmp);
      this.juice.burstPlain(this.tmp.x, this.tmp.y, this.tmp.z, 6, 12);
      // Losing a support is the beat the whole upper puzzle turns on — say it.
      if (plate.supports === 1) audio.detach();
    };
    m.events.onPlatePartial = () => { audio.detach(); haptics.thud(0.35); };
    m.events.onPlateRelease = (p) => {
      audio.detach(); haptics.thud(0.6);
      if (p.def.shape.kind !== 'bar') this.world.shake(0.5, 150);
    };
    m.events.onPocketOpen = (pk) => {
      this.structure.pocketWorld(pk, this.tmp);
      this.juice.burst(this.tmp.x, this.tmp.y, this.tmp.z, pk.color, 10, 14);
    };
    m.events.onUnlocked = () => { audio.reveal(); };
    // Sand is continuous, so its sound is too: one running hiss whose level
    // follows how much is actually crossing throats, not a click per grain.
    m.events.onThroatFlow = (r, v) => { this.pourLoudness += v; this.sand.emitThroat(r, v); };
    m.events.onNeckFlow = (c, v) => { this.pourLoudness += v * 0.4; this.sand.emitNeck(c, v); };
    m.events.onReceiverFlow = (r, v) => this.sand.emitReceiver(r, v);
    m.events.onReceiverComplete = (r) => {
      audio.complete(); haptics.complete();
      this.receivers.onComplete(r);
      this.juice.burst(LAYOUT.recvColX[r.column], LAYOUT.recvBoxY + 2, 3, r.color, 12, 18);
    };
    m.events.onReceiverExposed = (r) => {
      audio.reveal();
      const waiting = Math.round(m.sand.bufferByColor()[r.color] ?? 0);
      // The chain the whole design is built around — call it out once, briefly.
      if (waiting > 2) this.hud.flashHint(`${r.color.toUpperCase()} OPEN — ${waiting} DRAINING`);
    };
    m.events.onWin = () => this.finish(true);
    m.events.onLose = () => this.finish(false);
  }

  private bindInput() {
    const el = this.world.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      audio.init();
      if (this.ended || this.model.phase !== 'play') return;
      this.world.screenToWorld(e.clientX, e.clientY, LAYOUT.screwZ, this.tmp);
      this.model.tap(this.tmp.x, this.tmp.y);
    });

    const key = (code: string, fn: () => void) => {
      window.addEventListener('keydown', (e) => { if (e.code === code) fn(); });
    };
    key('KeyR', () => this.restart());
    key('Digit1', () => { TUNING.GAME_SPEED = 1; debugPanel.sync(); });
    key('Digit2', () => { TUNING.GAME_SPEED = 2; debugPanel.sync(); });
    key('Digit4', () => { TUNING.GAME_SPEED = 4; debugPanel.sync(); });
    key('KeyB', () => { const s2 = this.model.source.accessible()[0]; if (s2) this.model.pull(s2); });
    key('KeyM', () => {
      const pk = this.model.source.pockets.find((x) => !x.open);
      if (pk) this.model.source.debugOpenPocket(pk);
    });
    key('KeyS', () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); });
    key('KeyF', () => this.model.debugFillBuffer(0.9));
    key('KeyC', () => this.model.debugClearBuffer());
    key('KeyN', () => this.model.debugCompleteExposed());
    key('KeyD', () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); });
    key('KeyG', () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); });
    key('KeyP', () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); });
    key('KeyU', () => audio.toggleMute());
    key('Backquote', () => debugPanel.toggle());
  }

  // -------------------------------------------------------------------- loop

  private fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;

  /**
   * Advance model + views + render by a fixed step, without waiting on rAF.
   *
   * Browsers suspend requestAnimationFrame in a background tab, so an automated
   * play-through has to drive the frame by hand. Same code path as the live
   * loop, just with a supplied delta.
   */
  stepFrames(n = 1, dtMs = 1000 / 60) {
    for (let i = 0; i < n; i++) this.frame(dtMs);
    this.last = performance.now();
  }

  private tick() {
    const now = performance.now();
    const raw = Math.min(now - this.last, 50);
    this.last = now;
    this.frame(raw);
  }

  /** Simulated clock, so a hand-driven frame gets the same timings as a live one. */
  private clock = 0;

  private frame(raw: number) {
    this.clock += raw;
    const now = this.clock;

    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc > 400) { this.fps = 1000 / (this.fpsAcc / this.fpsN); this.fpsAcc = 0; this.fpsN = 0; }

    if (!this.ended) this.model.update(raw);

    const dt = raw / 1000;
    this.structure.update(dt);
    this.track.update(dt);
    this.sand.update(dt);
    this.receivers.update(dt);
    this.juice.update(dt);
    this.world.update(raw);
    this.hud.update(this.model, this.showDebug ? this.debugText() : null);

    const load = this.model.sand.bufferPercent / 100;
    audio.setHum(load);
    // A running hiss while material is actually crossing throats, scaled by how
    // much. Continuous material wants a continuous sound, never a click a grain.
    audio.setPour(Math.min(1, this.pourLoudness / (raw * 0.06 + 1e-6)));
    this.pourLoudness = 0;
    if (load >= 0.8 && now - this.warnedAt > 2600) {
      this.warnedAt = now;
      audio.warn(); haptics.warn();
    }
    debugPanel.tick();

    this.world.render();
  }

  private debugText() {
    const m = this.model, src = m.source, sand = m.sand;
    const screws = src.screws.filter((s) => !s.removed).map((s) => {
      const trapped = (src.platesByScrew.get(s.id) ?? []).map((p) => p.id).join('+');
      return `${s.id.padEnd(11)} holds ${trapped}`;
    });
    const plates = src.plates.filter((p) => p.present).map((p) => {
      const t = src.trappedBy(p);
      return `${p.id.padEnd(10)} z${String(p.z).padStart(5)} ${p.supports}sup ${p.state.padEnd(9)}`
        + `${p.loose ? ' LOOSE' : ''}${t ? ' under ' + t.id : ''}`;
    });
    const res = sand.reservoirs.filter((r) => r.state !== 'empty').map((r) =>
      `${r.id.padEnd(9)} ${r.color.padEnd(6)} ${r.remaining.toFixed(0).padStart(4)}u`
      + ` pile ${r.pile.toFixed(0).padStart(3)}u  ${r.state}`);
    const byCol = sand.bufferByColor();
    return [
      `fps ${this.fps.toFixed(0)}  grains ${this.sand.liveGrains}/${TUNING.VISUAL_PARTICLE_COUNT}`,
      `buffer ${sand.bufferVolume.toFixed(0)}/${TUNING.BUFFER_CAPACITY} = ${Math.round(sand.bufferPercent)}%`,
      `  ${(Object.keys(byCol) as (keyof typeof byCol)[]).map((c) => `${c[0]}:${byCol[c].toFixed(0)}`).join('  ')}`,
      `funnel ${sand.funnel.reduce((n, f) => n + f.volume, 0).toFixed(0)}u   in flight ${sand.inFlight.toFixed(0)}u`,
      `rates  src ${TUNING.SOURCE_FLOW_RATE} > throat ${TUNING.MAIN_THROAT_FLOW_RATE} > neck ${TUNING.BUFFER_INPUT_RATE}`,
      `exposed ${sand.activeReceivers().map((r) => `${r.color}:${Math.round(r.fill)}%`).join('  ')}`,
      `receivers ${sand.receiversLeft}/${sand.receiversTotal}`,
      '', 'SCREWS', ...screws, '', 'PLANKS', ...plates, '', 'RESERVOIRS', ...res,
    ].join('\n');
  }

  // ------------------------------------------------------------- end states

  private finish(won: boolean) {
    if (this.ended) return;
    this.ended = true;
    if (won) { audio.win(); haptics.win(); this.juice.celebrate(); /* the sculpture has already dismantled itself */ }
    else { audio.fail(); haptics.fail(); this.world.shake(1.4, 260); }
    const more = won && this.levelIndex < LEVELS.length - 1;
    setTimeout(() => this.hud.showOverlay(won, this.model, {
      level: this.levelIndex + 1, total: LEVELS.length, name: this.level.name, more,
    }), won ? 500 : 340);
  }

  /** Win -> next board. Lose -> the same one again. */
  advance(): Promise<void> {
    if (this.model.phase === 'won' && this.levelIndex < LEVELS.length - 1) this.levelIndex++;
    return this.restart();
  }

  /** Jump straight to a board, 1-based. For the debug harness. */
  goToLevel(n: number): Promise<void> {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, n - 1));
    return this.restart();
  }

  /** Returns once the new scene is built, so a test can act on it immediately. */
  restart(): Promise<void> {
    cancelAnimationFrame(this.raf);
    this.world.root.clear();
    return this.build().then(() => {
      this.last = performance.now();
      const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
      this.raf = requestAnimationFrame(loop);
    });
  }
}
