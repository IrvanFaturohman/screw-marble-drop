import { COLORS, TUNING } from '../config/GameConfig';
import type { GameModel } from '../game/GameModel';
import { LEVELS } from '../config/LevelConfig';
import { audio } from '../services';

/**
 * DOM overlay, not in-scene geometry: crisp text at any DPR for free, and it
 * keeps the 3D board free of billboards. Budget is the brief's 5-7%.
 */
export class Hud {
  private root: HTMLElement;
  private marbles: HTMLElement;
  private boxes: HTMLElement;
  private bar: HTMLElement;
  private belt: HTMLElement;
  private beltFill: HTMLElement;
  private levelTag!: HTMLElement;
  private hint: HTMLElement;
  private overlay: HTMLElement;
  private debug: HTMLElement;
  private hintTimer = 0;
  private lastBeltClass = '';

  constructor(private onRestart: () => void) {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="hud-bar">
        <div class="hud-pill"><b id="hud-marbles">90</b><span>MARBLES</span></div>
        <div class="hud-progress"><div id="hud-bar"></div></div>
        <div class="hud-pill"><b id="hud-boxes">30</b><span>BOXES</span></div>
        <button id="hud-mute" aria-label="mute">${audio.muted ? '🔇' : '🔊'}</button>
      </div>
      <div id="hud-belt" class="hud-belt"><span id="hud-belt-txt">0/${TUNING.CONVEYOR_CAPACITY}</span><i id="hud-belt-fill"></i></div>
      <div id="hud-level" class="hud-level"></div>
      <div id="hud-hint" class="hud-hint"></div>
      <pre id="hud-debug" class="hud-debug hidden"></pre>
      <div id="hud-overlay" class="hud-overlay hidden"></div>
    `;
    this.marbles = document.getElementById('hud-marbles')!;
    this.boxes = document.getElementById('hud-boxes')!;
    this.bar = document.getElementById('hud-bar')!;
    this.belt = document.getElementById('hud-belt')!;
    this.beltFill = document.getElementById('hud-belt-fill')!;
    this.levelTag = document.getElementById('hud-level')!;
    this.hint = document.getElementById('hud-hint')!;
    this.debug = document.getElementById('hud-debug')!;
    this.overlay = document.getElementById('hud-overlay')!;
    document.getElementById('hud-mute')!.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.init();
      (e.currentTarget as HTMLElement).textContent = audio.toggleMute() ? '🔇' : '🔊';
    });
  }

  /** Which board this is. Named, because the two play very differently. */
  setLevel(n: number, total: number, name: string) {
    this.levelTag.textContent = `LEVEL ${n}/${total} · ${name}`;
  }

  reset() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.hint.classList.remove('show');
  }

  setDebug(on: boolean) { this.debug.classList.toggle('hidden', !on); }

  flashHint(text: string) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = performance.now() + 1900;
  }
  /** A hint that stays put. A jam is not an event you might have missed, it is
   *  the state the board is now in, so it does not time out. */
  holdHint(text: string) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = 0;
  }
  dismissHint() { this.hintTimer = Math.min(this.hintTimer, performance.now() + 260); }

  update(m: GameModel, debugText: string | null) {
    const left = m.source.marblesLeft + m.airborne + m.sorting.load;
    this.marbles.textContent = String(left);
    this.boxes.textContent = String(m.sorting.boxesLeft);
    const done = 1 - m.sorting.boxesLeft / m.sorting.boxesTotal;
    this.bar.style.width = `${(done * 100).toFixed(1)}%`;

    const load = m.sorting.load, cap = m.sorting.capacity;
    const p = load / cap;
    (document.getElementById('hud-belt-txt') as HTMLElement).textContent =
      `${load}/${cap}${m.airborne ? `  +${m.airborne}` : ''}`;
    this.beltFill.style.width = `${Math.min(100, p * 100).toFixed(1)}%`;
    const cls = p >= 0.88 ? 'danger' : p >= 0.6 ? 'warn' : '';
    if (cls !== this.lastBeltClass) {
      this.belt.classList.remove('warn', 'danger');
      if (cls) this.belt.classList.add(cls);
      this.lastBeltClass = cls;
    }

    if (this.hintTimer && performance.now() > this.hintTimer) {
      this.hint.classList.remove('show');
      this.hintTimer = 0;
    }
    if (debugText !== null) this.debug.textContent = debugText;
  }

  /**
   * The WIN panel. There is no losing one.
   *
   * A jam leaves the board running and the marbles piling up, and a panel over
   * the top of that would hide the only thing the player needs to see. Losing
   * says so with `holdHint` and a tap-anywhere restart instead.
   */
  showOverlay(m: GameModel, lv?: { level: number; total: number; name: string; more: boolean }) {
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="panel win">
        <h1>${lv?.more ? `LEVEL ${lv.level} CLEAR` : 'ALL LEVELS CLEAR'}</h1>
        <p>${m.taps} taps · ${m.sorting.boxesTotal} boxes packed</p>
        <button id="hud-restart">${lv?.more ? `NEXT: ${LEVELS[lv.level].name}` : 'PLAY AGAIN'}</button>
      </div>`;
    const btn = document.getElementById('hud-restart')!;
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.onRestart(); });
  }
}

export { COLORS, TUNING };
