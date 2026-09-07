/**
 * Joint checker.
 *
 * On a real screw board two planks never simply lie across each other with
 * nothing holding the joint — the crossing IS where the screw goes. This finds
 * every crossing between the authored planks, reports which ones are pinned and
 * which are bare, and prints the screw positions a bare one needs.
 *
 * It also reports what each screw ends up holding, because that is derived from
 * geometry rather than authored: a screw at a crossing passes through BOTH
 * planks, so pulling it lets go of two at once.
 *
 * Usage:  npm run joints
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'smd-joints-')), 'headless.mjs');
await build({
  entryPoints: ['src/game/headless.ts'],
  bundle: true, format: 'esm', platform: 'node', target: 'node18',
  outfile: out, logLevel: 'error',
});
const { SourceModel, LEVELS, LAYOUT, containsWorld, shapeBoxRot } = await import(pathToFileURL(out).href);

/** Which level. `--level 2` / `--level=2`; defaults to the first. */
const LEVEL_NO = (() => {
  const i = process.argv.indexOf('--level');
  const eq = process.argv.find((a) => a.startsWith('--level='));
  const n = Number(i >= 0 ? process.argv[i + 1] : eq ? eq.split('=')[1] : 1);
  return Number.isFinite(n) && n >= 1 && n <= LEVELS.length ? n : 1;
})();
const LEVEL = LEVELS[LEVEL_NO - 1];

const C = { b: '\x1b[1m', x: '\x1b[0m', g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[90m' };
const src = new SourceModel(LEVEL);
const rest = (p) => ({ x: p.def.x, y: p.def.y, rot: p.def.rot ?? 0, pivotX: p.def.x, pivotY: p.def.y, angle: 0, dx: 0, dy: 0 });
const inside = (p, x, y, pad = 0) => containsWorld(p.def.shape, rest(p), x, y, pad);

/** Centroid of the region two planks share. */
function crossing(a, b, steps = 90) {
  const bb = shapeBoxRot(a.def.shape, a.def.rot ?? 0);
  let sx = 0, sy = 0, n = 0;
  for (let u = 0; u <= steps; u++) {
    for (let v = 0; v <= steps; v++) {
      const wx = a.def.x + bb.minX + ((bb.maxX - bb.minX) * u) / steps;
      const wy = a.def.y + bb.minY + ((bb.maxY - bb.minY) * v) / steps;
      if (inside(a, wx, wy) && inside(b, wx, wy)) { sx += wx; sy += wy; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

console.log(`\n${C.b}CROSSINGS${C.x}`);
let bare = 0, pinned = 0;
const suggest = [];
for (let i = 0; i < src.plates.length; i++) {
  for (let j = i + 1; j < src.plates.length; j++) {
    const a = src.plates[i], b = src.plates[j];
    const c = crossing(a, b);
    if (!c) continue;
    const screw = src.screws.find((s) => inside(a, s.x, s.y, LAYOUT.screwR * 0.35) && inside(b, s.x, s.y, LAYOUT.screwR * 0.35));
    if (screw) {
      pinned++;
      console.log(`  ${C.g}pinned${C.x}  ${a.id} x ${b.id}  by ${screw.id} at (${screw.x}, ${screw.y})`);
    } else {
      bare++;
      const top = a.z > b.z ? a : b;
      suggest.push(`    { id: 'sNEW${bare}', plate: '${top.id}', x: ${c.x.toFixed(1)}, y: ${c.y.toFixed(1)} },`);
      console.log(`  ${C.r}BARE${C.x}    ${a.id} x ${b.id}  centre (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
    }
  }
}
console.log(`  ${pinned} pinned, ${bare} bare`);
if (suggest.length) {
  console.log(`\n${C.b}ADD${C.x}`);
  for (const s of suggest) console.log(s);
}

console.log(`\n${C.b}WHAT EACH SCREW HOLDS${C.x}  (derived from geometry)`);
for (const s of src.screws) {
  const held = (src.platesByScrew.get(s.id) ?? []).map((p) => p.id);
  const tag = held.length > 1 ? `${C.b}JOINT${C.x}` : `${C.d}single${C.x}`;
  console.log(`  ${s.id.padEnd(9)} (${String(s.x).padStart(6)}, ${String(s.y).padStart(5)})  ${tag}  ${held.join(' + ')}`);
}

console.log(`\n${C.b}WHAT HOLDS EACH PLANK${C.x}`);
for (const p of src.plates) {
  const trapped = src.trappedBy(p);
  console.log(`  z ${String(p.z).padStart(5)}  ${p.id.padEnd(8)} ${p.screws.length} screw(s) [${p.screws.map((s) => s.id).join(', ')}]`
    + (trapped ? `  ${C.d}under ${trapped.id}${C.x}` : `  ${C.g}free on top${C.x}`));
}
console.log('');
