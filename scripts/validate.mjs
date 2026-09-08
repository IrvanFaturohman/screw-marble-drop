/**
 * Level validator + headless play-through.
 *
 * Runs the SHIPPING simulation (src/game/*.ts, bundled by esbuild) in Node with
 * the shipping flow network, so every claim is checked against the same plank /
 * screw / conveyor / receiver code the phone runs.
 *
 * The load-bearing checks are the ones nobody can eyeball on a layered
 * sculpture: that the plate NAMED as blocking a screw actually covers it, and
 * that at the exact moment a screw becomes legal nothing is still on top of it.
 *
 * Usage:  npm run validate          all checks
 *         npm run validate -- -v    also print the solved pull order
 */

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VERBOSE = process.argv.includes('-v');
const out = join(mkdtempSync(join(tmpdir(), 'smd-')), 'headless.mjs');
await build({
  entryPoints: ['src/game/headless.ts'],
  bundle: true, format: 'esm', platform: 'node', target: 'node18',
  outfile: out, logLevel: 'error',
});
const M = await import(pathToFileURL(out).href);

const {
  GameModel, SourceModel, SortingModel, LEVELS, TUNING, LAYOUT, HALF_W,
  colorSupply, colorDemand, pocketSlot, containsWorld, shapeBox, shapeBoxRot, toLocal, RapierDriver,
} = M;

/** Which level. `--level 2` / `--level=2`; defaults to the first. */
const LEVEL_NO = (() => {
  const i = process.argv.indexOf('--level');
  const eq = process.argv.find((a) => a.startsWith('--level='));
  const n = Number(i >= 0 ? process.argv[i + 1] : eq ? eq.split('=')[1] : 1);
  return Number.isFinite(n) && n >= 1 && n <= LEVELS.length ? n : 1;
})();
const LEVEL = LEVELS[LEVEL_NO - 1];

let failures = 0;
const pass = [];
function check(name, ok, detail = '') {
  if (ok) { pass.push(name); return true; }
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  return false;
}
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[90m', x: '\x1b[0m', b: '\x1b[1m' };
const CAP = TUNING.BUFFER_CAPACITY;
const RCAP = TUNING.RECEIVER_CAPACITY;

console.log(`\n${C.b}SCREW SAND FLOW — level validator${C.x}`);
console.log(`level: ${LEVEL.id} "${LEVEL.name}"  —  ${LEVEL.plates.length} plates, ${LEVEL.screws.length} screws, ${LEVEL.pockets.length} pockets\n`);

const src = new SourceModel(LEVEL);
const plateOf = (id) => src.plateById.get(id);

// ------------------------------------------------------- structural shape ---
console.log(`${C.b}STRUCTURE${C.x}`);

// 1. It must be ONE object, not a row of boxes: every plate has to overlap at
//    least one other, and the whole thing has to sit inside one radial footprint.
{
  let overlaps = 0;
  const N = 60;
  const covers = new Map(LEVEL.plates.map((p) => [p.id, new Set()]));
  const near = new Map(LEVEL.plates.map((p) => [p.id, new Set()]));
  for (const a of src.plates) {
    const ba = shapeBoxRot(a.def.shape, a.def.rot ?? 0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const lx = ba.minX + ((ba.maxX - ba.minX) * i) / (N - 1);
        const ly = ba.minY + ((ba.maxY - ba.minY) * j) / (N - 1);
        if (!containsWorld(a.def.shape, a.transform, a.def.x + lx, a.def.y + ly)) continue;
        for (const b of src.plates) {
          if (b === a) continue;
          if (containsWorld(b.def.shape, b.transform, a.def.x + lx, a.def.y + ly)) covers.get(a.id).add(b.id);
        }
        for (const b of src.plates) {
          // What actually merges is two planks whose visible areas ABUT with only
          // a seam between them, and on a board this sparse that means adjacent
          // depth layers. 1.5 is the strictest gap this board can be 4-coloured
          // at while keeping green the scarce trap — `npm run tune -- --colours`
          // reports zero solutions at 2.0.
          if (b === a || Math.abs(a.z - b.z) > 1.5) continue;
          if (containsWorld(b.def.shape, b.transform, a.def.x + lx, a.def.y + ly)) near.get(a.id).add(b.id);
        }
      }
    }
  }
  for (const p of src.plates) {
    const n = covers.get(p.id).size;
    if (n > 0) overlaps++;
    check(`plate ${p.id} overlaps another plate`, n > 0, 'it is a free-floating box, not part of a sculpture');
  }
  console.log(`  ${overlaps}/${src.plates.length} plates overlap a neighbour`);

  // A plate is painted the colour of its batch, so two plates whose VISIBLE
  // areas abut must differ in colour. Only DEPTH-ADJACENT overlaps qualify:
  // plates are opaque, so one three layers back is simply occluded and cannot
  // be confused with the one in front. (coreDisc and cradle sit 0.5 apart, and
  // both being red merged them into a single shape.)
  const tintOfP = (id) => {
    const pk = LEVEL.pockets.find((x) => x.plate === id);
    return pk ? pk.color : 'neutral';
  };
  const seenPair = new Set();
  for (const a of src.plates) {
    for (const bId of near.get(a.id)) {
      const key = [a.id, bId].sort().join('|');
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      check(`overlapping ${a.id} (${tintOfP(a.id)}) / ${bId} (${tintOfP(bId)}) differ in colour`,
        tintOfP(a.id) !== tintOfP(bId), 'two overlapping plates share a colour and merge into one shape');
    }
  }
  console.log(`  ${seenPair.size} depth-adjacent overlapping pairs, all colour-separated`);

  // A grid of identical containers is the exact failure mode being designed out.
  const sig = new Set(LEVEL.plates.map((p) => JSON.stringify(p.shape)));
  check('plates are not all the same shape', sig.size >= 4, `only ${sig.size} distinct shapes`);
  // A woven lattice is bars by design, and the failure the brief calls out is a
  // plank wide enough to read as a sand BOX. Every piece must read as a plank,
  // and their lengths must vary or the board is just a bundle.
  const aspects = LEVEL.plates.map((p) => {
    const b = shapeBox(p.shape);
    return (b.maxX - b.minX) / (b.maxY - b.minY);
  });
  // The failure this guards is a plate wide enough to read as a MARBLE BOX —
  // the old build's 30x15 tray was aspect 2.0. An upright pinning two
  // cross-pieces is a short plank, not a slab, so the bar sits just above that.
  check('every plank reads as a plank, none as a slab', Math.min(...aspects) >= 2.8,
    `stubbiest is aspect ${Math.min(...aspects).toFixed(2)}`);
  const lengths = LEVEL.plates.map((p) => {
    const b = shapeBox(p.shape);
    return b.maxX - b.minX;
  });
  check('stick lengths vary', Math.max(...lengths) / Math.min(...lengths) >= 1.4,
    `${Math.min(...lengths).toFixed(1)}..${Math.max(...lengths).toFixed(1)} long`);
  const angles = new Set(LEVEL.plates.map((p) => Math.round(((p.rot ?? 0) * 180) / Math.PI / 15)));
  check('bars run at 3+ different angles', angles.size >= 3, `${angles.size} distinct tilts`);
  const zs = new Set(LEVEL.plates.map((p) => p.z));
  check('plates sit on at least 4 depth layers', zs.size >= 4, `${zs.size} layers`);
  console.log(`  ${sig.size} distinct shapes, aspect ${Math.min(...aspects).toFixed(2)}..${Math.max(...aspects).toFixed(2)}, ${angles.size} tilts, ${zs.size} depth layers`);
}

// 2. Every screw must sit ON the plate it supports — a screw floating in space
//    is not a structural support.
for (const s of src.screws) {
  const p = plateOf(s.plateId);
  check(`screw ${s.id} sits on plate ${s.plateId}`,
    !!p && containsWorld(p.def.shape, p.transform, s.x, s.y, -0.35),
    'not inside its plate outline');
}

// 3. Screws must be far enough apart to tap on a phone.
{
  const min = LAYOUT.screwR * 2.2;
  let worst = Infinity, worstPair = '';
  for (let i = 0; i < src.screws.length; i++) {
    for (let j = i + 1; j < src.screws.length; j++) {
      const a = src.screws[i], b = src.screws[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < worst) { worst = d; worstPair = `${a.id}/${b.id}`; }
    }
  }
  check('all screws are separately tappable', worst >= min, `closest ${worstPair} at ${worst.toFixed(2)} (need ${min.toFixed(2)})`);
  console.log(`  closest screw pair: ${worstPair} at ${worst.toFixed(2)} units`);
}

// 4. Everything on screen.
for (const p of src.plates) {
  const b = shapeBoxRot(p.def.shape, p.def.rot ?? 0);
  const ok = p.def.x + b.minX >= -HALF_W - 0.5 && p.def.x + b.maxX <= HALF_W + 0.5
    && p.def.y + b.maxY <= LAYOUT.hudBottom + 0.5;
  check(`plate ${p.id} fits the frame`, ok,
    `x ${(p.def.x + b.minX).toFixed(1)}..${(p.def.x + b.maxX).toFixed(1)}, top ${(p.def.y + b.maxY).toFixed(1)} vs HUD ${LAYOUT.hudBottom}`);
}
{
  // And the sculpture as a whole must leave the fall space the cascade needs.
  let lowest = Infinity;
  for (const p of src.plates) lowest = Math.min(lowest, p.def.y + shapeBoxRot(p.def.shape, p.def.rot ?? 0).minY);
  const fall = lowest - LAYOUT.funnelBottom;
  check('empty fall space below the sculpture >= 13 units', fall >= 13, `${fall.toFixed(1)}`);
  console.log(`  sculpture bottom y ${lowest.toFixed(1)}, fall space ${fall.toFixed(1)} units (${(fall * 10).toFixed(0)}px)`);
}

// ------------------------------------------------- visual/logical agreement ---
console.log(`\n${C.b}OCCLUSION${C.x}  (the picture and the rules must say the same thing)`);

// 4b. Every bead in a magazine has to sit ON its stick. A row that runs off the
//     end reads as sand spilling beside the board — and it is the one
//     layout error that survives every other check, because the rules never
//     touch the row's geometry.
{
  const r = TUNING.MARBLE_RADIUS;
  for (const pk of LEVEL.pockets) {
    const pl = plateOf(pk.plate);
    let worst = null, worstD = 0;
    for (let i = 0; i < pk.count; i++) {
      const { dx, dy } = pocketSlot(pk, i);
      // The row runs along the stick's local +x, so rotate the offset by rot.
      const c = Math.cos(pl.def.rot ?? 0), s = Math.sin(pl.def.rot ?? 0);
      const wx = pk.x + dx * c - dy * s, wy = pk.y + dx * s + dy * c;
      if (containsWorld(pl.def.shape, pl.transform, wx, wy, -r)) continue;
      const d = Math.hypot(wx - pl.def.x, wy - pl.def.y);
      if (d > worstD) { worstD = d; worst = `bead ${i} at (${wx.toFixed(1)}, ${wy.toFixed(1)})`; }
    }
    check(`${pk.id} fits inside ${pk.plate}`, !worst, `${worst} is off the stick`);
  }
  console.log(`  ${LEVEL.pockets.length} magazines, every bead on its stick`);
}

// 5. EVERY CROSSING IS PINNED. Two planks may not simply lie across each other
//    with nothing holding the joint — on a real board the crossing IS where the
//    screw goes. This is also what keeps the plank count honest: ten planks
//    cross thirty-three times, and thirty-three screws is not a puzzle.
{
  const rest = (p) => ({ x: p.def.x, y: p.def.y, rot: p.def.rot ?? 0, pivotX: p.def.x, pivotY: p.def.y, angle: 0, dx: 0, dy: 0 });
  const inside = (p, x, y, pad = 0) => containsWorld(p.def.shape, rest(p), x, y, pad);
  const touches = (a, b) => {
    const bb = shapeBoxRot(a.def.shape, a.def.rot ?? 0);
    for (let u = 0; u <= 80; u++) for (let v = 0; v <= 80; v++) {
      const wx = a.def.x + bb.minX + ((bb.maxX - bb.minX) * u) / 80;
      const wy = a.def.y + bb.minY + ((bb.maxY - bb.minY) * v) / 80;
      if (inside(a, wx, wy) && inside(b, wx, wy)) return true;
    }
    return false;
  };
  let crossings = 0;
  for (let i = 0; i < src.plates.length; i++) {
    for (let j = i + 1; j < src.plates.length; j++) {
      const a = src.plates[i], b = src.plates[j];
      if (!touches(a, b)) continue;
      crossings++;
      const pin = src.screws.find((s) => inside(a, s.x, s.y, LAYOUT.screwR * 0.35) && inside(b, s.x, s.y, LAYOUT.screwR * 0.35));
      check(`crossing ${a.id} x ${b.id} is pinned`, !!pin, 'two planks lie across each other with no screw at the joint');
    }
  }
  // NO PLANK MAY BE SANDWICHED. A plank tucked under one neighbour and lying
  // over another reads as if it bends: its two ends disagree about whether it
  // is above or below the board, and you cannot tell which. Every plank must be
  // above EVERYTHING it crosses or below everything it crosses — which means
  // the crossing graph has exactly two layers.
  for (const p of src.plates) {
    const nb = src.overlapsWith.get(p.id) ?? [];
    const over = nb.filter((q) => q.z > p.z).map((q) => q.id);
    const under = nb.filter((q) => q.z < p.z).map((q) => q.id);
    check(`${p.id} is consistently over or under what it crosses`,
      !(over.length && under.length), `under ${over.join(',')} but over ${under.join(',')}`);
  }
  const joints = src.screws.filter((s) => (src.platesByScrew.get(s.id) ?? []).length > 1).length;
  check('most screws are joints through two planks', joints >= src.screws.length * 0.5,
    `${joints}/${src.screws.length}`);
  console.log(`  ${crossings} crossings, all pinned; ${joints}/${src.screws.length} screws hold two planks`);
}

// 6. NOTHING IS BURIED, so the gate is physical: a plank with no screws left
//    still cannot move while another lies across it. Walk that dependency and
//    prove the whole board can actually come apart.
{
  const probe = new SourceModel(LEVEL);
  const settle = () => { for (let i = 0; i < 400; i++) probe.update(1 / 120); };
  // Two layers means the whole top layer is free at t=0 — that is what two
  // layers IS, not a defect. What must still hold is that a real part of the
  // board is pinned and has to wait its turn.
  const free0 = probe.plates.filter((p) => !probe.trappedBy(p));
  const pinned0 = probe.plates.length - free0.length;
  check('part of the board starts pinned and must wait', pinned0 >= 2,
    `${pinned0} of ${probe.plates.length} planks pinned at t=0`);
  check('and part of it is reachable straight away', free0.length >= 1,
    'nothing can be taken off');
  console.log(`  free at t=0: ${free0.map((p) => p.id).join(', ')}`);

  const order = [];
  let guard = 0;
  while (probe.plates.some((p) => p.present) && guard++ < 40) {
    const free = probe.plates.filter((p) => p.present && !probe.trappedBy(p));
    if (!free.length) break;
    for (const pl of free) for (const s of [...pl.screws]) probe.pull(s);
    settle();
    order.push(free.map((p) => p.id).join(' '));
  }
  check('every plank eventually comes off', probe.plates.every((p) => !p.present),
    `stuck: ${probe.plates.filter((p) => p.present).map((p) => p.id).join(',')}`);
  check('every screw eventually comes out', probe.screws.every((s) => s.removed),
    `stuck: ${probe.screws.filter((s) => !s.removed).map((s) => s.id).join(',')}`);
  check('every magazine eventually opens', probe.pockets.every((p) => p.open),
    `never opened: ${probe.pockets.filter((p) => !p.open).map((p) => p.id).join(',')}`);
  order.forEach((w, i) => console.log(`   layer ${i + 1}: ${w}`));
}

// 7. No screw may be the sole thing holding a magazine — that is the difference
//    between a support and a colour button.
{
  const soleOwner = [];
  for (const pk of LEVEL.pockets) {
    const pl = plateOf(pk.plate);
    if (pl.screws.length < 2) soleOwner.push(`${pk.id} on ${pk.plate}`);
  }
  check('no magazine hangs on a single screw', soleOwner.length === 0, soleOwner.join(', '));
  const joints = src.screws.filter((s) => (src.platesByScrew.get(s.id) ?? []).length > 1);
  check('pulling a joint lets go of two planks at once', joints.length >= 4, `${joints.length} joints`);
  console.log(`  every plank needs ${Math.min(...src.plates.map((p) => p.screws.length))}+ screws; ${joints.length} shared joints`);
}

// --------------------------------------------------------------- pockets ---
console.log(`\n${C.b}POCKETS${C.x}`);
{
  const kinds = new Set(LEVEL.pockets.map((p) => p.kind));
  check('at least 3 different release behaviours', kinds.size >= 3, [...kinds].join(','));
  console.log(`  ${LEVEL.pockets.length} pockets, ${kinds.size} container types: ${[...kinds].join(', ')}`);

  for (const pk of LEVEL.pockets) {
    // A reservoir has to hold a readable amount: less than a fifth of a jar is
    // not worth a structural decision, more than three jars cannot be absorbed.
    check(`reservoir ${pk.id} holds 20..300 units`, pk.volume >= 20 && pk.volume <= 300, `${pk.volume}`);
    // And it has to physically fit along the plank that holds it, because the
    // visible length of the sand column IS how the player estimates the volume.
    const plate = plateOf(pk.plate);
    const box = shapeBoxRot(plate.def.shape, 0);
    const plankLen = box.maxX - box.minX;
    check(`reservoir ${pk.id} fits along ${pk.plate}`, pk.span <= plankLen - 1.2,
      `span ${pk.span} on a ${plankLen.toFixed(1)} plank`);
    // The outlet must be genuinely NARROW relative to what feeds it — that
    // ratio is the reason sand piles up instead of draining like water.
    check(`reservoir ${pk.id} outlet is a throat, not a hole`,
      TUNING.OUTLET_WIDTH <= 0.32, `outlet is ${(TUNING.OUTLET_WIDTH * 100).toFixed(0)}% of the reservoir`);
  }

  // THE failure condition for this revision: if every screw reliably spills a
  // batch, it is a colour button with a screw sprite on it. Simulate the whole
  // dependency walk and count how many pulls change only the structure.
  const probe = new SourceModel(LEVEL);
  const settleP = () => { for (let i = 0; i < 700; i++) probe.update(1 / 120); };
  let structuralOnly = 0, spilling = 0;
  const detail = [];
  let guard = 0;
  while (probe.accessible().length && guard++ < 40) {
    for (const s of [...probe.accessible()]) {
      const before = probe.pockets.map((p) => p.pending);
      probe.pull(s);
      settleP();
      const spilled = probe.pockets.reduce((n, p, i) => n + (before[i] - p.pending), 0);
      if (spilled === 0) { structuralOnly++; detail.push(`${s.id}:-`); }
      else { spilling++; detail.push(`${s.id}:${spilled}`); }
    }
  }
  const multi = src.plates.filter((p) => p.screws.length > 1).length;
  check('most plates need more than one screw', multi >= LEVEL.plates.length * 0.5, `${multi}/${LEVEL.plates.length}`);
  const soleOwned = LEVEL.pockets.filter((pk) => plateOf(pk.plate).screws.length === 1).length;
  check('most pockets are NOT freed by a single screw', soleOwned <= LEVEL.pockets.length / 2,
    `${soleOwned}/${LEVEL.pockets.length} pockets hang off one screw`);
  console.log(`  ${structuralOnly} of ${structuralOnly + spilling} pulls spill nothing; ${multi}/${LEVEL.plates.length} plates need 2 supports; ${soleOwned}/${LEVEL.pockets.length} pockets on a single screw`);
  console.log(`  ${C.d}per pull: ${detail.join(' ')}${C.x}`);
}

// --------------------------------------------------------------- colours ---
console.log(`\n${C.b}COLOUR BALANCE${C.x}`);
const supply = colorSupply(LEVEL), demand = colorDemand(LEVEL);
for (const c of new Set([...Object.keys(supply), ...Object.keys(demand)])) {
  check(`colour balance ${c}`, (supply[c] ?? 0) === (demand[c] ?? 0),
    `supply ${supply[c] ?? 0} vs demand ${demand[c] ?? 0}`);
}
const totalSand = Object.values(supply).reduce((a, b) => a + b, 0);
const totalBoxes = LEVEL.receiverStacks.reduce((n, c) => n + c.length, 0);
console.log(`  supply ${JSON.stringify(supply)} = ${totalSand} units of sand`);
console.log(`  demand ${JSON.stringify(demand)} = ${totalBoxes} boxes x ${RCAP}`);
check('total sand volume is 600..2000 units', totalSand >= 600 && totalSand <= 2000, `${totalSand}`);
{
  const open0 = new Set(LEVEL.receiverStacks.map((c) => c[0]));
  check('no GREEN receiver at t=0 (the core tension)', !open0.has('green'), [...open0].join(','));
  // And a green batch must be reachable early enough to actually tempt.
  const acc0 = new Set(src.accessible().map((s) => s.id));
  const earlyGreen = LEVEL.pockets.filter((pk) => {
    const plate = plateOf(pk.plate);
    return pk.color === 'green' && plate.screws.some((sc) => acc0.has(sc.id));
  });
  check('a GREEN batch is one tap away at t=0 (the bait exists)', earlyGreen.length > 0);
  const debt = earlyGreen.reduce((n, p) => n + p.volume, 0);
  check('that green costs a real slice of the channel', debt >= CAP * 0.3, `${debt} vs capacity ${CAP}`);
  console.log(`  green bait from t=0: ${earlyGreen.map((p) => p.id).join(',')} = ${debt} units of pure debt`);
}

// ------------------------------------------------------------------ solver ---
//
// With sand there is nothing left to approximate. Whether a level overflows
// depends on RATES and TIMING — how fast a reservoir feeds its throat, how long
// a colour sits in the channel with nowhere to go — none of which a count model
// can represent. The old marble solver was a count model, and it disagreed with
// the physics often enough that the play-through had to try several of its
// answers before one worked.
//
// The flow network is deterministic and cheap, so the solver simply PLAYS THE
// GAME. Greedy, with a few different tie-breaks, and every candidate order is a
// real play-through. What it proves is exactly what matters: a winning order
// exists on the shipping simulation.
console.log(`\n${C.b}SOLVER${C.x}  (greedy over the real flow network)`);

const settled = (g) =>
  g.source.plates.every((p) => p.state !== 'partial' || p.t >= 1);

/**
 * One greedy play. `bias` reorders the candidates so different runs explore
 * different openings.
 */
function play(bias) {
  const g = new GameModel(LEVEL);
  const order = [];
  let t = 0, peak = 0, stable = 0, lastBuf = -1, quiet = 0;
  while (g.phase === 'play' && t < 600000) {
    const buf = g.sand.bufferVolume;
    if (Math.abs(buf - lastBuf) < 0.05) stable += 1000 / 120; else { stable = 0; lastBuf = buf; }

    // Only decide when the board has stopped moving and the channel has stopped
    // changing — a player watching the sand would do the same.
    if (settled(g) && stable > 420) {
      const open = g.source.accessible();
      if (open.length) {
        const exposed = g.sand.exposedColors();
        const free = g.sand.bufferFree;
        const scored = open.map((sc) => {
          // What would this pull actually release? Any plank it holds that has
          // exactly one screw left is about to go.
          let vol = 0, wanted = 0;
          for (const pl of g.source.platesByScrew.get(sc.id) ?? []) {
            if (pl.screws.length > 1) continue;
            for (const pk of g.source.pockets) {
              if (pk.def.plate !== pl.id || pk.open) continue;
              const res = g.sand.byId.get(pk.def.id);
              const v = res ? res.remaining : pk.def.volume;
              vol += v;
              if (exposed.has(pk.color)) wanted += v;
            }
          }
          // Prefer a pull the channel can absorb, and prefer colours that have
          // somewhere to go. A pull that spills nothing is always safe.
          const risk = Math.max(0, vol - wanted) - free;
          return { sc, key: risk * 1000 + (bias.get(sc.id) ?? 0) };
        }).sort((a, b) => a.key - b.key);
        g.pull(scored[0].sc);
        order.push(scored[0].sc.id);
        stable = 0;
      }
    }
    g.update(1000 / 120);
    t += 1000 / 120;
    peak = Math.max(peak, g.sand.bufferVolume);
    if (g.source.remaining().length === 0 && g.sand.idle) {
      quiet += 1000 / 120;
      if (quiet > 1200) break;
    } else quiet = 0;
  }
  return { g, order, peak, t };
}

const solved = (() => {
  let best = null;
  const rng = (n) => { let x = n; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
  for (let attempt = 0; attempt < 14; attempt++) {
    const r = rng(attempt * 7919 + 13);
    const bias = new Map(LEVEL.screws.map((sc) => [sc.id, attempt === 0 ? 0 : r() * 900]));
    const res = play(bias);
    if (!best || (res.g.phase === 'won' && best.g.phase !== 'won')
        || (res.g.phase === 'won' && res.peak < best.peak)) best = { ...res, attempt };
    if (best.g.phase === 'won' && best.peak < TUNING.BUFFER_CAPACITY * 0.75) break;
  }
  return best;
})();

check('a winning pull order exists', solved.g.phase === 'won',
  `no order won in 14 greedy attempts — ended "${solved.g.phase}"`);
{
  const pct = (solved.peak / CAP) * 100;
  console.log(`  won on attempt ${solved.attempt + 1}: ${solved.order.length} pulls, `
    + `${(solved.t / 1000).toFixed(1)}s, channel peaked at ${pct.toFixed(0)}%`);
  const budget = (LEVEL.peakBudget ?? 0.85) * 100;
  check(`best play leaves headroom (peak <= ${Math.round(budget)}%)`, pct <= budget, `peak ${pct.toFixed(0)}%`);
  check('best play still has to use the channel (peak >= 25%)', pct >= 25, `peak ${pct.toFixed(0)}%`);
  if (VERBOSE) console.log('  order: ' + solved.order.join(' '));
}

console.log(`\n${C.b}PLAY-THROUGH${C.x}  (that order, replayed)`);
{
  const g = solved.g;
  check('the level completes', g.phase === 'won', `ended "${g.phase}"`);
  check('every reservoir emptied', g.sand.sourceLeft < 0.5, `${g.sand.sourceLeft.toFixed(1)} units still in the structure`);
  check('nothing left in a pile or the funnel', g.sand.inFlight < 0.5, `${g.sand.inFlight.toFixed(1)} units stuck`);
  check('the channel drained', g.sand.bufferVolume < 0.5, `${g.sand.bufferVolume.toFixed(1)} units stuck`);
  check('the board fully dismantled', g.source.platesLeft === 0, `${g.source.platesLeft} planks left`);
  check('every jar reached 100%', g.sand.columns.flat().every((r) => r.fill >= TUNING.RECEIVER_CAPACITY - 0.5),
    g.sand.columns.flat().filter((r) => r.fill < TUNING.RECEIVER_CAPACITY - 0.5).map((r) => `${r.id}:${r.fill.toFixed(0)}`).join(','));
  console.log(`  ${g.taps} pulls, ${(solved.t / 1000).toFixed(1)}s simulated, `
    + `${g.sand.receiversTotal} jars filled`);
}

// ------------------------------------------------------------------- flow ---
//
// The whole point of the revision: material must ARRIVE faster than it can
// LEAVE, or nothing ever piles up.
console.log(`\n${C.b}FLOW RATES${C.x}  (the inequality that makes a pile)`);
{
  check('source outruns its own outlet', TUNING.SOURCE_FLOW_RATE > TUNING.MAIN_THROAT_FLOW_RATE * 1.4,
    `source ${TUNING.SOURCE_FLOW_RATE} vs throat ${TUNING.MAIN_THROAT_FLOW_RATE}`);
  check('the outlet is the tightest point in the chain',
    TUNING.MAIN_THROAT_FLOW_RATE < TUNING.BUFFER_INPUT_RATE,
    `throat ${TUNING.MAIN_THROAT_FLOW_RATE} vs neck ${TUNING.BUFFER_INPUT_RATE}`);
  check('a jar drains faster than one throat fills it',
    TUNING.RECEIVER_DRAIN_RATE > TUNING.MAIN_THROAT_FLOW_RATE,
    `jar ${TUNING.RECEIVER_DRAIN_RATE} vs throat ${TUNING.MAIN_THROAT_FLOW_RATE}`);

  // And prove it actually happens: open one reservoir and watch a pile build.
  const g = new GameModel(LEVEL);
  const pk = g.source.pockets.find((p) => p.def.volume >= 100);
  g.source.debugOpenPocket(pk);
  const res = g.sand.byId.get(pk.def.id);
  let maxPile = 0, firstFlowAt = -1, tt = 0;
  while (tt < 45000 && res.state !== 'empty') {
    g.update(1000 / 120); tt += 1000 / 120;
    maxPile = Math.max(maxPile, res.pile);
    if (firstFlowAt < 0 && g.sand.bufferVolume > 0.5) firstFlowAt = tt;
  }
  check('opening a reservoir builds a visible pile', maxPile >= 12, `peak pile ${maxPile.toFixed(1)} units`);
  check('sand does not teleport into the channel', firstFlowAt > 250, `first arrival at ${firstFlowAt.toFixed(0)}ms`);
  check('the pile drains away completely', res.pile < 0.5, `${res.pile.toFixed(1)} left`);
  console.log(`  ${pk.def.id}: peak pile ${maxPile.toFixed(0)} units, first sand reached the channel at ${(firstFlowAt / 1000).toFixed(2)}s`);
}

// ------------------------------------------------------- accumulation ---
//
// ACCEPTANCE B and C, mechanised: sand must reach the outlet faster than it can
// leave, build a visible pile, and keep draining after the source runs dry.
console.log(`\n${C.b}ACCUMULATION${C.x}  (per reservoir)`);
{
  const rows = [];
  let worstPile = Infinity, anySettle = 0;
  for (const pk of LEVEL.pockets) {
    const g = new GameModel(LEVEL);
    // Every jar open, so nothing backs up for a reason other than the throat.
    g.sand.columns.flat().forEach((r) => { r.state = 'active'; });
    const target = g.source.pockets.find((p) => p.def.id === pk.id);
    g.source.debugOpenPocket(target);
    const res = g.sand.byId.get(pk.id);
    let maxPile = 0, emptyAt = -1, pileGoneAt = -1, tt = 0;
    while (tt < 60000) {
      g.update(1000 / 120); tt += 1000 / 120;
      maxPile = Math.max(maxPile, res.pile);
      if (emptyAt < 0 && res.remaining <= 0) emptyAt = tt;
      if (emptyAt >= 0 && pileGoneAt < 0 && res.pile <= 0.4) { pileGoneAt = tt; break; }
    }
    const settle = pileGoneAt - emptyAt;
    worstPile = Math.min(worstPile, maxPile);
    anySettle = Math.max(anySettle, settle);
    rows.push(`  ${pk.id.padEnd(10)} ${String(pk.volume).padStart(4)}u  peak pile ${maxPile.toFixed(0).padStart(3)}u`
      + `  drained ${(settle / 1000).toFixed(1)}s after the source ran dry`);
    check(`${pk.id} builds a pile before it drains`, maxPile >= Math.min(12, pk.volume * 0.25),
      `peak pile only ${maxPile.toFixed(1)} units`);
    check(`${pk.id} keeps draining after its source is empty`, settle > 200,
      `pile vanished ${settle.toFixed(0)}ms after the source emptied`);
  }
  rows.forEach((r) => console.log(r));
  console.log(`  tightest pile ${worstPile.toFixed(0)} units; longest tail ${(anySettle / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- chain ---
console.log(`\n${C.b}CHAIN + OVERFLOW${C.x}`);
{
  // ACCEPTANCE E and F: a colour with no jar must sit in the channel and must
  // start draining on its own the moment one opens — with no further input.
  const g = new GameModel(LEVEL);
  const greenPk = g.source.pockets.find((p) => p.color === 'green');
  g.source.debugOpenPocket(greenPk);
  for (let k = 0; k < 5000; k++) g.update(1000 / 120);
  const stuck = g.sand.bufferByColor().green;
  check('green with no jar stays in the channel', stuck > 5, `only ${stuck.toFixed(1)} units held`);
  check('and none of it was quietly deleted',
    Math.abs(stuck + g.sand.byId.get(greenPk.def.id).remaining + g.sand.inFlight - greenPk.def.volume) < 2,
    `${stuck.toFixed(1)} in channel vs ${greenPk.def.volume} authored`);

  const greenCol = g.sand.columns.findIndex((c) => c.some((r) => r.color === 'green'));
  check('some jar column reaches green', greenCol >= 0, 'no green destination anywhere');
  let guard = 0;
  while (greenCol >= 0 && !g.sand.activeReceivers().some((r) => r.color === 'green') && guard++ < 12) {
    const a = g.sand.columns[greenCol].find((r) => r.state === 'active');
    if (!a) break;
    a.fill = TUNING.RECEIVER_CAPACITY; a.inlet = 0; a.state = 'completing';
    g.sand.advanceColumn(a);
  }
  const before = g.sand.bufferByColor().green;
  let drainedAt = -1;
  for (let k = 0; k < 4000; k++) {
    g.update(1000 / 120);
    if (drainedAt < 0 && g.sand.bufferByColor().green <= before - 5) drainedAt = (k * 1000) / 120;
  }
  check('exposing GREEN drains it with zero further input', drainedAt > 0,
    `channel still holds ${g.sand.bufferByColor().green.toFixed(1)}`);
  console.log(`  ${before.toFixed(0)} units of stuck green -> draining ${(drainedAt / 1000).toFixed(2)}s after a jar opened`);
}
{
  // ACCEPTANCE J: congestion has to be watchable, and then it has to end.
  const g = new GameModel(LEVEL);
  // Congestion needs a colour with nowhere to go. If every colour happens to be
  // exposed at t=0, close one jar first so there genuinely is a dead colour —
  // otherwise the fill just drains and the test proves nothing.
  const dead = ['green', 'red', 'blue', 'yellow']
    .find((c) => !g.sand.exposedColors().has(c));
  if (!dead) {
    const victim = g.sand.activeReceivers()[0];
    victim.fill = TUNING.RECEIVER_CAPACITY; victim.state = 'completing';
    g.sand.advanceColumn(victim);
  }
  g.debugFillBuffer(0.86);
  const start = g.sand.bufferPercent;
  // The bad decision is opening a colour with NOWHERE TO GO. Opening a big
  // reservoir whose jar is already open is not congestion — it drains straight
  // through, which is the system working.
  const stuckColors = g.sand.exposedColors();
  const big = g.source.pockets.filter((p) => !p.open && !stuckColors.has(p.color))
    .sort((a, b) => b.def.volume - a.def.volume)[0]
    ?? g.source.pockets.filter((p) => !p.open).sort((a, b) => b.def.volume - a.def.volume)[0];
  g.source.debugOpenPocket(big);
  let rose = 0;
  // Measure the RISE, over the first few seconds — long enough for the sand to
  // arrive, short enough that the jars have not had time to rotate and rescue
  // the situation. Whether it eventually recovers is the level being fair; that
  // it visibly backs up first is what the player has to be able to see.
  for (let k = 0; k < 1400 && g.phase === 'play'; k++) {
    g.update(1000 / 120);
    rose = Math.max(rose, g.sand.bufferPercent - start);
  }
  check('a bad decision is never refused', big.open);
  check('the channel visibly backs up', rose > 3, `only rose ${rose.toFixed(1)} points`);
  console.log(`  filled to ${start.toFixed(0)}%, opened ${big.def.id} (${big.def.volume}u) -> rose ${rose.toFixed(0)} points in 12s`);
}
{
  // Nothing is buried, so there is no such thing as a refused tap. The gate is
  // physical: strip every screw off a plank that is lying under another and it
  // must stay exactly where it is, spilling nothing, until the one on top goes.
  const g = new GameModel(LEVEL);
  const buried = g.source.plates.find((p) => g.source.trappedBy(p));
  check('some plank starts pinned under another', !!buried, 'the board is a single layer');
  if (buried) {
    const cover = g.source.trappedBy(buried);
    for (const sc of [...buried.screws]) g.pull(sc);
    for (let k = 0; k < 600; k++) g.update(1000 / 60);
    check(`${buried.id} has no screws left`, buried.screws.length === 0, `${buried.screws.length} left`);
    check(`${buried.id} still cannot move while ${cover.id} lies on it`, buried.present && buried.state === 'fixed',
      `state ${buried.state}`);
    // Its OWN magazine must still be loaded. The belt will not be empty — those
    // screws were joints, so pulling them moved the planks on the other side of
    // each joint too, which is exactly the point of a shared joint.
    const own = g.source.pockets.filter((k) => k.def.plate === buried.id);
    check(`${buried.id} has spilled nothing of its own`, own.every((k) => !k.open),
      own.filter((k) => k.open).map((k) => k.def.id).join(','));
    check('the game marks it as waiting to fall', buried.loose === true, `loose=${buried.loose}`);
  }
}
{
  // A bad tap must never be refused. Strip a loaded plank to its LAST screw,
  // fill the channel, then pull — the sand has to actually pour and the loss
  // has to be watchable rather than a refusal at the tap.
  const g = new GameModel(LEVEL);
  const target = g.source.plates.find((pl) => !g.source.trappedBy(pl) && pl.screws.length >= 2
    && g.source.pockets.some((pk) => pk.def.plate === pl.id && pk.def.releaseAt === 'detached'));
  check('some loaded plank is free to strip', !!target);
  for (const sc of target.screws.slice(0, -1)) g.pull(sc);
  for (let k = 0; k < 400; k++) g.update(1000 / 60);
  const shot = target.screws[0];
  g.debugFillBuffer(0.9);
  const shotOk = g.pull(shot);
  check('the pull is ALLOWED even though it will overflow', shotOk && (shot.unscrewing || shot.removed));
  // ... and then open EVERYTHING. The jars drain fast enough to survive one bad
  // pull on a nearly-full channel, which is the level being fair; they cannot
  // survive the whole board arriving at once, which is the level being losable.
  for (const pk of g.source.pockets) g.source.debugOpenPocket(pk);
  for (let k = 0; k < 9000 && g.phase === 'play'; k++) g.update(1000 / 120);
  check('overflow triggers a clean loss', g.phase === 'lost', `phase ${g.phase}, channel ${g.sand.bufferPercent.toFixed(0)}%`);
  for (let k = 0; k < 600; k++) g.update(1000 / 120);
  check('the simulation is stable after the loss', g.sand.bufferVolume <= CAP + 0.5);
}

// --------------------------------------------------------- determinism ---
console.log(`\n${C.b}DETERMINISM${C.x}`);
{
  const run = () => {
    const g = new GameModel(LEVEL);
    const order = solved.order ?? [];
    let i = 0, stable = 0, lastLoad = -1;
    for (let k = 0; k < 14000 && g.phase === 'play'; k++) {
      const buf = g.sand.bufferVolume;
      if (Math.abs(buf - lastLoad) < 0.05) stable += 1000 / 60; else { stable = 0; lastLoad = buf; }
      if (i < order.length && settled(g) && stable > 500) {
        const s = g.source.screwById.get(order[i]);
        if (g.source.isAccessible(s)) { g.pull(s); i++; stable = 0; }
      }
      g.update(1000 / 60);
    }
    return JSON.stringify({ phase: g.phase, taps: g.taps, e: g.elapsed.toFixed(2), s: g.state() });
  };
  const a = run(), b = run();
  check('two identical play-throughs match exactly', a === b, `${a.slice(0, 130)}\n      vs ${b.slice(0, 130)}`);
  console.log('  replay hash stable');
}

console.log(`\n${C.b}RESULT${C.x}  ${pass.length} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
