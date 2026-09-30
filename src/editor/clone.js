/**
 * Plan cloning and id remapping. Pure: no DOM, no storage.
 */

import { uniqueId } from '../model/ids.js';

/** @param {*} value */
export function cloneData(value) {
  return structuredClone(value);
}

/**
 * Deep copy with new ids for the plan and every entity.
 * References (wall endpoints, openings, stairs, walk start) follow the map.
 * `meta.template` is kept unless `opts.template` is passed (including null).
 * @param {object} plan
 * @param {{ name?: string, now?: number, planId?: string, template?: string|null, ids?: (prefix: string) => string }} [opts]
 */
export function clonePlanFresh(plan, opts = {}) {
  const next = structuredClone(plan);
  const gen = opts.ids || ((prefix) => uniqueId(prefix));
  /** @type {Map<string, string>} */
  const map = new Map();
  const take = (old, prefix) => {
    if (old == null) return old;
    const key = String(old);
    if (!map.has(key)) map.set(key, gen(prefix));
    return map.get(key);
  };

  const now = opts.now ?? Date.now();
  next.meta = {
    ...next.meta,
    id: opts.planId || gen('plan'),
    name: opts.name ?? next.meta.name,
    createdAt: now,
    updatedAt: now,
    template: Object.prototype.hasOwnProperty.call(opts, 'template') ? opts.template : next.meta.template,
  };

  for (const floor of next.floors || []) {
    floor.id = take(floor.id, 'f');
    for (const node of floor.nodes || []) node.id = take(node.id, 'n');
    for (const wall of floor.walls || []) {
      wall.id = take(wall.id, 'w');
      wall.a = map.get(String(wall.a)) || wall.a;
      wall.b = map.get(String(wall.b)) || wall.b;
    }
    for (const opening of floor.openings || []) {
      opening.id = take(opening.id, 'o');
      opening.wall = map.get(String(opening.wall)) || opening.wall;
    }
    for (const room of floor.rooms || []) room.id = take(room.id, 'r');
    for (const item of floor.furniture || []) {
      item.id = take(item.id, 'furn');
      if (item.host?.wall) item.host.wall = map.get(String(item.host.wall)) || item.host.wall;
    }
    for (const hole of floor.voids || []) hole.id = take(hole.id, 'v');
  }
  for (const stair of next.stairs || []) {
    stair.id = take(stair.id, 's');
    if (map.has(String(stair.from))) stair.from = map.get(String(stair.from));
    if (map.has(String(stair.to))) stair.to = map.get(String(stair.to));
  }
  const walk = next.markers?.walkStart;
  if (walk && map.has(String(walk.floor))) walk.floor = map.get(String(walk.floor));
  return next;
}
