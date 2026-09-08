/**
 * Entry point for `npm run validate` / `npm run inspect` / `npm run place`.
 *
 * No renderer — but the REAL physics driver is exported too. `RapierDriver`
 * imports only Rapier and config, never Three, so the tools can play the level
 * with the exact bodies the phone runs. That matters: the belt is a circulating
 * queue and receivers only take from the exit gate, so marble ARRIVAL ORDER
 * decides which box closes first. A level tuned against the scripted driver can
 * therefore deadlock under Rapier, which is what shipped-and-lost looks like.
 */
export { GameModel } from './GameModel';
export { SourceModel } from './SourceModel';
export { SortingModel, socketPos } from './SortingModel';
export { ScriptedDriver, applyAssists } from './MarbleDriver';
export { RapierDriver } from '../physics/RapierDriver';
export { LoopPath, clamp, smoothstep } from './Geometry';
export {
  containsLocal, containsWorld, shapeBounds, shapeBox, shapeBoxRot, toLocal, toWorld, deg, polar,
} from './PlateShapes';
export { LEVEL_1, LEVELS, colorSupply, colorDemand, pocketSlot } from '../config/LevelConfig';
export { TUNING, LAYOUT, COLORS, ALL_COLORS, BOARD_W, BOARD_H, HALF_W, HALF_H } from '../config/GameConfig';
