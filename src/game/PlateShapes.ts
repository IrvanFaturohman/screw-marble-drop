/**
 * Plate geometry for the screw sculpture. Pure — no Three, no Rapier — so the
 * validator can prove that what the player SEES covering a screw is exactly what
 * the rules think is blocking it.
 *
 * Shapes are defined in a plate's LOCAL frame. Radial shapes (arc/disc/ring/
 * wedge) are centred on the plate origin; bars are centred rectangles. A plate
 * rotates about an authored PIVOT (normally one of its own screws), which is
 * what makes "swings around the remaining screw" geometrically honest.
 */

export type ShapeDef =
  /** Annulus sector — the workhorse of a radial mechanism. Angles in radians,
   *  measured CCW from +x, with a1 > a0. */
  | { kind: 'arc'; ri: number; ro: number; a0: number; a1: number }
  | { kind: 'disc'; r: number }
  | { kind: 'ring'; ro: number; ri: number }
  /** Pie slice (arc with ri = 0), kept separate so intent reads in the data. */
  | { kind: 'wedge'; r: number; a0: number; a1: number }
  /** Rounded rectangle, centred. Long thin ones are the bars and straps. */
  | { kind: 'bar'; w: number; h: number; r?: number };

export const TAU = Math.PI * 2;
export const deg = (d: number) => (d * Math.PI) / 180;

/** Bring `a` into [base, base + 2pi). */
export function wrapFrom(a: number, base: number) {
  let x = (a - base) % TAU;
  if (x < 0) x += TAU;
  return base + x;
}

export function containsLocal(shape: ShapeDef, x: number, y: number, pad = 0): boolean {
  switch (shape.kind) {
    case 'arc': {
      const r = Math.hypot(x, y);
      if (r < shape.ri - pad || r > shape.ro + pad) return false;
      const a = wrapFrom(Math.atan2(y, x), shape.a0);
      // Pad angularly by an arc length, not a fixed angle, so a pad means the
      // same thing near the hub as it does at the rim.
      const angPad = r > 0.001 ? pad / r : 0;
      return a <= shape.a1 + angPad || wrapFrom(a, shape.a0 - angPad) <= shape.a1 + angPad;
    }
    case 'wedge': {
      const r = Math.hypot(x, y);
      if (r > shape.r + pad) return false;
      const a = wrapFrom(Math.atan2(y, x), shape.a0);
      const angPad = r > 0.001 ? pad / r : 0;
      return a <= shape.a1 + angPad;
    }
    case 'disc':
      return Math.hypot(x, y) <= shape.r + pad;
    case 'ring': {
      const r = Math.hypot(x, y);
      return r >= shape.ri - pad && r <= shape.ro + pad;
    }
    case 'bar': {
      const hw = shape.w / 2 + pad, hh = shape.h / 2 + pad;
      return Math.abs(x) <= hw && Math.abs(y) <= hh;
    }
  }
}

/**
 * True local-space AABB. Matters for arcs: a bottom-only cradle has an outer
 * radius of 13 but reaches barely 3 units ABOVE its origin, and the circle bound
 * below would claim it overlaps the HUD.
 */
/** Rest-rotated local AABB, in the plate's PARENT frame. */
export function shapeBoxRot(shape: ShapeDef, rot: number) {
  const b = shapeBox(shape);
  const c = Math.cos(rot), s = Math.sin(rot);
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
    xs.push(x * c - y * s); ys.push(x * s + y * c);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function shapeBox(shape: ShapeDef): { minX: number; maxX: number; minY: number; maxY: number } {
  switch (shape.kind) {
    case 'bar': {
      const hw = shape.w / 2, hh = shape.h / 2;
      return { minX: -hw, maxX: hw, minY: -hh, maxY: hh };
    }
    case 'disc':
      return { minX: -shape.r, maxX: shape.r, minY: -shape.r, maxY: shape.r };
    case 'ring':
      return { minX: -shape.ro, maxX: shape.ro, minY: -shape.ro, maxY: shape.ro };
    case 'arc':
    case 'wedge': {
      const ri = shape.kind === 'arc' ? shape.ri : 0;
      const ro = shape.kind === 'arc' ? shape.ro : shape.r;
      const pts: [number, number][] = [];
      const push = (r: number, a: number) => pts.push([r * Math.cos(a), r * Math.sin(a)]);
      for (const r of [ri, ro]) { push(r, shape.a0); push(r, shape.a1); }
      if (shape.kind === 'wedge') pts.push([0, 0]);
      // Any axis crossing inside the sweep pushes the box out to the rim.
      for (let k = -4; k <= 8; k++) {
        const a = (k * Math.PI) / 2;
        if (a >= shape.a0 - 1e-9 && a <= shape.a1 + 1e-9) push(ro, a);
      }
      return {
        minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
        minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
      };
    }
  }
}

/** Local-space bounding half-extents — broad phase and mesh sizing. */
export function shapeBounds(shape: ShapeDef): { hw: number; hh: number } {
  switch (shape.kind) {
    case 'arc': return { hw: shape.ro, hh: shape.ro };
    case 'wedge': return { hw: shape.r, hh: shape.r };
    case 'disc': return { hw: shape.r, hh: shape.r };
    case 'ring': return { hw: shape.ro, hh: shape.ro };
    case 'bar': return { hw: shape.w / 2, hh: shape.h / 2 };
  }
}

export interface PlateTransform {
  /** Plate origin at rest. */
  x: number; y: number;
  /** REST orientation of the plate's own frame. A woven lattice needs bars at
   *  arbitrary angles, and a bar's marble row runs along its local +x — so the
   *  row follows the stick for free. */
  rot: number;
  /** Point it rotates about (world, at rest). */
  pivotX: number; pivotY: number;
  /** Current rotation about the pivot, radians. Stacks on top of `rot`. */
  angle: number;
  /** Extra world translation applied after rotation (slides and falls). */
  dx: number; dy: number;
}

/** World point -> plate local frame: undo translation, pivot spin, then rest tilt. */
export function toLocal(t: PlateTransform, wx: number, wy: number): [number, number] {
  const px = wx - t.dx, py = wy - t.dy;
  const c = Math.cos(-t.angle), s = Math.sin(-t.angle);
  const rx = px - t.pivotX, ry = py - t.pivotY;
  const ux = t.pivotX + rx * c - ry * s - t.x;
  const uy = t.pivotY + rx * s + ry * c - t.y;
  const rc = Math.cos(-t.rot), rs = Math.sin(-t.rot);
  return [ux * rc - uy * rs, ux * rs + uy * rc];
}

/** Local point on the plate -> world, honouring rest tilt then the current pose. */
export function toWorld(t: PlateTransform, lx: number, ly: number): [number, number] {
  const rc = Math.cos(t.rot), rs = Math.sin(t.rot);
  const ox = t.x + lx * rc - ly * rs;
  const oy = t.y + lx * rs + ly * rc;
  const c = Math.cos(t.angle), s = Math.sin(t.angle);
  const rx = ox - t.pivotX, ry = oy - t.pivotY;
  return [t.pivotX + rx * c - ry * s + t.dx, t.pivotY + rx * s + ry * c + t.dy];
}

export function containsWorld(shape: ShapeDef, t: PlateTransform, wx: number, wy: number, pad = 0) {
  const [lx, ly] = toLocal(t, wx, wy);
  return containsLocal(shape, lx, ly, pad);
}

/** Polar helper for authoring a radial sculpture. */
export const polar = (cx: number, cy: number, r: number, degAngle: number) => ({
  x: cx + r * Math.cos(deg(degAngle)),
  y: cy + r * Math.sin(deg(degAngle)),
});
