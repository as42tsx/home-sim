/**
 * Per-floor room derivation. Floors do not affect each other.
 * `deriveRooms` reads `plan` and returns new objects; it does not write back.
 */

import { getFloor } from '../model/document.js';
import { findFaces } from './faces.js';
import { normalizeFloor } from './normalize.js';
import { reconcileRooms } from './reconcile.js';

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {object} [opts]
 * @param {number} [opts.tolerance]
 * @param {number} [opts.minWallLen]
 * @param {() => string} [opts.idGenerator]
 * @param {object[]} [opts.previousDerived] last `derived` array, used so a merge keeps the larger room
 * @returns {{ rooms: object[], derived: object[], normalized: object, unclosed: object }}
 */
export function deriveRooms(plan, floorId, opts = {}) {
  const floor = getFloor(plan, floorId);
  if (!floor) {
    const error = new Error(`Unknown floor "${floorId}"`);
    error.code = 'UNKNOWN_FLOOR';
    throw error;
  }
  const normalized = normalizeFloor(floor, opts);
  const { faces, unclosed } = findFaces(normalized.nodes, normalized.walls);
  const { rooms, derived } = reconcileRooms(floor.rooms || [], faces, opts);
  return { rooms, derived, normalized, unclosed };
}

/**
 * Derive every floor. `opts.previousDerived` is not applied globally; pass
 * `opts.previousByFloor = { [floorId]: derived[] }` to continue a merge on
 * one floor without leaking that history onto the others.
 * @param {object} plan
 * @param {object} [opts]
 * @returns {Record<string, object>}
 */
export function deriveAllFloors(plan, opts = {}) {
  const out = {};
  const floors = Array.isArray(plan?.floors) ? plan.floors : [];
  for (const floor of floors) {
    const floorOpts = { ...opts };
    if (opts.previousByFloor && opts.previousByFloor[floor.id]) {
      floorOpts.previousDerived = opts.previousByFloor[floor.id];
    } else {
      delete floorOpts.previousDerived;
    }
    delete floorOpts.previousByFloor;
    out[floor.id] = deriveRooms(plan, floor.id, floorOpts);
  }
  return out;
}
