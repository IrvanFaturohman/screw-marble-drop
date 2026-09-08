/**
 * Sculpture inspector. Prints the DERIVED truth about the authored level —
 * baked screw positions, what covers what, the reveal waves, which pulls spill
 * sand and which are purely structural — so iterating on a layered board
 * is a read rather than a guess.
 *
 * Usage: node scripts/inspect.mjs [--map]
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'smd-')), 'h.mjs');
await build({ entryPoints: ['src/game/headless.ts'], bundle: true, format: 'esm', platform: 'node', target: 'node18', outfile: out, logLevel: 'error' });
const { SourceModel, SandModel, LEVELS, TUNING, LAYOUT, HALF_W, colorSupply, colorDemand, shapeBox, shapeBoxRot } =
  await import(pathToFileURL(out).href);

/** Which level. `--level 2` / `--level=2`; defaults to the first. */
const LEVEL_NO = (() => {
  const i = process.argv.indexOf('--level');
  const eq = process.argv.find((a) => a.startsWith('--level='));
  const n = Number(i >= 0 ? process.argv[i + 1] : eq ? eq.split('=')[1] : 1);
  return Number.isFinite(n) && n >= 1 && n <= LEVELS.length ? n : 1;
})();
const LEVEL = LEVELS[LEVEL_NO - 1];

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', x: '\x1b[0m', b: '\x1b[1m' };
const src = new SourceModel(LEVEL);
const sand = new SandModel(LEVEL.receiverStacks);

console.log(`\n${C.b}PLATES${C.x}  (front to back)`);
for (const p of [...src.plates].sort((a, b) => b.z - a.z)) {
  const box = shapeBox(p.def.shape);
  const blocks = [...(p.def.blocksAtPartial ?? []).map((s) => s + '@partial'), ...(p.def.blocksUntilGone ?? []).map((s) => s + '@gone')];
  const pk = LEVEL.pockets.filter((x) => x.plate === p.id).map((x) => `${x.color}x${x.count}@${x.releaseAt}`);
  console.log(`  z${String(p.z).padStart(5)} ${p.id.padEnd(10)} ${p.def.shape.kind.padEnd(6)} ` +
    `${p.screws.length}sup [${p.screws.map((s) => s.id).join(',').padEnd(26)}] ` +
    `y ${(p.def.y + box.minY).toFixed(1).padStart(5)}..${(p.def.y + box.maxY).toFixed(1).padEnd(5)}`);
  if (blocks.length) console.log(`         ${C.d}covers ${blocks.join(' ')}${C.x}`);
  if (pk.length) console.log(`         ${C.y}holds  ${pk.join(' ')}${C.x}`);
}

console.log(`\n${C.b}SCREWS${C.x}`);
for (const s of src.screws) {
  const acc = src.isAccessible(s);
  const b = src.activeBlockers(s).map((p) => p.id).join(',');
  console.log(`  ${s.id.padEnd(12)} (${s.x.toFixed(1).padStart(6)},${s.y.toFixed(1).padStart(5)}) on ${s.plateId.padEnd(10)} ` +
    `${acc ? C.g + 'OPEN' : C.r + 'under ' + b}${C.x}`);
}

console.log(`\n${C.b}REVEAL WAVES${C.x}  (what one pull opens up)`);
{
  const probe = new SourceModel(LEVEL);
  const settle = () => { for (let i = 0; i < 700; i++) probe.update(1 / 120); };
  let wave = 0;
  while (probe.accessible().length && wave++ < 20) {
    const batch = [...probe.accessible()];
    const before = probe.pockets.map((p) => p.pending);
    const line = [];
    for (const s of batch) {
      const b0 = probe.pockets.map((p) => p.pending);
      probe.pull(s); settle();
      const spilled = probe.pockets.reduce((n, p, i) => n + (b0[i] - p.pending), 0);
      line.push(spilled ? `${C.y}${s.id}(+${spilled})${C.x}` : `${C.d}${s.id}(-)${C.x}`);
    }
    console.log(`  wave ${wave}: ${line.join(' ')}`);
  }
  console.log(`  ${C.d}(+n) = units of sand released, (-) = purely structural${C.x}`);
}

console.log(`\n${C.b}RESERVOIRS${C.x}`);
for (const p of LEVEL.pockets) {
  console.log(`  ${p.id.padEnd(10)} ${p.color.padEnd(6)} x${String(p.count).padStart(2)} ${p.kind.padEnd(13)} on ${p.plate.padEnd(10)} @${p.releaseAt}`);
}

console.log(`\n${C.b}COLOUR BALANCE${C.x}`);
{
  const sup = colorSupply(LEVEL), dem = colorDemand(LEVEL);
  for (const k of new Set([...Object.keys(sup), ...Object.keys(dem)])) {
    const ok = (sup[k] ?? 0) === (dem[k] ?? 0);
    console.log(`  ${k.padEnd(7)} supply ${String(sup[k] ?? 0).padStart(3)}  demand ${String(dem[k] ?? 0).padStart(3)}  ${ok ? C.g + 'ok' : C.r + 'MISMATCH'}${C.x}`);
  }
  const total = Object.values(sup).reduce((a, b) => a + b, 0);
  console.log(`  ${total} units of sand, ${sand.receiversTotal} boxes x ${TUNING.RECEIVER_CAPACITY}, capacity ${TUNING.BUFFER_CAPACITY}`);
}

console.log(`\n${C.b}RECEIVER STACKS${C.x}  (top = live)`);
LEVEL.receiverStacks.forEach((col, i) => {
  console.log(`  col ${'ABC'[i]}  ${col.map((c, j) => (j === 0 ? C.b : C.d) + c[0].toUpperCase() + C.x).join(' ')}`);
});
{
  const open0 = LEVEL.receiverStacks.map((c) => c[0]);
  console.log(`  exposed at t=0: ${open0.join(', ')}   ${open0.includes('green') ? C.r + 'green available — no trap!' : C.g + 'no green destination (the trap)'}${C.x}`);
}

console.log(`\n${C.b}BANDS${C.x}`);
{
  // shapeBoxRot, not shapeBox: a tilted stick's footprint is not its unrotated
  // one, and the board behind the weave is sized from these numbers.
  let lo = Infinity, hi = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const p of src.plates) {
    const b = shapeBoxRot(p.def.shape, p.def.rot ?? 0);
    lo = Math.min(lo, p.def.y + b.minY); hi = Math.max(hi, p.def.y + b.maxY);
    x0 = Math.min(x0, p.def.x + b.minX); x1 = Math.max(x1, p.def.x + b.maxX);
  }
  console.log(`  board      x ${x0.toFixed(1)} .. ${x1.toFixed(1)}   (frame half-width ${HALF_W})`);
  console.log(`  board      y ${lo.toFixed(1)} .. ${hi.toFixed(1)}   (HUD at ${LAYOUT.hudBottom})`);
  console.log(`  fall       ${LAYOUT.funnelBottom} .. ${lo.toFixed(1)}   = ${(lo - LAYOUT.funnelBottom).toFixed(1)} units`);
  console.log(`  channel    ${(LAYOUT.loopCY - LAYOUT.loopRY).toFixed(1)} .. ${(LAYOUT.loopCY + LAYOUT.loopRY).toFixed(1)}   loop ${sand.path.length.toFixed(1)} units, holds ${TUNING.BUFFER_CAPACITY} of sand`);
}

if (process.argv.includes('--map')) {
  const W = 84, H = 40, x0 = -19.5, x1 = 19.5, y0 = 40, y1 = 4;
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  const put = (wx, wy, ch) => {
    const c = Math.round(((wx - x0) / (x1 - x0)) * (W - 1));
    const r = Math.round(((wy - y0) / (y1 - y0)) * (H - 1));
    if (grid[r] && grid[r][c] !== undefined) grid[r][c] = ch;
  };
  // Plate footprints, front-most wins.
  const zc = '.:-=+*#%@';
  for (const p of [...src.plates].sort((a, b) => a.z - b.z)) {
    const b = shapeBox(p.def.shape);
    for (let i = 0; i <= 60; i++) for (let j = 0; j <= 60; j++) {
      const wx = p.def.x + b.minX + ((b.maxX - b.minX) * i) / 60;
      const wy = p.def.y + b.minY + ((b.maxY - b.minY) * j) / 60;
      if (p.containsWorld(wx, wy)) put(wx, wy, zc[Math.max(0, Math.min(8, Math.round(p.z) + 4))]);
    }
  }
  for (const pk of src.pockets) put(pk.def.x, pk.def.y, C.y + pk.color[0].toUpperCase() + C.x);
  for (const s of src.screws) put(s.x, s.y, (src.isAccessible(s) ? C.g + '@' : C.r + 'x') + C.x);
  console.log(`\n${C.b}MAP${C.x}  (plate depth as .:-=+*#%@ front-most wins, ${C.g}@${C.x}=legal screw ${C.r}x${C.x}=covered, letters=pockets)`);
  for (const row of grid) console.log('  ' + row.join(''));
}
console.log('');
