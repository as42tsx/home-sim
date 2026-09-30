/**
 * Commands know how to apply a change and which descriptor the 3D view should
 * see. The store snapshots the plan, so invert is the stored before-state.
 */

import { checkOpeningPlacement } from '../openings/clearance.js';
import {
  addFurnitureItem,
  addOpening,
  addWall,
  bakeNormalized,
  deleteOpening,
  deleteWall,
  demolishWall,
  duplicateFurnitureItem,
  moveNodes,
  patchFurnitureItem,
  patchRoom,
  patchWall,
  rederiveFloor,
  removeFurnitureItem,
  updateOpening,
} from './structure.js';

/** @param {object} change @param {(plan: object, previousFor: (floorId: string) => object[]|undefined) => object} apply */
export function command(change, apply) {
  return { change, apply };
}

/** @param {string} floorId @param {(plan: object, floorId: string) => void} mutate */
export function structureCommand(floorId, mutate) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    mutate(plan, floorId);
    rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

/** @param {string} floorId @param {string[]} ids @param {(plan: object, floorId: string) => void} mutate */
export function furnitureCommand(floorId, ids, mutate) {
  return command({ kind: 'furniture', floorId, ids: [...ids] }, (plan) => {
    mutate(plan, floorId);
    return plan;
  });
}

/** @param {(plan: object) => void} mutate */
export function metaCommand(mutate) {
  return command({ kind: 'meta' }, (plan) => {
    mutate(plan);
    return plan;
  });
}

export function renameCommand(name) {
  return metaCommand((plan) => {
    plan.meta.name = name;
  });
}

export function wallAddCommand(floorId, p1, p2, style) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    const added = addWall(plan, floorId, p1, p2, style);
    if (added.ok) rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

export function nodesMoveCommand(floorId, moves) {
  return structureCommand(floorId, (plan) => {
    moveNodes(plan, floorId, moves);
  });
}

/** Bake junction splits. One history step when dispatched on its own. */
export function bakeCommand(floorId) {
  return structureCommand(floorId, (plan) => {
    bakeNormalized(plan, floorId);
  });
}

export function wallDeleteCommand(floorId, wallId) {
  return structureCommand(floorId, (plan) => {
    deleteWall(plan, floorId, wallId);
  });
}

export function wallPatchCommand(floorId, wallId, patch) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    const result = patchWall(plan, floorId, wallId, patch);
    if (result.ok) rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

export function wallDemolishCommand(floorId, wallId) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    const result = demolishWall(plan, floorId, wallId);
    if (result.ok) rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

export function roomPatchCommand(floorId, roomId, patch) {
  return command({ kind: 'structure', floorId }, (plan) => {
    patchRoom(plan, floorId, roomId, patch);
    return plan;
  });
}

export function openingAddCommand(floorId, opening) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    const result = addOpening(plan, floorId, opening, checkOpeningPlacement);
    if (result.ok) rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

export function openingPatchCommand(floorId, openingId, patch) {
  return command({ kind: 'structure', floorId }, (plan, previousFor) => {
    const result = updateOpening(plan, floorId, openingId, patch, checkOpeningPlacement);
    if (result.ok) rederiveFloor(plan, floorId, previousFor(floorId));
    return plan;
  });
}

export function openingDeleteCommand(floorId, openingId) {
  return structureCommand(floorId, (plan) => {
    deleteOpening(plan, floorId, openingId);
  });
}

export function furnitureAddCommand(floorId, item) {
  return furnitureCommand(floorId, [item.id], (plan) => {
    addFurnitureItem(plan, floorId, item);
  });
}

export function furniturePatchCommand(floorId, id, patch) {
  return furnitureCommand(floorId, [id], (plan) => {
    patchFurnitureItem(plan, floorId, id, patch);
  });
}

export function furnitureDeleteCommand(floorId, id) {
  return furnitureCommand(floorId, [id], (plan) => {
    removeFurnitureItem(plan, floorId, id);
  });
}

export function furnitureDuplicateCommand(floorId, id) {
  let copyId = null;
  const cmd = furnitureCommand(floorId, [id], (plan) => {
    copyId = duplicateFurnitureItem(plan, floorId, id);
  });
  const apply = cmd.apply;
  cmd.apply = (plan, previousFor) => {
    const next = apply(plan, previousFor);
    if (copyId) cmd.change = { kind: 'furniture', floorId, ids: [id, copyId] };
    return next;
  };
  return cmd;
}
