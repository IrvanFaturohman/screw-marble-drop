import * as THREE from 'three';
import { LAYOUT, TUNING } from '../config/GameConfig';
import { LEVELS } from '../config/LevelConfig';
import { GameModel } from './GameModel';
import { RapierDriver } from '../physics/RapierDriver';
import { World } from '../three/World';
import { StructureView } from '../three/StructureView';
import { TrackView } from '../three/TrackView';
import { MarbleView } from '../three/MarbleView';
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
  private marbles!: MarbleView;
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
    const driver = await RapierDriver.create(level);
    this.model = new GameModel(level, driver);
    this.ended = false;

    this.structure = new StructureView(this.model);
    this.track = new TrackView(this.model, level);
    this.marbles = new MarbleView(this.model);
    this.receivers = new ReceiverView(this.model);
    this.juice = new Juice();

    this.world.root.add(this.structure.group, this.track.group, this.receivers.group, this.marbles.mesh, this.juice.points);
    this.wireEvents();
    this.hud.reset();
    this.hud.setLevel(this.levelIndex + 1, LEVELS.length, level.name);

    debugPanel.attach({
      restart: () => this.restart(),
      releaseBatch: () => {
        const pk = this.model.source.pockets.find((x) => !x.open && !x.drained);
        if (pk) this.model.source.debugOpenPocket(pk);
      },
      clearConveyor: () => this.model.debugClearConveyor(),
      fillConveyor: () => this.model.debugFillConveyor(TUNING.CONVEYOR_CAPACITY - 2),
      completeExposed: () => this.model.sorting.debugCompleteExposed(),
      toggleDebug: () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); },
      stats: () => {
        const s = this.model.state();
        return `${this.fps.toFixed(0)}fps  belt ${s.belt}  air ${s.airborne}  rack ${s.marblesInRack}  boxes ${s.boxesLeft}`;
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
    m.events.onRelease = (_pk, marble) => {
      // One clatter per few marbles — nine individual pops would be mush.
      if (marble.id % 3 === 0) audio.tick(0.35 + Math.random() * 0.3);
    };
    m.events.onUnlocked = () => { audio.reveal(); };
    // Tight is not dead. Say so, so a full belt does not read as a loss.
    m.events.onBeltFull = () => {
      if (m.jammed) this.hud.flashHint('NOTHING FITS — BELT JAMMED');
      else this.hud.flashHint('BELT FULL — WAITING FOR A SLOT');
    };
    m.events.onMarbleLanded = () => { audio.land(); };
    m.events.onSocketFilled = (r, i) => {
      audio.snap(i); haptics.snap(i);
      this.receivers.onSocketFilled(r);
      const p = { x: LAYOUT.recvColX[r.column] + (i - 1) * LAYOUT.recvSocketDX, y: LAYOUT.recvBoxY + LAYOUT.recvSocketDY };
      this.juice.burst(p.x, p.y, LAYOUT.beltZ + 1, r.color, 5, 9);
      this.hud.dismissHint();
    };
    m.events.onReceiverComplete = (r) => {
      audio.complete(); haptics.complete();
      this.receivers.onComplete(r);
      this.juice.burst(LAYOUT.recvColX[r.column], LAYOUT.recvBoxY + 2, 3, r.color, 12, 18);
    };
    m.events.onReceiverExposed = (r) => {
      audio.reveal();
      const waiting = m.sorting.belt.filter((b) => b.color === r.color).length;
      // The chain the whole design is built around — call it out once, briefly.
      if (waiting > 0) this.hud.flashHint(`${r.color.toUpperCase()} OPEN — ${waiting} draining`);
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
      const pk = this.model.source.pockets.find((x) => !x.open && !x.drained);
      if (pk) this.model.source.debugOpenPocket(pk);
    });
    key('KeyS', () => { this.showDebug = !this.showDebug; this.hud.setDebug(this.showDebug); });
    key('KeyF', () => this.model.debugFillConveyor(TUNING.CONVEYOR_CAPACITY - 2));
    key('KeyC', () => this.model.debugClearConveyor());
    key('KeyN', () => this.model.sorting.debugCompleteExposed());
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
    this.marbles.update();
    this.receivers.update(dt);
    this.juice.update(dt);
    this.world.update(raw);
    this.hud.update(this.model, this.showDebug ? this.debugText() : null);

    const load = this.model.sorting.load / this.model.sorting.capacity;
    audio.setHum(load);
    if (load >= 0.8 && now - this.warnedAt > 2600) {
      this.warnedAt = now;
      audio.warn(); haptics.warn();
    }
    debugPanel.tick();

    this.world.render();
  }

  private debugText() {
    const m = this.model, src = m.source;
    const screws = src.screws.filter((s) => !s.removed).map((s) => {
      const b = src.activeBlockers(s).map((p) => p.id).join(',');
      return `${s.id.padEnd(11)} ${s.plateId.padEnd(10)} ${src.isAccessible(s) ? 'OPEN' : 'blocked by ' + b}`;
    });
    const plates = src.plates.filter((p) => p.present).map((p) =>
      `${p.id.padEnd(10)} z${String(p.z).padStart(5)} ${p.supports}sup ${p.state.padEnd(9)} ${((p.angle * 180) / Math.PI).toFixed(0)}deg`);
    const pockets = src.pockets.filter((p) => !p.drained).map((p) =>
      `${p.id.padEnd(9)} ${p.color.padEnd(6)} ${String(p.pending).padStart(2)}/${p.total} ${p.def.kind.padEnd(12)} @${p.def.releaseAt}${p.open ? ' POURING' : ''}`);
    return [
      `fps ${this.fps.toFixed(0)}  bodies ${m.driver.activeCount}  marbles ${m.marbles.length}`,
      `belt ${m.sorting.load}/${m.sorting.capacity}  air ${m.airborne}  boxes ${m.sorting.boxesLeft}/${m.sorting.boxesTotal}`,
      `exposed ${m.sorting.activeReceivers().map((r) => `${r.color}:${r.filled}/3`).join('  ')}`,
      '', 'SCREWS', ...screws, '', 'PLATES', ...plates, '', 'POCKETS', ...pockets,
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
    this.model.driver.reset();
    return this.build().then(() => {
      this.last = performance.now();
      const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
      this.raf = requestAnimationFrame(loop);
    });
  }
}
