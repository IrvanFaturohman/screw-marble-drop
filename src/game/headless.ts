/**
 * Entry point for `npm run validate` / `npm run inspect` / `npm run joints`.
 *
 * No renderer, and no physics engine either. Sand is a deterministic flow
 * network — volume moving between nodes at authored rates — so the tools play
 * the EXACT simulation the phone runs, with no model-versus-reality gap to
 * chase. The rigid-body marble driver that used to live here is gone with the
 * marbles.
 */
export { GameModel } from './GameModel';
export { SourceModel } from './SourceModel';
export { SandModel } from './SandModel';
export { LoopPath, clamp, smoothstep } from './Geometry';
export {
  containsLocal, containsWorld, shapeBounds, shapeBox, shapeBoxRot, toLocal, toWorld, deg, polar,
} from './PlateShapes';
export { LEVEL_1, LEVELS, colorSupply, colorDemand, reservoirBand } from '../config/LevelConfig';
export { TUNING, LAYOUT, COLORS, ALL_COLORS, BOARD_W, BOARD_H, HALF_W, HALF_H } from '../config/GameConfig';
