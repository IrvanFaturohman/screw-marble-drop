/**
 * SCREW MARBLE DROP — central tuning + layout config.
 *
 * WORLD UNITS: 1 unit = 10 screen px on the 390x844 reference viewport, so the
 * visible board is 39 x 84.4 units with the origin at its centre. Every layout
 * number below is in those units, which makes the brief's percentage bands
 * checkable by arithmetic instead of by eye.
 *
 * Everything that changes how the game FEELS lives in `TUNING`. The debug panel
 * edits that object live, so gameplay code must read from it every frame rather
 * than caching values at construction time.
 */

export const TARGET_VIEWPORT_WIDTH = 390;
export const TARGET_VIEWPORT_HEIGHT = 844;
export const ASPECT = TARGET_VIEWPORT_WIDTH / TARGET_VIEWPORT_HEIGHT;

/** Board half-extents in world units. */
export const BOARD_W = 39;
export const BOARD_H = 84.4;
export const HALF_W = BOARD_W / 2;
export const HALF_H = BOARD_H / 2;

// ---------------------------------------------------------------- colours ---

export type MarbleColor = 'red' | 'blue' | 'yellow' | 'green';
export const ALL_COLORS: MarbleColor[] = ['red', 'blue', 'yellow', 'green'];

export interface Swatch {
  /** Marble body — saturated polished resin, not glass. */
  hex: number;
  light: number;
  deep: number;
  css: string;
  cssLight: string;
  cssDeep: string;
  label: string;
}

export const COLORS: Record<MarbleColor, Swatch> = {
  red:    { hex: 0xf03c34, light: 0xff9c94, deep: 0x8b1310, css: '#f03c34', cssLight: '#ff9c94', cssDeep: '#8b1310', label: 'RED' },
  blue:   { hex: 0x2f86f5, light: 0x9dc8ff, deep: 0x0e3878, css: '#2f86f5', cssLight: '#9dc8ff', cssDeep: '#0e3878', label: 'BLUE' },
  yellow: { hex: 0xffbe27, light: 0xffe698, deep: 0x8a5a00, css: '#ffbe27', cssLight: '#ffe698', cssDeep: '#8a5a00', label: 'YELLOW' },
  green:  { hex: 0x27c069, light: 0x9ce8b8, deep: 0x0c5b2c, css: '#27c069', cssLight: '#9ce8b8', cssDeep: '#0c5b2c', label: 'GREEN' },
};

/**
 * A plate is painted the colour of the batch it holds.
 *
 * The first pass made plates pastel-neutral so plate colour could never be
 * confused with marble colour. That was the wrong call: three translucent
 * layers turned the sculpture into one purple wash, and the single most useful
 * fact about a plate — WHAT IT WILL SPILL — was being thrown away to avoid a
 * confusion that never happens (plates are matte slabs, marbles are glossy
 * spheres; nobody mistakes one for the other).
 *
 * So plates are opaque and colour-coded, and the shade is derived rather than
 * authored:
 *   - mixed toward warm grey, so the glossy marble stays the brightest thing
 *   - lightened by depth, so the front reads nearer AND two plates holding the
 *     same colour on different layers never merge.
 */
export type PlateTint = MarbleColor | 'neutral';

const mixHex = (a: number, b: number, t: number) => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
};
const scaleHex = (c: number, k: number) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
};

/** Body / rim / edge for a plate holding `tint`, sitting at depth `z`. */
export function plateShade(tint: PlateTint, z: number) {
  // An unloaded stick is bare wood, so it reads as part of the board rather
  // than as a colour the receivers might want.
  const base = tint === 'neutral' ? 0xc98a4a : COLORS[tint].hex;
  // z runs about -3.2 (back) to 2.9 (front).
  const depth = Math.min(1, Math.max(0, (z + 3.4) / 6.5));
  // A wide swing, because depth is what separates two sticks of the same
  // colour that the 4-colouring could not pull apart.
  const k = 0.55 + depth * 0.52;
  // Duller than the marbles it holds — but only just. The stick has to READ as
  // its colour ("the one full of yellow is yellow"), so the separation from the
  // beads comes from the dark edge below, not from washing the hue out.
  const body = scaleHex(mixHex(base, 0x8d8378, 0.30), k);
  return {
    hex: body,
    rim: scaleHex(mixHex(base, 0xffffff, 0.62), Math.min(1.25, k + 0.22)),
    edge: scaleHex(mixHex(base, 0x1b1712, 0.72), k),
    /** The recessed well the batch sits in — darker than the plate face. */
    well: scaleHex(mixHex(base, 0x241f1a, 0.62), k),
  };
}

/** Warm neutral toy-workshop palette. Deliberately quiet. */
export const ENV = {
  bgTop: 0xf7efe1,
  bgBottom: 0xdfd0b6,
  table: 0xe4d6bd,
  frame: 0xd8ccb6,
  frameDark: 0x8f8674,
  acrylic: 0xdfe9f2,
  acrylicDark: 0x9fb0c2,
  metal: 0xcfd7e2,
  metalDark: 0x8d98a8,
  metalDeep: 0x5d6674,
  rubber: 0x3b4250,
  rubberDark: 0x272d38,
  ink: '#3a3225',
  inkSoft: '#8a7c63',
} as const;

// ----------------------------------------------------------------- layout ---

/**
 * Vertical bands, in world units, top to bottom. Percentages are of the 84.4-unit
 * board so the brief's composition budget stays auditable.
 */
export const LAYOUT = {
  /** HUD strip — 6%. DOM overlay, no 3D content. */
  hudBottom: 37.1,

  // --- source: ONE radial screw sculpture, not a rack of boxes ---
  /** Centre of the sculpture. Everything radial is authored in polar coords
   *  around this point, which is what keeps it reading as one machine. */
  structCX: 0,
  structCY: 23.6,
  /** Outer reach of the sculpture at scale 1. */
  structOuter: 13.2,
  /** One knob for the whole machine's size. Capped by the blades: their arc
   *  peaks at 100deg and that peak has to clear the HUD strip. */
  structScale: 1.10,

  /** Screw head radius. Big: this is the only tap target in the game. */
  screwR: 1.2,
  /** Screw heads sit this far in front of the plate they pin. */
  screwZ: 1.1,
  /** Marble grid spacing inside a pocket. */
  pocketSpacing: 2.3,

  /** Empty fall space: from the bottom of the sculpture down to the funnel. */
  fallTop: 8.5,
  funnelTop: 1.2,
  funnelBottom: -4.8,
  funnelMouthHalf: 18.5,
  funnelThroatHalf: 4.2,

  /** Shared conveyor loop — 19%. Oval in the XY plane, facing the player. */
  loopCX: 0,
  loopCY: -13.0,
  loopRX: 17.0,
  loopRY: 6.5,
  /** Channel the marbles ride in. */
  beltChannelW: 3.4,
  /** Z of a marble centre while riding the belt (it sits ON the track). */
  beltZ: 1.5,

  /** Receiver stacks — 25%. */
  recvColX: [-12.6, 0, 12.6] as const,
  recvBoxY: -27.5,
  recvBoxW: 11.0,
  recvBoxH: 8.6,
  recvSocketDX: 3.0,
  recvSocketDY: 1.1,
  /** Queued boxes peek out beneath the active one. */
  recvQueueY: -33.6,
  recvQueueStep: 2.6,
  /** How many queued boxes are drawn before the "+n" counter takes over. */
  recvQueueVisible: 3,

  /** Depth of the playfield. Marbles are contained to this slab. */
  zBack: -3.2,
  zFront: 3.2,
} as const;

// ----------------------------------------------------------------- tuning ---

export const TUNING = {
  // --- global ---
  GAME_SPEED: 1,

  // --- batch ---
  /** Marbles per chamber unless the level overrides it. */
  DEFAULT_BATCH_SIZE: 9,
  /** ms between marbles in one release. 9 marbles land inside ~200ms. */
  BATCH_RELEASE_INTERVAL: 22,
  /** Sideways scatter given to each marble as it leaves, world units/s. */
  BATCH_RELEASE_SPREAD: 4.6,

  // --- screw + gate ---
  UNSCREW_DURATION: 420,
  UNSCREW_TURNS: 3.2,
  /** How far the head backs out before it drops to the screw tray. */
  UNSCREW_LIFT: 2.6,
  /** A plate swinging to its partial pose after losing one of two supports. */
  PLATE_PARTIAL_MS: 420,
  /** A plate leaving the board once its last support is gone. */
  PLATE_RELEASE_MS: 620,
  /** Downward acceleration for a plate that falls away. */
  PLATE_FALL_GRAVITY: -52,

  // --- marble physics ---
  MARBLE_RADIUS: 1.05,
  MARBLE_MASS: 1.0,
  MARBLE_RESTITUTION: 0.38,
  MARBLE_FRICTION: 0.22,
  MARBLE_LINEAR_DAMPING: 0.12,
  MARBLE_ANGULAR_DAMPING: 0.35,
  MARBLE_GRAVITY: -62,
  /** Speed clamp so nothing tunnels through a guide. */
  MARBLE_MAX_SPEED: 78,

  // --- funnel / containment ---
  /** Sideways pull toward the funnel throat once a marble is below the source. */
  FUNNEL_ASSIST_STRENGTH: 46,
  /** Pull toward the z=0 slab, so marbles never drift out of the play plane. */
  SLAB_ASSIST_STRENGTH: 34,
  /** A marble airborne longer than this is flown straight to the belt. */
  MARBLE_RESCUE_MS: 3200,
  /** A falling marble that has barely moved for this long gets shoved. Flat
   *  ledges are a physics reality; a marble parked on one is a broken game, and
   *  waiting for the rescue teleport reads as the game freezing. */
  ANTI_REST_MS: 260,
  ANTI_REST_IMPULSE: 11,

  // --- conveyor ---
  CONVEYOR_CAPACITY: 24,
  /** Arc units per second. */
  CONVEYOR_SPEED: 13.5,
  /** Speed multiplier for a marble whose colour has an open receiver. */
  CONVEYOR_RUSH_MULT: 2.2,
  /** Minimum arc gap between marble centres. */
  CONVEYOR_MIN_GAP: 2.6,
  /** ms for a captured marble to ease from its impact point onto the belt. */
  CONVEYOR_INTAKE_MS: 200,

  // --- auto sorting ---
  /** ms between two marbles leaving the belt. This is the tik-tik-tik rhythm. */
  AUTO_SORT_INTERVAL: 95,
  /** Arc half-width of the collection gate at the bottom of the loop. */
  EXIT_GATE_HALF: 6.0,
  SORT_FLIGHT_DURATION: 260,

  // --- receivers ---
  RECEIVER_CAPACITY: 3,
  RECEIVER_COMPLETE_DELAY: 170,
  RECEIVER_SWAP_DURATION: 260,

  // --- feel ---
  cameraShakeIntensity: 1,
  particleMultiplier: 1,
  juiceEnabled: true,
  audioVolume: 0.5,
  hapticEnabled: true,
};

export type TuningType = typeof TUNING;
