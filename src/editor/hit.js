/**
 * Pointer hits in plan space. Screen handles use `pxPerMm`.
 */

import { pointOnSegment } from '../geometry/segment.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { dist } from '../geometry/vec.js';
import { obbCorners } from './collision.js';

/**
 * @param {object} item
 * @returns {{x:number,y:number}}
 */
export function rotateHandlePoint(item) {
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const ly = -((item.d || 0) / 2 + 280);
  return {
    x: item.cx - ly * sin,
    y: item.cy + ly * cos,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.floor
 * @param {object} opts.derived deriveRooms result
 * @param {{x:number,y:number}} opts.world
 * @param {number} opts.pxPerMm
 * @param {{kind:string,id:string}|null} opts.selection
 * @param {'plan'|'furnish'} [opts.mode]
 */
export function hitTest(opts) {
  const { floor, world, pxPerMm } = opts;
  const selection = opts.selection;
  const mode = opts.mode || 'plan';
  if (!floor || !world || !(pxPerMm > 0)) return null;
  const handleMm = 12 / pxPerMm;
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));

  if (selection?.kind === 'wall') {
    const wall = floor.walls.find((item) => item.id === selection.id && !item.demolished);
    if (wall) {
      for (const id of [wall.a, wall.b]) {
        const node = nodes.get(id);
        if (node && dist(world, node) <= handleMm) return { kind: 'node', id, wallId: wall.id };
      }
    }
  }

  if (selection?.kind === 'furniture') {
    const item = (floor.furniture || []).find((entry) => entry.id === selection.id);
    if (item) {
      const handle = rotateHandlePoint(item);
      if (dist(world, handle) <= handleMm) return { kind: 'rotate', id: item.id };
    }
  }

  const furnitureHit = hitFurniture(floor.furniture || [], world);
  const openingHit = hitOpening(floor, nodes, world, pxPerMm);
  const wallHit = hitWall(floor, nodes, world, pxPerMm);
  const roomHit = hitRoom(opts.derived, world);

  if (opts.prefer === 'room') return roomHit || openingHit || wallHit || furnitureHit;
  if (mode === 'furnish') return furnitureHit || openingHit || wallHit || roomHit;
  return openingHit || wallHit || furnitureHit || roomHit;
}

function hitFurniture(furniture, world) {
  for (let i = furniture.length - 1; i >= 0; i -= 1) {
    const item = furniture[i];
    if (pointInPolygon(world, obbCorners(item))) return { kind: 'furniture', id: item.id };
  }
  return null;
}

function hitOpening(floor, nodes, world, pxPerMm) {
  const slack = 8 / pxPerMm;
  for (const opening of floor.openings || []) {
    const wall = floor.walls.find((item) => item.id === opening.wall);
    if (!wall || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const proj = pointOnSegment(world, a, b);
    const len = dist(a, b) || 1;
    const centre = opening.t * len;
    const along = proj.t * len;
    const half = (opening.width || 0) / 2 + slack;
    const limit = Math.max((wall.thickness || 0) / 2, 80) + slack;
    if (Math.abs(along - centre) <= half && proj.distance <= limit) {
      return { kind: 'opening', id: opening.id };
    }
  }
  return null;
}

function hitWall(floor, nodes, world, pxPerMm) {
  const slack = 4 / pxPerMm;
  let best = null;
  for (const wall of floor.walls || []) {
    if (wall.demolished || wall.virtual) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const proj = pointOnSegment(world, a, b);
    const limit = (wall.thickness || 0) / 2 + slack;
    if (proj.distance <= limit && (!best || proj.distance < best.distance)) {
      best = { distance: proj.distance, id: wall.id };
    }
  }
  if (best) return { kind: 'wall', id: best.id };
  for (const wall of floor.walls || []) {
    if (!wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const proj = pointOnSegment(world, a, b);
    if (proj.distance <= 10 / pxPerMm) return { kind: 'wall', id: wall.id };
  }
  return null;
}

function hitRoom(derived, world) {
  const faces = derived?.derived || [];
  const rooms = derived?.rooms || [];
  for (const face of faces) {
    const poly = face.polygon?.length >= 3 ? face.polygon : face.centerline;
    if (!poly || !pointInPolygon(world, poly)) continue;
    let inHole = false;
    for (const hole of face.holePolygons || []) {
      if (pointInPolygon(world, hole)) inHole = true;
    }
    if (inHole) continue;
    const room = rooms.find((item) => item.id === face.roomId);
    return { kind: 'room', id: face.roomId, name: room?.name || '' };
  }
  return null;
}
