/**
 * Net (usable) area. Centerline area stays internal and is never formatted
 * for the UI by this module.
 */

import { floorsByElevation } from '../model/document.js';
import { deriveRooms } from '../rooms/index.js';

/**
 * Sum of net mm², skipping balconies. `derived` faces carry `roomId` + `area`.
 * @param {object[]} derived
 * @param {object[]} rooms
 */
export function suiteNetMm2(derived, rooms) {
  const typeOf = new Map((rooms || []).map((room) => [room.id, room.type]));
  let sum = 0;
  for (const face of derived || []) {
    if (typeOf.get(face.roomId) === 'balcony') continue;
    sum += face.area || 0;
  }
  return sum;
}

/** @param {object[]} derived @param {object[]} rooms */
export function suiteNetM2(derived, rooms) {
  return suiteNetMm2(derived, rooms) / 1e6;
}

/**
 * Net m² of the lowest floor, excluding balconies.
 * Returns null when the plan cannot be derived.
 * @param {object} plan
 */
export function planNetM2(plan) {
  const ordered = floorsByElevation(plan);
  const floor = ordered[0];
  if (!floor) return null;
  try {
    const result = deriveRooms(plan, floor.id);
    return suiteNetM2(result.derived, result.rooms);
  } catch {
    return null;
  }
}

/**
 * Integer m² for template cards (「使用面积约 34 m²」).
 * Falls back when derivation fails or is empty.
 * @param {number|null} computed
 * @param {number|null|undefined} fallback
 */
export function aboutNetM2(computed, fallback) {
  const n = Number.isFinite(computed) && computed > 0 ? computed : fallback;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
