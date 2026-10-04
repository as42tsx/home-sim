/**
 * Exterior dimension chains and the entry-door marker.
 * World units are millimetres, y down. Returns null when the exterior walls
 * do not form one closed loop.
 */

import { openingGeometry } from './opening-geom.js';

const AXIS_EPS = 1.5;

/**
 * @param {object|null|undefined} floor
 * @returns {{top: object, left: object}|null}
 */
export function exteriorDimensions(floor) {
  const edges = exteriorLoop(floor);
  if (!edges) return null;
  const top = chainSide(edges, 'top');
  const left = chainSide(edges, 'left');
  if (!top || !left) return null;
  return { top, left };
}

/**
 * Jambs of the entry door, plus the outward normal (away from the plan).
 * Prefers `ext.role === 'entry'`, otherwise the first door on an exterior wall.
 * @param {object|null|undefined} floor
 * @returns {{jambA:{x:number,y:number}, jambB:{x:number,y:number}, outward:{x:number,y:number}, half:number}|null}
 */
export function entryMarker(floor) {
  if (!floor) return null;
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const walls = floor.walls || [];
  const openings = floor.openings || [];
  let opening = openings.find((item) => item && item.kind === 'door' && item.ext && item.ext.role === 'entry');
  if (!opening) {
    opening = openings.find((item) => {
      if (!item || item.kind !== 'door') return false;
      const host = walls.find((wall) => wall.id === item.wall);
      return !!(host && host.exterior && !host.virtual && !host.demolished);
    });
  }
  if (!opening) return null;
  const wall = walls.find((item) => item.id === opening.wall);
  if (!wall || wall.demolished || wall.virtual) return null;
  const a = nodes.get(wall.a);
  const b = nodes.get(wall.b);
  if (!a || !b) return null;
  const geom = openingGeometry(a, b, opening);
  return {
    jambA: { x: geom.hinge.x, y: geom.hinge.y },
    jambB: { x: geom.jamb.x, y: geom.jamb.y },
    outward: outwardNormal(a, b, floor),
    half: (wall.thickness > 0 ? wall.thickness : 240) / 2,
  };
}

function exteriorLoop(floor) {
  if (!floor) return null;
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const walls = [];
  for (const wall of floor.walls || []) {
    if (!wall || !wall.exterior || wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    walls.push(wall);
  }
  if (walls.length < 3) return null;
  const adj = new Map();
  const link = (from, wall, to) => {
    let list = adj.get(from);
    if (!list) {
      list = [];
      adj.set(from, list);
    }
    list.push({ wall, to });
  };
  for (const wall of walls) {
    link(wall.a, wall, wall.b);
    link(wall.b, wall, wall.a);
  }
  for (const list of adj.values()) {
    if (list.length !== 2) return null;
  }
  const seen = new Set();
  const edges = [];
  let wall = walls[0];
  let from = wall.a;
  const startId = wall.a;
  while (wall && !seen.has(wall.id)) {
    seen.add(wall.id);
    const to = wall.a === from ? wall.b : wall.a;
    const a = nodes.get(from);
    const b = nodes.get(to);
    edges.push({
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      thickness: wall.thickness > 0 ? wall.thickness : 240,
    });
    const next = (adj.get(to) || []).find((item) => item.wall.id !== wall.id);
    from = to;
    wall = next ? next.wall : null;
  }
  if (seen.size !== walls.length || from !== startId) return null;
  return edges;
}

function chainSide(edges, side) {
  const horizontal = side === 'top';
  const pool = edges.filter((edge) => {
    const dx = Math.abs(edge.a.x - edge.b.x);
    const dy = Math.abs(edge.a.y - edge.b.y);
    return horizontal ? dy <= AXIS_EPS && dx > 1 : dx <= AXIS_EPS && dy > 1;
  });
  if (!pool.length) return null;
  const extreme = horizontal
    ? Math.min(...pool.map((edge) => (edge.a.y + edge.b.y) / 2))
    : Math.min(...pool.map((edge) => (edge.a.x + edge.b.x) / 2));
  const chosen = pool.filter((edge) => {
    const value = horizontal ? (edge.a.y + edge.b.y) / 2 : (edge.a.x + edge.b.x) / 2;
    return Math.abs(value - extreme) <= AXIS_EPS;
  });
  if (!chosen.length) return null;
  const keyOf = (point) => (horizontal ? point.x : point.y);
  const points = new Map();
  for (const edge of chosen) {
    const half = edge.thickness / 2;
    for (const point of [edge.a, edge.b]) {
      const key = Math.round(keyOf(point));
      const prev = points.get(key);
      if (!prev) points.set(key, { x: point.x, y: point.y, half });
      else prev.half = Math.max(prev.half, half);
    }
  }
  const ordered = [...points.values()].sort((p, q) => keyOf(p) - keyOf(q));
  if (ordered.length < 2) return null;
  const lengths = [];
  for (let i = 1; i < ordered.length; i += 1) {
    lengths.push(Math.hypot(ordered[i].x - ordered[i - 1].x, ordered[i].y - ordered[i - 1].y));
  }
  const overall = lengths.reduce((sum, length) => sum + length, 0);
  const outward = horizontal ? { x: 0, y: -1 } : { x: -1, y: 0 };
  return { outward, points: ordered, lengths, overall };
}

function outwardNormal(a, b, floor) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const left = { x: -dy / len, y: dx / len };
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const node of floor.nodes || []) {
    cx += node.x;
    cy += node.y;
    count += 1;
  }
  if (!count) return left;
  cx /= count;
  cy /= count;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const toward = left.x * (cx - midX) + left.y * (cy - midY);
  return toward > 0 ? { x: -left.x, y: -left.y } : left;
}
