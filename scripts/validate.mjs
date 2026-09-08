/**
 * Level validator + headless play-through.
 *
 * Runs the SHIPPING simulation (src/game/*.ts, bundled by esbuild) in Node with
 * the scripted marble driver, so every claim is checked against the same plate /
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
const CAP = TUNING.CONVEYOR_CAPACITY;
const RCAP = TUNING.RECEIVER_CAPACITY;

console.log(`\n${C.b}SCREW MARBLE DROP — level validator${C.x}`);
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
  // plate wide enough to read as a marble box. Every piece must read as a STICK,
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
//     end reads as loose marbles floating beside the board — and it is the one
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
    // Three is the small spill an upright carries; nine is what a long plank
    // holds. The difference between them is the decision.
    check(`magazine ${pk.id} batch size is 3-12`, pk.count >= 3 && pk.count <= 12, `${pk.count}`);
    // The batch has to physically fit inside the plate that holds it, or the
    // player cannot see what a screw is going to spill.
    const plate = plateOf(pk.plate);
    let inside = 0;
    const anchor = toLocal(plate.transform, pk.x, pk.y);
    for (let i = 0; i < pk.count; i++) {
      const s = pocketSlot(pk, i);
      const [wx, wy] = M.toWorld(plate.transform, anchor[0] + s.dx, anchor[1] + s.dy);
      if (containsWorld(plate.def.shape, plate.transform, wx, wy, TUNING.MARBLE_RADIUS * 0.35)) inside++;
    }
    check(`pocket ${pk.id} sits inside plate ${pk.plate}`, inside >= Math.ceil(pk.count * 0.8),
      `only ${inside}/${pk.count} marbles are within the plate outline`);
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
const totalMarbles = Object.values(supply).reduce((a, b) => a + b, 0);
const totalBoxes = LEVEL.receiverStacks.reduce((n, c) => n + c.length, 0);
console.log(`  supply ${JSON.stringify(supply)} = ${totalMarbles} marbles`);
console.log(`  demand ${JSON.stringify(demand)} = ${totalBoxes} boxes x ${RCAP}`);
check('total marbles 36-90', totalMarbles >= 36 && totalMarbles <= 90, `${totalMarbles}`);
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
  const debt = earlyGreen.reduce((n, p) => n + p.count, 0);
  check('that green costs a real slice of the buffer', debt >= CAP * 0.3, `${debt} vs capacity ${CAP}`);
  console.log(`  green bait from t=0: ${earlyGreen.map((p) => p.id).join(',')} = ${debt} marbles of pure debt`);
}

// ------------------------------------------------------------------ solver ---
console.log(`\n${C.b}SOLVER${C.x}  (conservative: every batch lands before draining)`);
function solve() {
  const screws = LEVEL.screws.map((s) => s.id);
  const idx = new Map(screws.map((s, i) => [s, i]));

  const drain = (st) => {
    let moved = true;
    while (moved) {
      moved = false;
      for (let ci = 0; ci < st.cols.length; ci++) {
        const col = st.cols[ci], stack = LEVEL.receiverStacks[ci];
        if (col.i >= stack.length) continue;
        const color = stack[col.i];
        while (st.belt[color] > 0 && col.filled < RCAP) { st.belt[color]--; col.filled++; moved = true; }
        if (col.filled >= RCAP) { col.i++; col.filled = 0; moved = true; }
      }
    }
  };
  const total = (b) => b.red + b.blue + b.yellow + b.green;

  // A COUNT MODEL, not a replay.
  //
  // Every screw is tappable now, so the branching factor went from four to
  // thirteen — and the old solver rebuilt a whole SourceModel and re-simulated
  // the prefix at every node, which turned a two-second search into one that
  // never finished. The structure is simple enough to model exactly: a screw
  // holds a known set of planks, a plank leaves at zero screws unless something
  // still lies on it, and leaving can free whatever it was pinning.
  const PL = src.plates.map((p, i) => ({
    i, id: p.id, z: p.z, screws: p.screws.length,
    hasPartial: p.def.partial !== 'none',
    pockets: LEVEL.pockets.filter((k) => k.plate === p.id),
  }));
  const pIdx = new Map(PL.map((p) => [p.id, p.i]));
  const holds = LEVEL.screws.map((sc) => (src.platesByScrew.get(sc.id) ?? []).map((pl) => pIdx.get(pl.id)));
  const above = PL.map((p) => (src.overlapsWith.get(p.id) ?? []).filter((q) => q.z > p.z).map((q) => pIdx.get(q.id)));

  /** Apply a pull to a state, cascading anything it frees. Returns the spill. */
  function applyPull(rem, gone, si) {
    const spill = { red: 0, blue: 0, yellow: 0, green: 0 };
    const opened = (pi, wasRem) => {
      const p = PL[pi];
      const partialNow = p.hasPartial && p.screws >= 2 ? rem[pi] <= 1 : rem[pi] === 0;
      const wasPartial = p.hasPartial && p.screws >= 2 ? wasRem <= 1 : wasRem === 0;
      for (const k of p.pockets) {
        const fires = k.releaseAt === 'partial' ? partialNow && !wasPartial : gone[pi] === 1;
        if (fires && !k.__done) spill[k.color] += k.count;
      }
    };
    for (const pi of holds[si]) {
      if (gone[pi]) continue;
      const wasRem = rem[pi];
      if (rem[pi] > 0) rem[pi]--;
      opened(pi, wasRem);
    }
    // Anything at zero screws and no longer pinned leaves — and that may free
    // the next one down, so keep going until nothing moves.
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of PL) {
        if (gone[p.i] || rem[p.i] > 0) continue;
        if (above[p.i].some((qi) => !gone[qi])) continue;
        gone[p.i] = 1; moved = true;
        for (const k of p.pockets) if (k.releaseAt !== 'partial') spill[k.color] += k.count;
      }
    }
    return spill;
  }

  let explored = 0;
  const CAP_STATES = 400000;
  /**
   * Collect SEVERAL orders, not just the first.
   *
   * The count model is optimistic — it treats the belt as a multiset, where the
   * real belt is a circulating queue. Its favourite order can therefore lose on
   * the real physics while a different order at the same peak wins. So gather a
   * handful and let the play-through decide which one is real.
   */
  const WANT = 16;
  const attempt = (limit) => {
    const seen = new Set();
    const path = [];
    const found = [];
    let bestPeak = 0;
    const dfs = (mask, rem, gone, belt, cols, peak) => {
      if (found.length >= WANT) return true;
      if (explored > CAP_STATES) return false;
      if (mask === (1 << screws.length) - 1) {
        if (total(belt) === 0 && gone.every((g) => g)) {
          found.push([...path]); bestPeak = Math.max(bestPeak, peak);
          return found.length >= WANT;
        }
        return false;
      }
      const key = `${mask}|${belt.red},${belt.blue},${belt.yellow},${belt.green}|` + cols.map((c) => `${c.i}:${c.filled}`).join(',');
      if (seen.has(key)) return false;
      seen.add(key); explored++;

      for (let i = 0; i < screws.length; i++) {
        if (mask & (1 << i)) continue;
        if (!holds[i].some((pi) => !gone[pi])) continue;
        const nrem = rem.slice(), ngone = gone.slice();
        const spill = applyPull(nrem, ngone, i);
        const after = total(belt) + spill.red + spill.blue + spill.yellow + spill.green;
        if (after > limit) continue;
        const nb = { ...belt };
        for (const c of ['red', 'blue', 'yellow', 'green']) nb[c] += spill[c];
        const nc = cols.map((x) => ({ ...x }));
        drain({ belt: nb, cols: nc });
        path.push(screws[i]);
        if (dfs(mask | (1 << i), nrem, ngone, nb, nc, Math.max(peak, after))) return true;
        path.pop();
      }
      return false;
    };
    const belt0 = { red: 0, blue: 0, yellow: 0, green: 0 };
    const cols0 = LEVEL.receiverStacks.map(() => ({ i: 0, filled: 0 }));
    drain({ belt: belt0, cols: cols0 });
    dfs(0, PL.map((p) => p.screws), PL.map(() => 0), belt0, cols0, 0);
    return found.length ? { orders: found, order: found[0], peak: bestPeak } : null;
  };

  for (let limit = 9; limit <= CAP; limit += 3) {
    const r = attempt(limit);
    if (r) return { ...r, explored };
  }
  return { order: null, peak: 0, explored };
}

const solved = solve();
check('an overflow-free pull order exists', !!solved.order,
  `explored ${solved.explored} states with no solution — the level is unwinnable`);
if (solved.order) {
  console.log(`  best play peaks at ${solved.peak}/${CAP}, ${solved.order.length} pulls, ${solved.explored} states`);
  const budget = LEVEL.peakBudget ?? 0.85;
  check(`optimal play leaves headroom (peak <= ${Math.round(budget * 100)}% of capacity)`,
    solved.peak <= CAP * budget, `peak ${solved.peak}/${CAP}`);
  check('optimal play still has to use the buffer (peak >= 30%)', solved.peak >= CAP * 0.3, `peak ${solved.peak}/${CAP}`);
  if (VERBOSE) console.log('  order: ' + (solved.playOrder ?? solved.order).join(' '));
}

// ---------------------------------------------------------- play-through ---
console.log(`\n${C.b}PLAY-THROUGH${C.x}  (solved order, real simulation)`);
const settled = (g) =>
  g.airborne === 0 && g.source.plates.every((p) => p.state !== 'partial' || p.t >= 1) &&
  g.source.pockets.every((p) => !p.open || p.drained);

{
  // THE REAL PHYSICS, not the scripted stand-in. The belt is a circulating queue
  // and a receiver only takes from the exit gate, so which box closes first
  // depends on the order marbles actually land in — and Rapier orders them
  // differently from the count model that proposed the order. So try the orders
  // the solver found, in turn, and report the first that actually wins. The
  // claim being proved is "an order exists that wins on the shipping physics",
  // which is the only claim worth making.
  const driver = await RapierDriver.create(LEVEL);
  const orders = solved.orders ?? [LEVEL.screws.map((s) => s.id)];
  let result = null, tried = 0;
  for (const order of orders) {
    driver.reset();
    const g = new GameModel(LEVEL, driver);
    let t = 0, peak = 0, i = 0, quiet = 0, stable = 0, lastLoad = -1;
    const ids = new Set();
    while (g.phase === 'play' && t < 400000) {
      if (g.sorting.load === lastLoad) stable += 1000 / 60; else { stable = 0; lastLoad = g.sorting.load; }
      if (i < order.length && settled(g) && stable > 500) {
        const s = g.source.screwById.get(order[i]);
        if (g.source.isAccessible(s)) { g.pull(s); i++; stable = 0; }
      }
      g.update(1000 / 60); t += 1000 / 60;
      peak = Math.max(peak, g.sorting.load);
      for (const m of g.marbles) ids.add(m.id);
      if (i >= order.length && g.source.allEmpty && g.sorting.idle && g.airborne === 0) {
        quiet += 1000 / 60;
        if (quiet > 2500) break;
      } else quiet = 0;
    }
    tried++;
    if (!result || g.phase === 'won') result = { g, peak, t, ids, order };
    if (g.phase === 'won') break;
  }
  const { g, peak, t, ids } = result;
  check('the level completes', g.phase === 'won',
    `no winning order among the ${tried} the solver proposed — ended "${g.phase}"`);
  check('every pocket emptied', g.source.marblesLeft === 0, `${g.source.marblesLeft} marbles still in the sculpture`);
  check('every marble accounted for', ids.size === totalMarbles, `${ids.size} of ${totalMarbles}`);
  check('the board fully dismantled', g.source.platesLeft === 0, `${g.source.platesLeft} planks left`);
  check('conveyor drained', g.sorting.load === 0, `${g.sorting.load} stuck`);
  // Filling the belt is no longer a loss, so "never fills it" is the wrong
  // thing to demand. What the best play must never do is JAM — reach capacity
  // with nothing on the ring that any open box will take.
  check('the best play never jams', !g.sorting.jammed && g.phase === 'won',
    `phase ${g.phase}, belt ${g.sorting.load}/${CAP}`);
  check('the best play still has to use the belt', peak >= CAP * 0.3, `live peak ${peak}/${CAP}`);
  console.log(`  ${g.taps} pulls, ${(t / 1000).toFixed(1)}s simulated, ${ids.size} marbles, live peak ${peak}/${CAP}`
    + (tried > 1 ? `  (order ${tried} of ${orders.length} tried)` : ''));
  solved.playOrder = result.order;
  if (VERBOSE) console.log('  winning order: ' + result.order.join(' '));
}

// --------------------------------------------------------------- flight ---
console.log(`\n${C.b}FLIGHT${C.x}  (no marble may rely on the rescue net)`);
{
  const g = new GameModel(LEVEL);
  g.sorting.columns.flat().forEach((r) => { r.state = 'active'; });
  const flights = [];
  let rescued = 0;
  for (const pk of g.source.pockets) {
    g.source.debugOpenPocket(pk);
    const start = g.elapsed;
    let guard = 0;
    while (guard++ < 4000) {
      g.update(1000 / 60);
      const air = g.marbles.some((m) => m.origin === pk.id && (m.state === 'falling' || m.state === 'intake'));
      if (pk.pending === 0 && !air) break;
    }
    const ms = g.elapsed - start;
    flights.push(ms);
    if (ms >= TUNING.MARBLE_RESCUE_MS) rescued++;
    g.sorting.belt.length = 0;
    g.marbles.length = 0;
  }
  const avg = flights.reduce((a, b) => a + b, 0) / flights.length;
  console.log(`  ${flights.length} pockets, avg ${avg.toFixed(0)}ms to fully drain, slowest ${Math.max(...flights).toFixed(0)}ms, ${rescued} needed the net`);
  check('no batch relies on the rescue net', rescued === 0, `${rescued} did`);
  check('a batch drains fast enough to keep a tap cadence (<4s)', Math.max(...flights) < 4000, `${Math.max(...flights).toFixed(0)}ms`);
  check('a batch takes long enough to read as a cascade (>700ms)', Math.min(...flights) > 700, `${Math.min(...flights).toFixed(0)}ms`);
}

// ---------------------------------------------------------------- chain ---
console.log(`\n${C.b}CHAIN + BLOCKED + OVERFLOW${C.x}`);
{
  const g = new GameModel(LEVEL);
  const greenPk = g.source.pockets.find((p) => p.color === 'green');
  g.source.debugOpenPocket(greenPk);
  for (let k = 0; k < 900; k++) g.update(1000 / 60);
  check('a green batch with no receiver stays on the belt', g.sorting.load === greenPk.total,
    `belt ${g.sorting.load}, expected ${greenPk.total}`);
  const before = g.sorting.load;
  let guard = 0;
  // Advance whichever column actually reaches green — it is not always the
  // first one, and the tuner is free to move it.
  const greenCol = g.sorting.columns.findIndex((c) => c.some((r) => r.color === 'green'));
  check('some receiver column reaches green', greenCol >= 0, 'no green destination anywhere');
  while (greenCol >= 0 && !g.sorting.activeReceivers().some((r) => r.color === 'green') && guard++ < 12) {
    const a = g.sorting.columns[greenCol].find((r) => r.state === 'active');
    if (!a) break;
    a.filled = RCAP; a.state = 'completing'; g.sorting.advanceColumn(a);
  }
  let drainedAt = -1;
  for (let k = 0; k < 1500; k++) {
    g.update(1000 / 60);
    if (drainedAt < 0 && g.sorting.load <= before - 3) drainedAt = (k * 1000) / 60;
  }
  check('exposing GREEN drains the stuck marbles with zero input', drainedAt > 0, `belt ${g.sorting.load} (was ${before})`);
  console.log(`  ${before} stuck green -> first three drained in ${(drainedAt / 1000).toFixed(2)}s`);
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
  // A bad tap must never be refused, and it must lose cleanly.
  //
  // Strip a free, loaded plank down to its LAST screw first, then fill the belt,
  // then pull. Filling first and pulling "the first accessible screw" proves
  // nothing on a board where most pulls only change the structure.
  const g = new GameModel(LEVEL);
  // It has to be a `detached` magazine: a `partial` one pours the moment the
  // plank drops to one screw, i.e. during the stripping, and then the final pull
  // spills nothing and the test proves nothing.
  const target = g.source.plates.find((pl) => !g.source.trappedBy(pl) && pl.screws.length >= 2
    && g.source.pockets.some((pk) => pk.def.plate === pl.id && pk.def.releaseAt === 'detached'));
  check('some loaded plank is free to strip', !!target);
  for (const sc of target.screws.slice(0, -1)) g.pull(sc);
  for (let k = 0; k < 400; k++) g.update(1000 / 60);
  const shot = target.screws[0];
  g.debugFillConveyor(CAP);
  check('belt filled to capacity', g.sorting.load === CAP, `${g.sorting.load}`);
  g.pull(shot);
  check('the pull is ALLOWED even though it may overflow', shot.unscrewing || shot.removed);
  for (let k = 0; k < 1400; k++) g.update(1000 / 60);
  check('a belt full of UNSERVABLE colours is a clean loss', g.phase === 'lost', `phase ${g.phase}, belt ${g.sorting.load}`);
  for (let k = 0; k < 600; k++) g.update(1000 / 60);
  check('the simulation is stable after the loss', g.sorting.load <= CAP);
}

{
  // A FULL BELT IS NOT A LOSS.
  //
  // Fill it to capacity with a colour that HAS an open receiver. The belt is
  // jammed by the old rule and perfectly fine by the new one: the matching
  // marbles drain, slots open, and the run continues. Anything arriving while
  // it is full queues above the entry instead of being deleted.
  const g = new GameModel(LEVEL);
  const live = g.sorting.activeReceivers()[0].color;
  let i = 0;
  while (g.sorting.load < CAP && i++ < 80) {
    const id = 900 + i;
    const b = g.sorting.admit(id, live, g.sorting.path.wrap(i * TUNING.CONVEYOR_MIN_GAP * 1.3));
    if (!b) break;
    const pt = g.sorting.path.point(b.s);
    g.marbles.push({
      id, color: live, state: 'belt', x: pt.x, y: pt.y, z: LAYOUT.beltZ,
      spin: 0, age: 0, t: 0, stillMs: 0, lastX: pt.x, lastY: pt.y,
      fromX: pt.x, fromY: pt.y, fromZ: 0, origin: 'test', receiverId: '',
    });
  }
  check('the belt can be filled to capacity', g.sorting.load === CAP, `${g.sorting.load}/${CAP}`);
  check('a full belt holding a servable colour is NOT jammed', !g.sorting.jammed);

  const before = g.sorting.load;
  for (let k = 0; k < 900; k++) g.update(1000 / 60);
  check('a full belt with somewhere to go survives', g.phase === 'play', `phase ${g.phase}`);
  check('and it actually drains', g.sorting.load < before, `still ${g.sorting.load}/${CAP}`);
  console.log(`  full belt of ${live}: ${before}/${CAP} -> ${g.sorting.load}/${CAP}, still playing`);
}

{
  // ... and a marble arriving at a full belt WAITS instead of vanishing.
  const g = new GameModel(LEVEL);
  const dead = ['green', 'red', 'blue', 'yellow'].find((c) => !g.sorting.exposedColors().has(c));
  g.debugFillConveyor(CAP);
  const pk = g.source.pockets.find((p) => !p.open);
  g.source.debugOpenPocket(pk);
  for (let k = 0; k < 260; k++) g.update(1000 / 60);
  const waiting = g.marbles.filter((m) => m.state === 'intake');
  check('marbles refused by a full belt queue rather than disappear', waiting.length > 0,
    `${waiting.length} waiting, ${g.marbles.length} marbles total`);
  check('none of them were deleted', g.marbles.length >= g.sorting.load, `${g.marbles.length}`);
  console.log(`  ${waiting.length} marbles stacked above the entry while the belt was full (dead colour ${dead})`);
}

// --------------------------------------------------------- determinism ---
console.log(`\n${C.b}DETERMINISM${C.x}`);
{
  const run = () => {
    const g = new GameModel(LEVEL);
    const order = solved.order ?? [];
    let i = 0, stable = 0, lastLoad = -1;
    for (let k = 0; k < 14000 && g.phase === 'play'; k++) {
      if (g.sorting.load === lastLoad) stable += 1000 / 60; else { stable = 0; lastLoad = g.sorting.load; }
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
