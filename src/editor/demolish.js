/**
 * Before/after numbers for the demolish confirm dialog.
 * C is the net area that comes back when the wall leaves the graph, so
 * A + B + C equals the merged room (US-05 AC3).
 */

import { getFloor } from '../model/document.js';
import { deriveRooms } from '../rooms/index.js';
import { cloneData } from './clone.js';

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {string} wallId
 */
export function previewDemolish(plan, floorId, wallId) {
  const floor = getFloor(plan, floorId);
  const wall = floor?.walls.find((item) => item.id === wallId);
  if (!floor || !wall) return null;
  const before = deriveRooms(plan, floorId);
  const pieces = new Set(before.normalized.map?.[wallId] || []);
  pieces.add(wallId);
  const faces = before.derived.filter((face) => (face.wallIds || []).some((id) => pieces.has(id)));
  const openings = (floor.openings || []).filter((opening) => opening.wall === wallId).map((opening) => ({
    id: opening.id,
    kind: opening.kind,
    width: opening.width,
  }));

  const copy = cloneData(plan);
  const copyFloor = getFloor(copy, floorId);
  const copyWall = copyFloor.walls.find((item) => item.id === wallId);
  if (copyWall) copyWall.demolished = true;
  copyFloor.openings = copyFloor.openings.filter((opening) => opening.wall !== wallId);
  const after = deriveRooms(copy, floorId, { previousDerived: before.derived });

  const ranked = [...faces].sort((a, b) => (b.area || 0) - (a.area || 0));
  const aFace = ranked[0] || null;
  const bFace = ranked[1] || null;
  const aArea = aFace?.area || 0;
  const bArea = bFace?.area || 0;
  const survivorId = after.rooms.find((room) => ranked.some((face) => face.roomId === room.id))?.id
    || after.rooms[0]?.id
    || null;
  const survivor = after.derived.find((face) => face.roomId === survivorId) || null;
  const merged = survivor?.area || (aArea + bArea);
  const wallFootprint = merged - aArea - bArea;
  const largerRoom = before.rooms.find((room) => room.id === aFace?.roomId) || null;

  return {
    wallId,
    bearing: !!wall.bearing,
    openings,
    faces,
    before,
    after,
    largerRoom,
    survivorId,
    aArea,
    bArea,
    wallFootprint,
    merged,
    beforePolys: before.derived.map(facePoly),
    afterPolys: after.derived.map(facePoly),
  };
}

function facePoly(face) {
  return {
    roomId: face.roomId,
    points: face.polygon || face.centerline || [],
    area: face.area || 0,
  };
}
