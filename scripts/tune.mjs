/**
 * Receiver-stack tuner.
 *
 * The order colours become available is the level's real difficulty dial, and it
 * has to be re-solved every time a pocket changes colour. Hand-guessing it is
 * how you end up with a level whose BEST possible play peaks at 21/24.
 *
 * This searches receiver orderings (keeping the per-colour box counts that the
 * marble supply forces) and reports the ones where optimal play leaves the most
 * headroom. It uses a fast pure-count model of the sculpture — derived from the
 * same level data, and cross-checked against the real simulation by
 * `npm run validate` afterwards.
 *
 * Usage: node scripts/tune.mjs [trials]
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// First bare number wins; `--level N` must not be mistaken for the trial count.
const TRIALS = (() => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--level') { i++; continue; }
    if (args[i].startsWith('--')) continue;
    const n = Number(args[i]);
    if (Number.isFinite(n)) return n;
  }
  return 4000;
})();
const out = join(mkdtempSync(join(tmpdir(), 'smd-')), 'h.mjs');
await build({ entryPoints: ['src/game/headless.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node18', outfile: out, logLevel: 'error' });
const { LEVELS, TUNING, GameModel, SourceModel, RapierDriver } = await import(pathToFileURL(out).href);

/** Which level. `--level 2` / `--level=2`; defaults to the first. */
const LEVEL_NO = (() => {
  const i = process.argv.indexOf('--level');
  const eq = process.argv.find((a) => a.startsWith('--level='));
  const n = Number(i >= 0 ? process.argv[i + 1] : eq ? eq.split('=')[1] : 1);
  return Number.isFinite(n) && n >= 1 && n <= LEVELS.length ? n : 1;
})();
const LEVEL = LEVELS[LEVEL_NO - 1];

const CAP = TUNING.CONVEYOR_CAPACITY;
const RCAP = TUNING.RECEIVER_CAPACITY;
const COLORS = ['red', 'blue', 'yellow', 'green'];

// ---- fast pure-count model of the board -----------------------------------
// Which screws hold which plank is DERIVED from geometry, and a screw at a
// crossing holds two planks at once — so the model has to be built from a real
// SourceModel rather than from lists in the level file.
const probe = new SourceModel(LEVEL);
const plates = probe.plates.map((p, i) => ({
  i, id: p.id, initial: p.screws.length, z: p.z,
  hasPartial: p.def.partial !== 'none',
  pockets: LEVEL.pockets.filter((k) => k.plate === p.id),
}));
const plateIdx = new Map(plates.map((p) => [p.id, p.i]));
const screws = probe.screws.map((s, i) => ({
  i, id: s.id,
  // Every plank this screw passes through.
  holds: (probe.platesByScrew.get(s.id) ?? []).map((pl) => plateIdx.get(pl.id)),
}));
// A plank cannot leave while another lies across it — that, not a hidden screw,
// is what forces the order.
const above = plates.map((p) =>
  (probe.overlapsWith.get(p.id) ?? []).filter((q) => q.z > p.z).map((q) => plateIdx.get(q.id)));

const trapped = (rem, pi) => above[pi].some((qi) => rem[qi] > 0 || !leftBoard[qi]);
let leftBoard = [];

/** Plate is "moved off" once any support is gone; "gone" at zero. */
// Every screw is visible and tappable; the gate is the trapped plank, applied
// when the plank tries to LEAVE rather than when the screw is tapped.
const legal = (mask, rem, s) => !(mask & (1 << s.i)) && s.holds.some((pi) => rem[pi] > 0);

/**
 * Spill produced by pulling screw `s`, given remaining counts BEFORE the pull.
 * A joint screw releases every plank it passes through, so one pull can open
 * two magazines at once.
 */
function spillOf(rem, s) {
  const out = { red: 0, blue: 0, yellow: 0, green: 0 };
  for (const pi of s.holds) {
    const p = plates[pi];
    if (rem[pi] === 0) continue;
    const after = rem[pi] - 1;
    const partialNow = p.hasPartial && p.initial >= 2 ? after <= 1 : after === 0;
    const wasPartial = p.hasPartial && p.initial >= 2 ? rem[pi] <= 1 : rem[pi] === 0;
    for (const k of p.pockets) {
      const fires = k.releaseAt === 'partial' ? partialNow && !wasPartial : after === 0;
      if (fires) out[k.color] += k.count;
    }
  }
  return out;
}

function drain(belt, cols, stacks) {
  let moved = true;
  while (moved) {
    moved = false;
    for (let ci = 0; ci < 3; ci++) {
      const col = cols[ci], st = stacks[ci];
      if (col.i >= st.length) continue;
      const c = st[col.i];
      while (belt[c] > 0 && col.filled < RCAP) { belt[c]--; col.filled++; moved = true; }
      if (col.filled >= RCAP) { col.i++; col.filled = 0; moved = true; }
    }
  }
}
const total = (b) => b.red + b.blue + b.yellow + b.green;

/** Lowest belt occupancy any legal pull order can get away with. Infinity = unwinnable. */
function minPeak(stacks, ceiling = CAP) {
  return minPeakOrder(stacks, ceiling).peak;
}

/**
 * The count model treats the belt as a MULTISET. The real belt is a queue and a
 * receiver can only take what has reached it, so this model can "drain" a colour
 * that is in reality buried behind eighteen others. It is fast enough to search
 * thousands of stacks, and wrong often enough that its answer has to be checked
 * against the real simulation before it is believed — see `realPlay`.
 */
function minPeakOrder(stacks, ceiling = CAP) {
  for (let limit = 9; limit <= ceiling; limit++) {
    const order = [];
    const seen = new Set();
    const dfs = (mask, rem, belt, cols, peak) => {
      if (mask === (1 << screws.length) - 1) return total(belt) === 0 ? peak : null;
      const key = mask + '|' + belt.red + ',' + belt.blue + ',' + belt.yellow + ',' + belt.green
        + '|' + cols.map((c) => c.i + ':' + c.filled).join(',');
      if (seen.has(key)) return null;
      seen.add(key);
      for (const s of screws) {
        if (!legal(mask, rem, s)) continue;
        const sp = spillOf(rem, s);
        const after = total(belt) + sp.red + sp.blue + sp.yellow + sp.green;
        if (after > limit) continue;
        const nrem = rem.slice();
        for (const pi of s.holds) if (nrem[pi] > 0) nrem[pi]--;
        const nb = { ...belt };
        for (const c of COLORS) nb[c] += sp[c];
        const nc = cols.map((x) => ({ ...x }));
        drain(nb, nc, stacks);
        const r = dfs(mask | (1 << s.i), nrem, nb, nc, Math.max(peak, after));
        if (r !== null) { order.unshift(s.id); return r; }
      }
      return null;
    };
    const rem0 = plates.map((p) => p.initial);
    const belt0 = { red: 0, blue: 0, yellow: 0, green: 0 };
    const cols0 = [0, 1, 2].map(() => ({ i: 0, filled: 0 }));
    drain(belt0, cols0, stacks);
    const r = dfs(0, rem0, belt0, cols0, 0);
    if (r !== null) return { peak: r, order };
  }
  return { peak: Infinity, order: [] };
}

/**
 * Play a candidate through the SHIPPING simulation, on the SHIPPING PHYSICS.
 * This is the only claim that counts, and it has to be Rapier: the belt is a
 * circulating queue and a receiver only takes from the exit gate, so which box
 * closes first depends on the order marbles physically land in — and the
 * scripted stand-in orders them differently. Tuning against the stand-in
 * reported a peak of 17 for a level that really peaks at 22.
 */
// One Rapier world, reused across candidates — the static scene comes from the
// planks, not from the receiver stacks, so it never needs rebuilding.
const realDriver = await RapierDriver.create(LEVEL);

function realPlay(stacks, order) {
  const level = { ...LEVEL, receiverStacks: stacks };
  realDriver.reset();
  const g = new GameModel(level, realDriver);
  const settled = () =>
    g.airborne === 0 && g.source.plates.every((p) => p.state !== 'partial' || p.t >= 1) &&
    g.source.pockets.every((p) => !p.open || p.drained);
  let t = 0, i = 0, peak = 0, quiet = 0, stable = 0, lastLoad = -1;
  while (g.phase === 'play' && t < 400000) {
    if (g.sorting.load === lastLoad) stable += 1000 / 60; else { stable = 0; lastLoad = g.sorting.load; }
    if (i < order.length && settled() && stable > 500) {
      const s = g.source.screwById.get(order[i]);
      if (g.source.isAccessible(s)) { g.pull(s); i++; stable = 0; }
    }
    g.update(1000 / 60); t += 1000 / 60;
    peak = Math.max(peak, g.sorting.load);
    if (i >= order.length && g.source.allEmpty && g.sorting.idle && g.airborne === 0) {
      quiet += 1000 / 60;
      if (quiet > 2500) break;
    } else quiet = 0;
  }
  return { won: g.phase === 'won', peak, taps: i };
}

// ---- pocket colouring -----------------------------------------------------
/**
 * `--colours` mode. Now that a plate is painted the colour of its batch, two
 * OVERLAPPING plates sharing a colour merge into one unreadable shape — so
 * assigning pocket colours is a graph-colouring problem, not a taste call.
 *
 * Constraints: overlapping plates differ; every colour total divides by the
 * receiver capacity (or the boxes cannot come out even); all four colours used;
 * and `bladeL` stays GREEN, because a green batch reachable on turn one with no
 * green receiver is the level's whole premise.
 */
if (process.argv.includes('--colours')) {
  const { SourceModel, containsWorld } = await import(pathToFileURL(out).href);
  const srcM = new SourceModel(LEVEL);
  // Sample each plate and record which other plates overlap it.
  const adj = new Map(LEVEL.plates.map((p) => [p.id, new Set()]));
  const N = 26;
  for (const a of srcM.plates) {
    const bb = SourceModel.bounds(a);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const wx = a.def.x - bb.hw + (2 * bb.hw * i) / (N - 1);
      const wy = a.def.y - bb.hh + (2 * bb.hh * j) / (N - 1);
      if (!containsWorld(a.def.shape, a.transform, wx, wy)) continue;
      for (const b of srcM.plates) {
        if (b === a) continue;
      // Sticks are THIN: a bar three layers back is not occluded by the one in
      // front of it, it runs out from under it and stays visible alongside. So
      // any overlapping pair can merge, whatever the depth gap — unlike wide
      // plates, where the front one simply wins the overlap region.
        if (Math.abs(a.z - b.z) > Number(process.env.Z_MERGE ?? 99)) continue;
        if (containsWorld(b.def.shape, b.transform, wx, wy)) { adj.get(a.id).add(b.id); adj.get(b.id).add(a.id); }
      }
    }
  }
  const pk = LEVEL.pockets.map((k) => ({ id: k.id, plate: k.plate, count: k.count }));
  const n = pk.length;
  const results = [];
  const assign = new Array(n);
  const dfs = (i) => {
    if (results.length >= 40) return;
    if (i === n) {
      const tot = {};
      for (let k = 0; k < n; k++) tot[assign[k]] = (tot[assign[k]] ?? 0) + pk[k].count;
      if (COLORS.some((c) => !tot[c])) return;
      if (COLORS.some((c) => tot[c] % RCAP !== 0)) return;
      // Green stays the scarcest supply — that is what makes it the trap.
      if (tot.green > Math.min(tot.red, tot.blue, tot.yellow)) return;
      results.push({ colours: assign.slice(), totals: { ...tot } });
      return;
    }
    for (const c of COLORS) {
      // The green trap must sit on a stick that is reachable on turn one.
      if (pk[i].plate === (process.env.GREEN_ON ?? 'diagA') && c !== 'green') continue;
      let ok = true;
      for (let j = 0; j < i; j++) {
        if (adj.get(pk[i].plate).has(pk[j].plate) && assign[j] === c) { ok = false; break; }
      }
      if (!ok) continue;
      assign[i] = c;
      dfs(i + 1);
    }
  };
  dfs(0);
  console.log(`\noverlap graph: ${[...adj].map(([k, v]) => `${k}:${v.size}`).join(' ')}`);
  console.log(`${results.length} valid colourings found (capped)\n`);
  for (const r of results.slice(0, 12)) {
    console.log('  ' + pk.map((k, i) => `${k.plate}=${r.colours[i][0].toUpperCase()}`).join(' ') + '   ' + JSON.stringify(r.totals));
  }
  process.exit(0);
}

// ---- the search -----------------------------------------------------------
const supply = {};
for (const k of LEVEL.pockets) supply[k.color] = (supply[k.color] ?? 0) + k.count;
const boxes = [];
for (const c of COLORS) for (let i = 0; i < (supply[c] ?? 0) / RCAP; i++) boxes.push(c);
const perCol = boxes.length / 3;
console.log(`\nsupply ${JSON.stringify(supply)} -> ${boxes.length} boxes (${boxes.length / 3} per column)`);
if (!Number.isInteger(perCol)) { console.log('boxes do not divide into 3 columns'); process.exit(1); }

const current = minPeak(LEVEL.receiverStacks);
console.log(`current stacks: best play peaks at ${current}/${CAP}\n`);

let rng = 12345;
const rand = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
/**
 * `LAST_COLOR` pins a colour to the BOTTOM of every column.
 *
 * A colour that lives on one plank, and that plank is the last one off the
 * board, cannot be served before then — so a column that asks for it early is
 * simply dead, and everything else piles up behind it. Level 2 is built on
 * exactly that (blue exists only on `railMid`), so its blue boxes have to be
 * the finale rather than a random draw.
 */
const LAST_COLOR = process.env.LAST_COLOR || '';
const HEAD_DISTINCT = Number(process.env.HEAD_DISTINCT ?? (LAST_COLOR ? 2 : 3));
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const shuffled = () => {
  if (!LAST_COLOR) {
    const a = shuffle(boxes.slice());
    return [a.slice(0, perCol), a.slice(perCol, perCol * 2), a.slice(perCol * 2)];
  }
  const late = shuffle(boxes.filter((c) => c === LAST_COLOR));
  const rest = shuffle(boxes.filter((c) => c !== LAST_COLOR));
  const cols = [[], [], []];
  // Deal the late colour onto the bottoms first, then fill upward.
  for (let i = 0; i < late.length; i++) cols[i % 3].push(late[i]);
  for (let i = 0, c = 0; i < rest.length; i++) {
    while (cols[c % 3].length >= perCol) c++;
    cols[c % 3].unshift(rest[i]);
    c++;
  }
  return cols;
};

/**
 * Aim for a BAND, not a minimum. A level whose optimal play peaks at 12/24 has
 * so much slack the buffer never bites; one that peaks at 21 cannot be misplayed
 * at all. The interesting window is "you must plan, but you can breathe".
 */
const TARGET_LO = Number(process.env.TARGET_LO ?? 14);
const TARGET_HI = Number(process.env.TARGET_HI ?? 17);
const score = (peak) => (peak >= TARGET_LO && peak <= TARGET_HI ? 0 : Math.min(Math.abs(peak - TARGET_LO), Math.abs(peak - TARGET_HI)));

const shortlist = [];
let tried = 0;
const t0 = Date.now();
for (let t = 0; t < TRIALS && Date.now() - t0 < 90000; t++) {
  const s = shuffled();
  // The opening row is the level's whole premise: three distinct colours live,
  // and NO green destination anywhere on the board.
  const head = s.map((c) => c[0]);
  if (head.includes('green')) continue;
  // Normally the opening row shows three different colours. With a colour
  // pinned to the bottom (see LAST_COLOR) only two remain for the heads, and an
  // opening that can only serve two of four is part of what makes it hard.
  if (new Set(head).size < HEAD_DISTINCT) continue;
  tried++;
  const { peak, order } = minPeakOrder(s);
  if (peak === Infinity) continue;
  // Shortlist on SOLVABILITY only, never on the band. The count model routinely
  // reads 9 where the real physics reads 21, so filtering the shortlist by the
  // target band throws away every candidate that would actually have hit it.
  // The band is applied to the real peak, further down.
  shortlist.push({ stacks: s, peak, order, sc: 0 });
  if (shortlist.length >= 240) break;
}
shortlist.sort((a, b) => b.peak - a.peak);

// Now the part that actually decides it: play each shortlisted stack through the
// shipping simulation. The count model is a filter, never the verdict.
let best = null, bestPeak = Infinity, bestScore = Infinity, verified = 0, won = 0;
for (const c of shortlist) {
  const r = realPlay(c.stacks, c.order);
  verified++;
  if (!r.won) continue;
  won++;
  // Score on the REAL peak against the band, preferring the tightest play that
  // still actually wins.
  const sc = score(r.peak);
  if (sc < bestScore || (sc === bestScore && r.peak > bestPeak && r.peak <= TARGET_HI)) {
    bestScore = sc; bestPeak = r.peak; best = c.stacks;
    console.log(`  model ${c.peak}/${CAP} -> real ${r.peak}/${CAP} WON  ${c.stacks.map((x) => x.map((y) => y[0].toUpperCase()).join('')).join(' / ')}`);
  }
  if (bestScore === 0 && bestPeak === TARGET_HI) break;
}
console.log(`\n${tried} candidates tried, ${shortlist.length} shortlisted, ${verified} played for real, ${won} actually won`);
console.log(`chosen: real peak ${bestPeak}/${CAP} (target ${TARGET_LO}-${TARGET_HI})`);
if (best) {
  console.log('\npaste into LEVEL.receiverStacks:\n');
  console.log('  receiverStacks: [');
  for (const col of best) console.log(`    [${col.map((c) => `'${c}'`).join(', ')}],`);
  console.log('  ],');
} else {
  console.log('nothing better than the current stacks found');
}
