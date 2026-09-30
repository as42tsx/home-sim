/**
 * Mutations on one floor. Callers pass a plan they already cloned.
 * Structural edits that change the graph should call {@link rederiveFloor}
 * afterwards so room names survive merges and splits.
 */

import { MIN_WALL_LEN_MM, WALL_THICKNESS } from '../model/constants.js';
import { getFloor } from '../model/document.js';
import { uniqueId } from '../model/ids.js';
import { dist } from '../geometry/vec.js';
import { deriveRooms, normalizeFloor } from '../rooms/index.js';
import { defaultFloorForType } from './materials.js';

/** @param {number} thickness */
export function clampThickness(thickness) {
  const n = Number(thickness);
  if (!Number.isFinite(n)) return WALL_THICKNESS.default;
  return Math.min(WALL_THICKNESS.max, Math.max(WALL_THICKNESS.min, n));
}

/**
 * Write reconciled rooms back onto the floor.
 * @param {object} plan
 * @param {string} floorId
 * @param {object[]|undefined} previousDerived
 */
export function rederiveFloor(plan, floorId, previousDerived) {
  const result = deriveRooms(plan, floorId, {
    previousDerived: previousDerived || undefined,
    idGenerator: () => uniqueId('r'),
  });
  const floor = getFloor(plan, floorId);
  floor.rooms = result.rooms.map(storedRoom);
  return result;
}

function storedRoom(room) {
  const out = {
    id: room.id,
    name: room.name,
    type: room.type,
    floor: room.floor,
    floorOffset: room.floorOffset ?? 0,
    seed: { x: room.seed.x, y: room.seed.y },
  };
  if (room.ext) out.ext = { ...room.ext };
  return out;
}

/**
 * Replace the live graph with the normalized one so T and X junctions are
 * stored split. Demolished walls stay on the plan and keep their nodes.
 * Opening `t` is recomputed from the opening's world centre.
 * @param {object} plan
 * @param {string} floorId
 */
export function bakeNormalized(plan, floorId) {
  const floor = getFloor(plan, floorId);
  if (!floor) return;
  const norm = normalizeFloor(floor);
  const demolished = (floor.walls || []).filter((wall) => wall.demolished);
  const nodeById = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const nodes = [];
  const seen = new Set();
  for (const node of norm.nodes) {
    nodes.push({ id: node.id, x: node.x, y: node.y });
    seen.add(node.id);
  }
  for (const wall of demolished) {
    for (const id of [wall.a, wall.b]) {
      if (seen.has(id) || !nodeById.has(id)) continue;
      const node = nodeById.get(id);
      nodes.push({ id: node.id, x: node.x, y: node.y });
      seen.add(id);
    }
  }
  const walls = norm.walls.map(storedWall).concat(demolished.map((wall) => ({ ...wall })));
  floor.nodes = nodes;
  floor.walls = walls;
  floor.openings = norm.openings.map((opening) => {
    const { sourceIds, ...rest } = opening;
    void sourceIds;
    return rest;
  });
}

function storedWall(wall) {
  const out = {
    id: wall.id,
    a: wall.a,
    b: wall.b,
    thickness: wall.thickness,
    height: wall.height ?? null,
    bearing: !!wall.bearing,
    exterior: !!wall.exterior,
    demolished: false,
    virtual: !!wall.virtual,
    finish: {
      left: wall.finish?.left ?? '',
      right: wall.finish?.right ?? '',
    },
  };
  if (wall.ext) out.ext = { ...wall.ext };
  return out;
}

/** Drop nodes that no wall references. */
export function pruneNodes(floor) {
  const used = new Set();
  for (const wall of floor.walls || []) {
    used.add(wall.a);
    used.add(wall.b);
  }
  floor.nodes = (floor.nodes || []).filter((node) => used.has(node.id));
}

function takeNode(floor, point) {
  if (point?.nodeId) {
    const found = floor.nodes.find((node) => node.id === point.nodeId);
    if (found) return found;
  }
  for (const node of floor.nodes) {
    if (Math.hypot(node.x - point.x, node.y - point.y) <= 1) return node;
  }
  const node = { id: uniqueId('n'), x: point.x, y: point.y };
  floor.nodes.push(node);
  return node;
}

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {{x:number,y:number,nodeId?:string}} p1
 * @param {{x:number,y:number,nodeId?:string}} p2
 * @param {{thickness?:number, virtual?:boolean, bearing?:boolean, exterior?:boolean}} style
 */
export function addWall(plan, floorId, p1, p2, style = {}) {
  const floor = getFloor(plan, floorId);
  if (!floor) return { ok: false, reason: 'floor' };
  const beforeNodes = new Set(floor.nodes.map((node) => node.id));
  const a = takeNode(floor, p1);
  const b = takeNode(floor, p2);
  const fresh = [a, b].filter((node) => !beforeNodes.has(node.id));
  if (a.id === b.id || dist(a, b) < MIN_WALL_LEN_MM) {
    floor.nodes = floor.nodes.filter((node) => !fresh.includes(node));
    return { ok: false, reason: 'short' };
  }
  const virtual = !!style.virtual;
  const id = uniqueId('w');
  floor.walls.push({
    id,
    a: a.id,
    b: b.id,
    thickness: clampThickness(style.thickness),
    height: null,
    bearing: virtual ? false : !!style.bearing,
    exterior: !!style.exterior,
    demolished: false,
    virtual,
    finish: { left: '', right: '' },
  });
  bakeNormalized(plan, floorId);
  return { ok: true, wallId: id, nodeA: a.id, nodeB: b.id };
}

/** @param {object} plan @param {string} floorId @param {{id:string,x:number,y:number}[]} moves */
export function moveNodes(plan, floorId, moves) {
  const floor = getFloor(plan, floorId);
  if (!floor) return;
  for (const move of moves) {
    const node = floor.nodes.find((item) => item.id === move.id);
    if (!node) continue;
    node.x = move.x;
    node.y = move.y;
  }
}

/** @param {object} plan @param {string} floorId @param {string} wallId */
export function deleteWall(plan, floorId, wallId) {
  const floor = getFloor(plan, floorId);
  if (!floor) return { openings: 0 };
  const openings = floor.openings.filter((opening) => opening.wall === wallId).length;
  floor.walls = floor.walls.filter((wall) => wall.id !== wallId);
  floor.openings = floor.openings.filter((opening) => opening.wall !== wallId);
  pruneNodes(floor);
  return { openings };
}

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {string} wallId
 * @param {{ thickness?: number, height?: number|null, bearing?: boolean, exterior?: boolean, virtual?: boolean }} patch
 */
export function patchWall(plan, floorId, wallId, patch) {
  const floor = getFloor(plan, floorId);
  const wall = floor?.walls.find((item) => item.id === wallId);
  if (!wall) return { ok: false, reason: 'missing' };
  if (patch.virtual === true && floor.openings.some((opening) => opening.wall === wallId)) {
    return { ok: false, reason: 'openings' };
  }
  if (patch.thickness != null) wall.thickness = clampThickness(patch.thickness);
  if (patch.height !== undefined) {
    wall.height = patch.height == null || patch.height === '' ? null : Number(patch.height);
  }
  if (patch.exterior != null) wall.exterior = !!patch.exterior;
  if (patch.bearing != null) wall.bearing = !!patch.bearing;
  if (patch.virtual != null) wall.virtual = !!patch.virtual;
  if (wall.virtual) wall.bearing = false;
  return { ok: true, wall };
}

/** @param {object} plan @param {string} floorId @param {string} wallId */
export function demolishWall(plan, floorId, wallId) {
  const floor = getFloor(plan, floorId);
  const wall = floor?.walls.find((item) => item.id === wallId);
  if (!wall) return { ok: false, reason: 'missing' };
  if (wall.bearing) return { ok: false, reason: 'bearing' };
  if (wall.demolished) return { ok: false, reason: 'done' };
  const openings = floor.openings.filter((opening) => opening.wall === wallId);
  wall.demolished = true;
  floor.openings = floor.openings.filter((opening) => opening.wall !== wallId);
  return { ok: true, openings };
}

/** @param {object} plan @param {string} floorId @param {string} roomId @param {object} patch */
export function patchRoom(plan, floorId, roomId, patch) {
  const floor = getFloor(plan, floorId);
  const room = floor?.rooms.find((item) => item.id === roomId);
  if (!room) return { ok: false };
  if (patch.name != null) room.name = String(patch.name);
  if (patch.type != null) {
    room.type = patch.type;
    if (patch.floor == null) room.floor = defaultFloorForType(patch.type);
  }
  if (patch.floor != null) room.floor = patch.floor;
  return { ok: true, room };
}

function clampSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.min(6000, Math.max(50, v));
}

/** @param {object} plan @param {string} floorId @param {object} item */
export function addFurnitureItem(plan, floorId, item) {
  const floor = getFloor(plan, floorId);
  if (!floor) return { ok: false };
  floor.furniture.push({
    ...item,
    w: clampSize(item.w),
    d: clampSize(item.d),
    h: item.h == null ? undefined : clampSize(item.h),
  });
  return { ok: true };
}

/** @param {object} plan @param {string} floorId @param {string} id @param {object} patch */
export function patchFurnitureItem(plan, floorId, id, patch) {
  const floor = getFloor(plan, floorId);
  const item = floor?.furniture.find((entry) => entry.id === id);
  if (!item) return { ok: false };
  if (patch.name != null) item.name = String(patch.name);
  if (patch.color != null) item.color = patch.color;
  if (patch.cx != null) item.cx = patch.cx;
  if (patch.cy != null) item.cy = patch.cy;
  if (patch.z != null) item.z = patch.z;
  if (patch.rot != null) item.rot = patch.rot;
  if (patch.w != null) item.w = clampSize(patch.w);
  if (patch.d != null) item.d = clampSize(patch.d);
  if (patch.h != null) item.h = clampSize(patch.h);
  return { ok: true, item };
}

/** @param {object} plan @param {string} floorId @param {string} id */
export function removeFurnitureItem(plan, floorId, id) {
  const floor = getFloor(plan, floorId);
  if (!floor) return;
  floor.furniture = floor.furniture.filter((item) => item.id !== id);
}

/** @param {object} plan @param {string} floorId @param {string} id */
export function duplicateFurnitureItem(plan, floorId, id) {
  const floor = getFloor(plan, floorId);
  const item = floor?.furniture.find((entry) => entry.id === id);
  if (!item) return null;
  const copy = structuredClone(item);
  copy.id = uniqueId('furn');
  copy.cx += 200;
  copy.cy += 200;
  floor.furniture.push(copy);
  return copy.id;
}

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {object} opening
 * @param {{ check: Function }} deps
 */
export function addOpening(plan, floorId, opening, check) {
  const floor = getFloor(plan, floorId);
  if (!floor) return { ok: false, reason: 'floor' };
  const wall = floor.walls.find((item) => item.id === opening.wall);
  if (!wall || wall.demolished) return { ok: false, reason: 'wall' };
  if (wall.virtual) return { ok: false, code: 'OPENING_ON_VIRTUAL' };
  floor.openings.push(opening);
  const errors = check(plan, floorId, opening.id);
  if (errors.length) {
    floor.openings.pop();
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * @param {object} plan
 * @param {string} floorId
 * @param {string} openingId
 * @param {object} patch
 * @param {(plan: object, floorId: string, openingId: string) => object[]} check
 */
export function updateOpening(plan, floorId, openingId, patch, check) {
  const floor = getFloor(plan, floorId);
  const opening = floor?.openings.find((item) => item.id === openingId);
  if (!opening) return { ok: false, reason: 'missing' };
  const trial = structuredClone(plan);
  const trialFloor = getFloor(trial, floorId);
  const trialOpening = trialFloor.openings.find((item) => item.id === openingId);
  Object.assign(trialOpening, patch);
  const wall = trialFloor.walls.find((item) => item.id === trialOpening.wall);
  if (!wall || wall.virtual || wall.demolished) return { ok: false, code: 'OPENING_ON_VIRTUAL' };
  const errors = check(trial, floorId, openingId);
  if (errors.length) return { ok: false, errors };
  Object.assign(opening, patch);
  return { ok: true };
}

/** @param {object} plan @param {string} floorId @param {string} openingId */
export function deleteOpening(plan, floorId, openingId) {
  const floor = getFloor(plan, floorId);
  if (!floor) return;
  floor.openings = floor.openings.filter((opening) => opening.id !== openingId);
}
