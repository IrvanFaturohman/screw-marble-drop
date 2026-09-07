/**
 * SCREW MARBLE DROP — the authored prototype level.
 *
 * MODEL (read before editing numbers)
 * -----------------------------------
 * The upper source is ONE radial screw sculpture, not a rack of marble boxes.
 * A screw is a STRUCTURAL SUPPORT, never a colour button:
 *
 *   PLATE    overlapping acrylic pieces on shallow z layers. Each is pinned by
 *            1-2 screws. Losing one support makes it swing about the survivor;
 *            losing the last makes it leave, in an authored way.
 *   SCREW    pinned at a joint. It may be covered by a plate in FRONT of it —
 *            `blocksAtPartial` / `blocksUntilGone` say when that clears.
 *   POCKET   a batch of marbles held INSIDE the sculpture, released because the
 *            plate carrying it physically opened. Never because a button was hit.
 *
 * One screw can therefore: change a plate's angle, expose another screw, and
 * spill a batch — or none of those. Deciding which screw to pull is the upper
 * puzzle; whether the conveyor can take what it spills is the lower one.
 *
 * Every position is authored in POLAR coordinates around the sculpture centre,
 * because that is how the shape actually reads.
 *
 * `npm run validate` re-derives all of it and fails on a screw that is not on
 * the plate it claims to support, a blocker that does not visually cover the
 * screw it blocks, a screw that is still covered at the moment it becomes
 * legal, an unreachable screw, a colour count that cannot close every box, or a
 * level with no overflow-free solution.
 */

import { LAYOUT, TUNING, type MarbleColor, type PlateTint } from './GameConfig';
import { deg, polar, type ShapeDef } from '../game/PlateShapes';

const CX = LAYOUT.structCX;
const CY = LAYOUT.structCY;
/**
 * One scale knob for the whole sculpture. Everything below is authored in
 * multiples of it, so the machine can be grown or shrunk to fit the frame
 * without re-deriving sixteen screw positions by hand. The ceiling is set by
 * the blades: their arc peaks at 100deg, and that peak must clear the HUD.
 */
const S = LAYOUT.structScale;
const R = (r: number) => r * S;
/** Author in polar around the sculpture centre. */
export const P = (r: number, a: number) => polar(CX, CY, R(r), a);

/** Every plank is the same width. A plank is a plank. */
export const PLANK_W = 3.8;

export interface Pt { x: number; y: number }
export const pt = (x: number, y: number): Pt => ({ x, y });

/**
 * A stick pinned by two screws.
 *
 * You author the two SCREW POSITIONS — which is how these boards are actually
 * built — and this derives the centre, the tilt and the length. `over` is how
 * far the stick runs past each screw.
 */
export function stick(a: Pt, b: Pt, opts: { w?: number; over?: number } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const over = opts.over ?? 2.4;
  return {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    rot: Math.atan2(dy, dx),
    shape: { kind: 'bar' as const, w: len + over * 2, h: opts.w ?? 4.6, r: (opts.w ?? 4.6) / 2 },
  };
}

/** Point at parameter t along the segment a->b. Used to land a screw ON a stick. */
export const along = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Where a segment crosses a vertical line x = X. */
export const atX = (a: Pt, b: Pt, X: number): Pt => along(a, b, (X - a.x) / (b.x - a.x));
/** Where a segment crosses a horizontal line y = Y. */
export const atY = (a: Pt, b: Pt, Y: number): Pt => along(a, b, (Y - a.y) / (b.y - a.y));

// --------------------------------------------------------------- behaviours ---

/** What a plate does when it drops to exactly one support. */
export type PartialBehavior =
  /** Swing about the surviving screw by `partialDeg`. */
  | 'rotateAroundRemaining'
  /** Tip about the surviving screw — same maths, reads as a tray tilting. */
  | 'tiltAroundRemaining'
  /** Nothing: a plate that is simply still held. */
  | 'none';

/** What it does when the last support goes. */
export type ReleaseBehavior =
  | 'fallAway'      // rotates and drops out of frame
  | 'swingOpen'     // hinges wide about `releasePivot`, then fades
  | 'slideOut'      // slides along `releaseDir` and fades
  | 'tipForward';   // tips toward the camera, dumping what it carries

export type PocketKind = 'hopper' | 'wedge' | 'pocketBehind' | 'rotatingCup' | 'tray';

export interface PlateDef {
  id: string;
  shape: ShapeDef;
  /** Optional override. Normally left out: a plate is painted the colour of the
   *  batch it holds, derived by `plateTint()` so the label can never drift from
   *  the contents. */
  tint?: PlateTint;
  /** Plate origin. Radial shapes are centred here; a bar is centred here too. */
  x: number; y: number;
  /** Rest tilt, radians. A bar's long axis is its local +x, so this is the angle
   *  of the stick — and its marble row runs along it automatically. */
  rot?: number;
  /** Shallow depth layer. Higher is nearer the camera. */
  z: number;
  /** Derived from geometry — every screw physically on the plank holds it. */
  supports?: string[];
  partial: PartialBehavior;
  partialDeg?: number;
  release: ReleaseBehavior;
  releaseDeg?: number;
  /** Pivot for the release motion when it is not a surviving screw. */
  releasePivot?: { x: number; y: number };
  releaseDir?: { x: number; y: number };
  /** Screws it covers until it has left the board entirely. */
}

export interface ScrewDef {
  id: string;
  x: number; y: number;
  /** Plate it supports. Derived back from PlateDef.supports; kept for clarity. */
  plate: string;
}

export interface PocketDef {
  id: string;
  color: MarbleColor;
  count: number;
  kind: PocketKind;
  /** Plate whose motion frees it. */
  plate: string;
  /** 'partial' = spills as soon as that plate swings; 'detached' = only when
   *  the plate has left entirely. */
  releaseAt: 'partial' | 'detached';
  /** Batch anchor, world coords at rest. Follows its plate while it moves. */
  x: number; y: number;
  cols: number;
  spacing?: number;
}

export interface GuideDef {
  id: string;
  x: number; y: number; z?: number;
  w: number; h: number; d?: number;
  rot: number;
}

export interface LevelDef {
  id: string;
  name: string;
  plates: PlateDef[];
  screws: ScrewDef[];
  pockets: PocketDef[];
  receiverStacks: MarbleColor[][];
  guides: GuideDef[];
  /**
   * How close to the conveyor cap the BEST possible play is allowed to run, as
   * a fraction of capacity. A level that cannot be misplayed is not a puzzle, so
   * this is capped — but a level billed as hard is allowed to run tighter, and
   * says so here rather than the validator quietly loosening for everyone.
   */
  peakBudget?: number;
}

// --------------------------------------------------------------------- level ---

/**
 * LEVEL 1 — "IRIS"
 *
 * A layered radial mechanism: a latch bar and a centre shield in front, two big
 * iris blades sweeping left and right, a hub with two arms under them, a core
 * disc and a bottom cradle behind that, and one back plate last of all.
 *
 * 10 plates on 6 depth layers, 16 screws, 10 marble pockets, 78 marbles.
 *
 * Only FOUR screws are legal at t=0 — the latch, the shield, and the lower
 * screw of each blade — so the opening is a genuine sequencing decision rather
 * than a menu. Two of those four are safe (blue and yellow batches, both with
 * open receivers), one is inert, and one spills 9 GREEN with no green receiver
 * anywhere on the board.
 */
/**
 * THE BOARD.
 *
 * Planks are authored by their two ENDPOINTS — the picture first — and the
 * screws go at the CROSSINGS. `npm run joints` derives them; nothing here says
 * which screw holds which plank, because that is geometry: a screw passes
 * through every plank it physically sits on, so a screw at a crossing holds
 * BOTH of them and pulling it lets go of two planks at once.
 *
 * Two rules govern the shape, and `npm run validate` enforces both:
 *
 *   EVERY CROSSING IS PINNED.  Two planks may not simply lie across each other
 *   with nothing holding the joint. That is what a real screw board looks like,
 *   and it is why the count of planks has to stay low: ten planks cross each
 *   other thirty-three times, and thirty-three screws is not a puzzle, it is a
 *   nail bomb. Seven planks cross five times.
 *
 *   NOTHING IS BURIED.  Every screw is visible from straight above. The gate is
 *   physical instead: a plank with no screws left still cannot move while
 *   another plank lies across it, so the stack has to come apart top-down.
 */
const TOP_Y = 32, MID_Y = 23, LOW_Y = 14;   // the three cross-pieces
const VL_X = -11, VR_X = 5, VM_X = 14;      // the three uprights between them
const D1 = pt(-2, 20), D2 = pt(6, 33);      // the one diagonal, over everything



/**
 * LEVEL 1 — "LATTICE"
 *
 * A woven board: two long diagonals crossing over a pair of uprights and a
 * centre spine, a mid plank and a low brace under those, and two trays behind
 * everything.
 *
 * The grammar is the one real screw-puzzle boards use — thin sticks pinned at
 * their ends and at crossings — because it is the only arrangement where the
 * over/under order is legible at a glance. Big overlapping slabs turn into an
 * ambiguous colour field; two crossing sticks never do.
 *
 * 11 plates on 9 depth layers, 16 screws, 9 pockets, 72 marbles. Four screws
 * are legal at t=0: the two caps and the free lower end of each diagonal.
 */
export const LEVEL_1: LevelDef = {
  id: 'lattice',
  name: 'LATTICE',

  plates: [
    // TWO LAYERS, AND ONLY TWO.
    //
    // Three cross-pieces lie flat on the board; the diagonal and the three
    // uprights lie across them. Nothing sits in between, so every plank is
    // either above EVERYTHING it crosses or below everything it crosses.
    //
    // A plank tucked under one neighbour and lying over another reads as if it
    // bends — you cannot tell whether it is above or below the board, and both
    // of its ends disagree. Five of the seven planks did that before this.
    // Planks inside a layer never overlap each other, so their z only breaks
    // depth-sort ties and is invisible.
    {
      id: 'diag', z: 1.38,
      ...stick(D1, D2, { w: PLANK_W, over: 2.8 }),
      partial: 'rotateAroundRemaining', partialDeg: 18,
      release: 'fallAway',
    },
    {
      id: 'topBar', z: 0.0,
      ...stick(pt(-16, TOP_Y), pt(10, TOP_Y), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 14,
      release: 'fallAway',
    },
    {
      id: 'vLeft', z: 1.2,
      ...stick(pt(VL_X, MID_Y), pt(VL_X, TOP_Y), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: 16,
      release: 'swingOpen', releaseDeg: -80, releasePivot: { x: VL_X, y: TOP_Y },
    },
    {
      id: 'midBar', z: 0.06,
      ...stick(pt(-16, MID_Y), pt(16, MID_Y), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 12,
      release: 'fallAway',
    },
    {
      id: 'vRight', z: 1.26,
      ...stick(pt(VR_X, LOW_Y), pt(VR_X, MID_Y), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: 16,
      release: 'fallAway',
    },
    {
      id: 'lowBar', z: 0.12,
      ...stick(pt(-16, LOW_Y), pt(16, LOW_Y), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 14,
      release: 'fallAway',
    },
    {
      id: 'vMid', z: 1.32,
      ...stick(pt(VM_X, 10), pt(VM_X, 18), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: -16,
      release: 'fallAway',
    },

  ],

  // Solved by `npm run place`, then proved by `npm run validate`.
  // Solved by `npm run joints`: one screw per crossing, plus an end screw where
  // a plank would otherwise hang on a single joint.
  // One screw per crossing — `plate` only says whose face the head is drawn on;
  // what it actually HOLDS is derived from geometry. Plus an end screw where a
  // plank would otherwise hang on a single joint. Checked by `npm run joints`.
  // EIGHT SCREWS, EIGHT CROSSINGS. Every one is a joint through two planks, so
  // every pull lets go of two things at once. `plate` only says whose face the
  // head is drawn on; what a screw HOLDS is derived from geometry.
  // `npm run joints` proves no crossing is left bare.
  screws: [
    { id: 'sDiagTop', plate: 'diag', x: 5.4, y: TOP_Y },
    { id: 'sDiagMid', plate: 'diag', x: -0.2, y: MID_Y },
    { id: 'sLeftTop', plate: 'topBar', x: VL_X, y: TOP_Y },
    { id: 'sLeftMid', plate: 'vLeft', x: VL_X, y: MID_Y },
    { id: 'sRightMid', plate: 'midBar', x: VR_X, y: MID_Y },
    { id: 'sRightLow', plate: 'vRight', x: VR_X, y: LOW_Y },
        { id: 'sMidLow', plate: 'lowBar', x: VM_X, y: LOW_Y },

    // Two end screws that are NOT joints. The rule is that every crossing must
    // be pinned, not that every screw is at a crossing — and a long plank held
    // by three screws comes off in stages instead of all at once.
    { id: 'sTopEnd', plate: 'topBar', x: -14.5, y: TOP_Y },
    { id: 'sLowEnd', plate: 'lowBar', x: -13, y: LOW_Y },
    // ... and one on each upright, in the clear span between the cross-pieces.
    // Without it an upright is held only by joints, so it drops as a side
    // effect of freeing something else — a plank should come off because you
    // decided to take it off.
    { id: 'sLeftOwn', plate: 'vLeft', x: VL_X, y: 27.5 },
    { id: 'sRightOwn', plate: 'vRight', x: VR_X, y: 18.5 },
    { id: 'sMidOwn', plate: 'vMid', x: VM_X, y: 10.5 },

  ],

  // Nine magazines. The row runs along the stick's local +x, so it follows the
  // tilt for free — and what you can see loaded in a stick is exactly what
  // pulling its screws will spill.
  // Nine magazines. The row runs along the stick's local +x, so it follows the
  // tilt for free — and what you can see loaded in a stick is exactly what
  // pulling its screws will spill.
  // Six magazines of nine. `topBar` stays bare wood — a plank you pull purely
  // to free what is under it.
  // Every plank carries something. The four long ones take a full nine; the
  // three short uprights take three — a small spill is a different decision
  // from a big one, and that is the choice the board is made of.
  // Every plank carries something. The four long ones take nine, the three
  // uprights take three — a small spill is a different decision from a big one,
  // and that difference is most of the puzzle.
  pockets: [
    { id: 'pkDiag', color: 'green', count: 9, kind: 'wedge', plate: 'diag', releaseAt: 'partial', x: (D1.x + D2.x) / 2, y: (D1.y + D2.y) / 2, cols: 9, spacing: 2.1 },
    { id: 'pkTop', color: 'red', count: 6, kind: 'tray', plate: 'topBar', releaseAt: 'detached', x: -3, y: TOP_Y, cols: 6, spacing: 2.1 },
    { id: 'pkMid', color: 'blue', count: 6, kind: 'tray', plate: 'midBar', releaseAt: 'detached', x: -3, y: MID_Y, cols: 6, spacing: 2.1 },
    { id: 'pkLow', color: 'yellow', count: 6, kind: 'pocketBehind', plate: 'lowBar', releaseAt: 'detached', x: -3, y: LOW_Y, cols: 6, spacing: 2.1 },
    { id: 'pkVLeft', color: 'yellow', count: 3, kind: 'rotatingCup', plate: 'vLeft', releaseAt: 'detached', x: VL_X, y: 27.5, cols: 3, spacing: 2.1 },
    { id: 'pkVRight', color: 'red', count: 3, kind: 'rotatingCup', plate: 'vRight', releaseAt: 'detached', x: VR_X, y: 18.5, cols: 3, spacing: 2.1 },
    { id: 'pkVMid', color: 'blue', count: 3, kind: 'hopper', plate: 'vMid', releaseAt: 'detached', x: VM_X, y: 14.6, cols: 3, spacing: 2.1 },

  ],

  // 24 boxes x 3 = 72 sockets, exactly the marble supply. R7 B7 Y6 G4.
  // Found by `npm run tune`; the order colours become available is the real
  // difficulty dial and has to be re-solved whenever a pocket changes colour.
  //
  // Opening row is BLUE / YELLOW / RED. There is no green destination anywhere
  // on the board, and diagA — reachable on turn one — is loaded with 9 green.
  receiverStacks: [
    ['red', 'red', 'blue', 'green'],
    ['blue', 'blue', 'yellow', 'green'],
    ['yellow', 'green', 'yellow', 'red'],
  ],

  guides: [
    { id: 'gL', x: -12.6, y: 3.4, w: 17.5, h: 0.85, rot: -0.44 },
    { id: 'gR', x: 12.6, y: 3.4, w: 17.5, h: 0.85, rot: 0.44 },
  ],
};

/**
 * LEVEL 2 — "SCAFFOLD". The hard one.
 *
 * Same three rules as LEVEL 1, enforced the same way: every crossing pinned, no
 * plank sandwiched, nothing buried. What changes is the pressure.
 *
 *   54 MARBLES ON THE SAME 24 BELT. Half again as much stock through a buffer
 *   that did not grow.
 *
 *   THE MIDDLE RAIL IS LAST, AND ITS COLOUR IS TRAPPED WITH IT. Every one of the
 *   five pieces on the top layer crosses `railMid`, so it is the last plank on
 *   the board. And because every one of them crosses it, none of them may share
 *   its colour — which forces its twelve BLUE to be the entire blue supply.
 *   Four blue boxes that cannot be touched until the board is nearly bare.
 *
 *   TWELVE IN ONE POUR. Each rail carries a full twelve, half the belt at once,
 *   and a rail only pours when its last screw is out.
 */
const L2_TOP = 32, L2_MID = 24, L2_LOW = 16;
const L2_UA = -13, L2_UB = -7, L2_UC = 3, L2_UD = 15;   // the four uprights
const L2_DA = pt(7.5, 13), L2_DB = pt(10.5, 25);        // the one diagonal

export const LEVEL_2: LevelDef = {
  id: 'scaffold',
  name: 'SCAFFOLD',
  // Hard on purpose: the best possible play still fills 7/8 of the belt.
  peakBudget: 0.9,

  plates: [
    // --- top layer: four uprights and a diagonal, none of which touch each
    //     other, so all five are free from the first tap ---
    {
      id: 'diag', z: 1.5,
      ...stick(L2_DA, L2_DB, { w: PLANK_W, over: 1.2 }),
      partial: 'rotateAroundRemaining', partialDeg: 18,
      release: 'fallAway',
    },
    {
      id: 'upA', z: 1.44,
      ...stick(pt(L2_UA, L2_MID), pt(L2_UA, L2_TOP), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: 16,
      release: 'swingOpen', releaseDeg: -80, releasePivot: { x: L2_UA, y: L2_TOP },
    },
    {
      id: 'upB', z: 1.38,
      ...stick(pt(L2_UB, L2_LOW), pt(L2_UB, L2_MID), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: -16,
      release: 'fallAway',
    },
    {
      id: 'upC', z: 1.32,
      ...stick(pt(L2_UC, L2_LOW), pt(L2_UC, L2_MID), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: 16,
      release: 'fallAway',
    },
    {
      id: 'upD', z: 1.26,
      ...stick(pt(L2_UD, L2_MID), pt(L2_UD, L2_TOP), { w: PLANK_W, over: 1.6 }),
      partial: 'rotateAroundRemaining', partialDeg: -16,
      release: 'fallAway',
    },

    // --- bottom layer: three rails lying flat. `railMid` is crossed by all
    //     five pieces above, so nothing frees it until they have all gone ---
    {
      id: 'railTop', z: 0.0,
      ...stick(pt(-16, L2_TOP), pt(16, L2_TOP), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 12,
      release: 'fallAway',
    },
    {
      id: 'railMid', z: 0.06,
      ...stick(pt(-15, L2_MID), pt(16, L2_MID), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 12,
      release: 'fallAway',
    },
    {
      id: 'railLow', z: 0.12,
      ...stick(pt(-15, L2_LOW), pt(13, L2_LOW), { w: PLANK_W, over: 0 }),
      partial: 'tiltAroundRemaining', partialDeg: 12,
      release: 'fallAway',
    },
  ],

  // Ten joints plus one private screw per top-layer piece, so nothing comes off
  // as a side effect of freeing something else. Proved by `npm run joints`.
  screws: [
    { id: 's2aTop', plate: 'upA', x: L2_UA, y: L2_TOP },
    { id: 's2aMid', plate: 'upA', x: L2_UA, y: L2_MID },
    { id: 's2bMid', plate: 'upB', x: L2_UB, y: L2_MID },
    { id: 's2bLow', plate: 'upB', x: L2_UB, y: L2_LOW },
    { id: 's2cMid', plate: 'upC', x: L2_UC, y: L2_MID },
    { id: 's2cLow', plate: 'upC', x: L2_UC, y: L2_LOW },
    { id: 's2dTop', plate: 'upD', x: L2_UD, y: L2_TOP },
    { id: 's2dMid', plate: 'upD', x: L2_UD, y: L2_MID },
    { id: 's2gLow', plate: 'diag', x: 8.25, y: L2_LOW },
    { id: 's2gMid', plate: 'diag', x: 10.25, y: L2_MID },

    { id: 's2aOwn', plate: 'upA', x: L2_UA, y: 28 },
    { id: 's2bOwn', plate: 'upB', x: L2_UB, y: 20 },
    { id: 's2cOwn', plate: 'upC', x: L2_UC, y: 20 },
    { id: 's2dOwn', plate: 'upD', x: L2_UD, y: 28 },
    { id: 's2gOwn', plate: 'diag', x: 9.25, y: 20 },
  ],

  // 54 marbles. BLUE exists only on `railMid`, the last plank on the board.
  pockets: [
    { id: 'p2Top', color: 'red', count: 9, kind: 'tray', plate: 'railTop', releaseAt: 'detached', x: -2, y: L2_TOP, cols: 9, spacing: 2.1 },
    { id: 'p2Mid', color: 'blue', count: 9, kind: 'tray', plate: 'railMid', releaseAt: 'detached', x: -2, y: L2_MID, cols: 9, spacing: 2.1 },
    { id: 'p2Low', color: 'yellow', count: 9, kind: 'pocketBehind', plate: 'railLow', releaseAt: 'detached', x: -1, y: L2_LOW, cols: 9, spacing: 2.1 },
    { id: 'p2Diag', color: 'green', count: 6, kind: 'wedge', plate: 'diag', releaseAt: 'partial', x: (L2_DA.x + L2_DB.x) / 2, y: (L2_DA.y + L2_DB.y) / 2, cols: 6, spacing: 2.1 },
    { id: 'p2UpA', color: 'green', count: 3, kind: 'rotatingCup', plate: 'upA', releaseAt: 'detached', x: L2_UA, y: 30, cols: 3, spacing: 2.1 },
    { id: 'p2UpB', color: 'red', count: 3, kind: 'rotatingCup', plate: 'upB', releaseAt: 'detached', x: L2_UB, y: 18, cols: 3, spacing: 2.1 },
    { id: 'p2UpC', color: 'red', count: 3, kind: 'rotatingCup', plate: 'upC', releaseAt: 'detached', x: L2_UC, y: 18, cols: 3, spacing: 2.1 },
    { id: 'p2UpD', color: 'yellow', count: 3, kind: 'hopper', plate: 'upD', releaseAt: 'detached', x: L2_UD, y: 30, cols: 3, spacing: 2.1 },
  ],

  // 18 boxes x 3 = 54. Re-solved by `npm run tune -- --level 2`.
  receiverStacks: [
    ['yellow', 'red', 'red', 'blue', 'yellow'],
    ['red', 'green', 'red', 'red', 'green'],
    ['blue', 'green', 'yellow', 'blue', 'yellow'],
  ],

  guides: [
    { id: 'gL', x: -12.6, y: 3.4, w: 17.5, h: 0.85, rot: -0.44 },
    { id: 'gR', x: 12.6, y: 3.4, w: 17.5, h: 0.85, rot: 0.44 },
  ],
};

export const LEVELS: LevelDef[] = [LEVEL_1, LEVEL_2];

// ------------------------------------------------------------- derivations ---

/**
 * What colour a plate is painted: the colour of the batch it holds. A plate with
 * no pocket falls back to neutral hardware grey.
 */
export function plateTint(level: LevelDef, plateId: string): PlateTint {
  const def = level.plates.find((p) => p.id === plateId);
  if (def?.tint) return def.tint;
  const pk = level.pockets.find((p) => p.plate === plateId);
  return pk ? pk.color : 'neutral';
}

export function colorSupply(level: LevelDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of level.pockets) out[p.color] = (out[p.color] ?? 0) + p.count;
  return out;
}

export function colorDemand(level: LevelDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of level.receiverStacks) {
    for (const c of col) out[c] = (out[c] ?? 0) + TUNING.RECEIVER_CAPACITY;
  }
  return out;
}

/** Marble slot offsets inside a pocket, filled bottom row first. */
export function pocketSlot(p: PocketDef, index: number) {
  const cols = p.cols;
  const rows = Math.ceil(p.count / cols);
  const s = p.spacing ?? LAYOUT.pocketSpacing;
  const i = p.count - 1 - index; // drain from the bottom up
  const r = Math.floor(i / cols);
  const c = i % cols;
  return {
    dx: (c - (cols - 1) / 2) * s,
    dy: (r - (rows - 1) / 2) * s,
  };
}
