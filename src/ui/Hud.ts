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
        <div class="hud-pill"><b id="hud-marbles">0</b><span>SAND LEFT</span></div>
        <div class="hud-progress"><div id="hud-bar"></div></div>
        <div class="hud-pill"><b id="hud-boxes">0</b><span>JARS</span></div>
        <button id="hud-mute" aria-label="mute">${audio.muted ? '🔇' : '🔊'}</button>
      </div>
      <div id="hud-belt" class="hud-belt"><span id="hud-belt-txt">0%</span><i id="hud-belt-fill"></i></div>
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
  dismissHint() { this.hintTimer = Math.min(this.hintTimer, performance.now() + 260); }

  /** Percentages move a step at a time toward the truth, so a number never
   *  jumps 32 -> 67 while the player is watching the sand that caused it. */
  private shownBuffer = 0;

  update(m: GameModel, debugText: string | null) {
    // How much material is still anywhere but a jar, as a percentage of the
    // level. One number, no counting.
    const total = m.level.pockets.reduce((n, k) => n + k.volume, 0);
    const outstanding = m.sand.sourceLeft + m.sand.inFlight + m.sand.bufferVolume;
    this.marbles.textContent = `${Math.ceil((outstanding / total) * 100)}%`;
    this.boxes.textContent = String(m.sand.receiversLeft);
    const done = 1 - m.sand.receiversLeft / m.sand.receiversTotal;
    this.bar.style.width = `${(done * 100).toFixed(1)}%`;

    const target = m.sand.bufferPercent;
    this.shownBuffer += (target - this.shownBuffer) * 0.25;
    if (Math.abs(target - this.shownBuffer) < 0.4) this.shownBuffer = target;
    const p = this.shownBuffer / 100;
    (document.getElementById('hud-belt-txt') as HTMLElement).textContent =
      `${Math.round(this.shownBuffer)}%`;
    this.beltFill.style.width = `${Math.min(100, this.shownBuffer).toFixed(1)}%`;
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

  showOverlay(won: boolean, m: GameModel, lv?: { level: number; total: number; name: string; more: boolean }) {
    const title = won ? (lv?.more ? `LEVEL ${lv.level} CLEAR` : 'ALL LEVELS CLEAR') : 'CHANNEL FULL';
    const cta = won ? (lv?.more ? `NEXT: ${LEVELS[lv.level].name}` : 'PLAY AGAIN') : 'RETRY';
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `
      <div class="panel ${won ? 'win' : 'lose'}">
        <h1>${title}</h1>
        <p>${won
          ? `${m.taps} taps · ${m.sand.receiversTotal} jars filled to 100%`
          : 'sand kept arriving with nowhere left to put it'}</p>
        <button id="hud-restart">${cta}</button>
      </div>`;
    const btn = document.getElementById('hud-restart')!;
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.onRestart(); });
  }
}

export { COLORS, TUNING };
