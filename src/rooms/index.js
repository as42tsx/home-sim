/**
 * Room recognition: normalize a floor's walls, find faces, reconcile stored
 * room attributes. See docs/data-model.md.
 */

export { deriveAllFloors, deriveRooms } from './derive.js';
export { findFaces } from './faces.js';
export { normalizeFloor } from './normalize.js';
export { reconcileRooms } from './reconcile.js';
