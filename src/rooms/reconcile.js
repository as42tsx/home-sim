/**
 * Match stored room attributes to freshly found faces.
 *
 * Seed points win: a stored room whose seed lies in a face keeps that face.
 * When several seeds land in one face (the shared wall was removed and the
 * rooms merged), the predecessor with the larger previous area keeps its
 * id, name, type and floor material. Pass that area via `opts.previousDerived`
 * (the `derived` array from the last call) or via a temporary `room.area`.
 *
 * A face with no seed is matched by centreline overlap against an unused
 * previous polygon when the overlap is at least half the smaller area.
 * Anything still unmatched is a new room named 「房间 N」 with the next
 * unused N. Rooms whose seed and polygon both miss every face are dropped.
 * The returned seed is a point strictly inside the face.
 */

import { intersection, multiPolygonArea } from '../geometry/boolean.js';
import { interiorPointOfRing, pointInFace } from '../geometry/polygon.js';
import { createIdGenerator } from '../model/ids.js';

/**
 * @param {object[]} prevRooms
 * @param {object[]} faces sorted faces from {@link findFaces}
 * @param {{ idGenerator?: () => string, previousDerived?: object[] }} [opts]
 */
export function reconcileRooms(prevRooms, faces, opts = {}) {
  const idGen = opts.idGenerator ?? createIdGenerator('r');
  const prevList = Array.isArray(prevRooms) ? prevRooms : [];
  const areas = new Map();
  if (Array.isArray(opts.previousDerived)) {
    for (const derived of opts.previousDerived) {
      if (derived && derived.roomId != null) {
        areas.set(derived.roomId, derived.centerlineArea ?? derived.area ?? 0);
      }
    }
  }
  for (const room of prevList) {
    if (room && typeof room.area === 'number' && !areas.has(room.id)) {
      areas.set(room.id, room.area);
    }
  }

  const used = new Set();
  /** @type {Map<number, object|null>} */
  const assigned = new Map();
  const seedHits = prevList.map((room) => ({
    room,
    hits: room?.seed ? faces.filter((face) => pointInFace(room.seed, face)) : [],
  }));

  faces.forEach((face, index) => {
    const contenders = seedHits.filter((hit) => hit.hits.includes(face) && !used.has(hit.room.id));
    if (contenders.length === 0) {
      assigned.set(index, null);
      return;
    }
    contenders.sort((a, b) => {
      const byArea = (areas.get(b.room.id) ?? 0) - (areas.get(a.room.id) ?? 0);
      if (byArea !== 0) return byArea;
      if (a.room.id < b.room.id) return -1;
      if (a.room.id > b.room.id) return 1;
      return 0;
    });
    assigned.set(index, contenders[0].room);
    for (const hit of contenders) used.add(hit.room.id);
  });

  if (Array.isArray(opts.previousDerived)) {
    faces.forEach((face, index) => {
      if (assigned.get(index)) return;
      let best = null;
      let bestOverlap = 0;
      for (const derived of opts.previousDerived) {
        if (!derived?.roomId || used.has(derived.roomId) || !derived.centerline) continue;
        const room = prevList.find((item) => item.id === derived.roomId);
        if (!room) continue;
        const overlap = overlapArea(derived.centerline, face.centerline);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = { room, prevArea: derived.centerlineArea ?? overlap };
        }
      }
      if (!best) return;
      const smaller = Math.min(best.prevArea, face.centerlineArea);
      if (smaller > 0 && bestOverlap >= 0.5 * smaller) {
        assigned.set(index, best.room);
        used.add(best.room.id);
      }
    });
  }

  const usedNames = new Set();
  for (const room of assigned.values()) {
    if (room?.name) usedNames.add(room.name);
  }

  const rooms = [];
  const derived = [];
  faces.forEach((face, index) => {
    const chosen = assigned.get(index);
    const seed = roundPoint(interiorPointOfRing(face.centerline, face.holes || []));
    let room;
    if (chosen) {
      room = {
        id: chosen.id,
        name: chosen.name,
        type: chosen.type,
        floor: chosen.floor,
        floorOffset: chosen.floorOffset ?? 0,
        seed,
      };
      if (chosen.ext) room.ext = { ...chosen.ext };
    } else {
      const name = nextRoomName(usedNames);
      usedNames.add(name);
      room = {
        id: idGen(),
        name,
        type: 'other',
        floor: 'wood',
        floorOffset: 0,
        seed,
      };
    }
    rooms.push(room);
    derived.push({ ...face, roomId: room.id, name: room.name });
  });
  return { rooms, derived };
}

function nextRoomName(usedNames) {
  let n = 1;
  while (usedNames.has(`房间 ${n}`)) n += 1;
  return `房间 ${n}`;
}

function roundPoint(p) {
  return {
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
  };
}

function overlapArea(ringA, ringB) {
  const hit = intersection(ringA, ringB);
  return multiPolygonArea(hit);
}
