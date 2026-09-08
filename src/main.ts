import { TUNING } from './config/GameConfig';
import { Game } from './game/Game';
import { audio, debugPanel } from './services';

// Audio contexts only start inside a gesture — unlock on the first one, anywhere.
const unlock = () => audio.init();
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('touchstart', unlock, { passive: true });
window.addEventListener('keydown', unlock);

const stage = document.getElementById('stage')!;
const game = new Game(stage);

/**
 * Test/debug harness. Browsers suspend requestAnimationFrame in a background
 * tab, so `__smd.step(n)` drives the loop by hand — that is what makes an
 * automated play-through reproducible from the console.
 */
const harness = {
  game,
  get model() { return game.model; },
  /** Advance simulation AND rendering without waiting on rAF. */
  step(n = 1, dtMs = 1000 / 60) { game.stepFrames(n, dtMs); },
  /** Advance the simulation only — faster when the picture does not matter. */
  sim(n = 1, dtMs = 1000 / 60) { for (let i = 0; i < n; i++) game.model.update(dtMs); },
  /** Pull a screw by id. False if it is not currently legal. */
  tap(id: string) {
    const s = game.model.source.screwById.get(id);
    if (!s) return false;
    return game.model.pull(s);
  },
  /** Tap at world coordinates, exactly like a finger would. */
  tapAt(x: number, y: number) { return game.model.tap(x, y); },
  /** Every screw the player could legally pull right now. */
  open() { return game.model.source.accessible().map((s) => s.id); },
  state() { return game.model.state(); },
  /** Full structural readout: what is blocking what, and what is still loaded. */
  screws() {
    const src = game.model.source;
    return src.screws.map((s) => ({
      id: s.id, plate: s.plateId, removed: s.removed,
      open: src.isAccessible(s),
      blockedBy: src.activeBlockers(s).map((p) => p.id),
      covering: src.coveringPlates(s).map((p) => p.id),
    }));
  },
  plates() {
    return game.model.source.plates.map((p) => ({
      id: p.id, z: p.z, state: p.state, supports: p.supports,
      screws: p.screws.map((s) => s.id),
      angleDeg: +((p.angle * 180) / Math.PI).toFixed(1),
    }));
  },
  /** Every sand reservoir: how much is left, how much is piled at its throat. */
  reservoirs() {
    return game.model.sand.reservoirs.map((r) => ({
      id: r.id, color: r.color, state: r.state,
      left: +r.remaining.toFixed(1), of: r.total,
      pile: +r.pile.toFixed(1),
    }));
  },
  /** The shared channel, per colour. */
  buffer() {
    const s = game.model.sand;
    return { percent: +s.bufferPercent.toFixed(1), volume: +s.bufferVolume.toFixed(1),
             byColor: s.bufferByColor(), runs: s.segments.length };
  },

  /** Await it: the scene is rebuilt asynchronously. */
  restart() { return game.restart(); },
  /** Win -> next board, lose -> the same one again. Await it. */
  advance() { return game.advance(); },
  /** Jump straight to a board, 1-based. Await it. */
  level(n: number) { return game.goToLevel(n); },
  tuning: TUNING,
  debugPanel,
};
(window as unknown as Record<string, unknown>).__smd = harness;

void game.start();
