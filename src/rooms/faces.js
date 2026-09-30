/**
 * Bounded faces of a planar wall graph.
 *
 * Coordinate convention: x right, y down. The shoelace sum is positive for a
 * clockwise ring, and that is the ring we keep for a room (interior on the
 * right of every edge).
 *
 * Half-edge step: at the vertex just entered, outgoing edges are sorted by
 * atan2 (increasing angle is clockwise on screen). The walk leaves along the
 * edge immediately before the reverse edge in that order. On a rectangle this
 * is the only other edge; at a T or a cross it is the sharpest right turn,
 * which traces the smallest clockwise face.
 *
 * Dangling chains (degree-1 endpoints) are recorded first, then pruned, so a
 * stub inside a room does not split the room and an open U produces no face.
 * The unbounded walk of each connected component has negative area and is
 * dropped.
 *
 * A component whose footprint lies inside another component's face becomes a
 * hole of that face (its outer ring is subtracted). The inner component still
 * contributes its own rooms. This is the courtyard / nested-loop case; it must
 * not throw.
 */

import { dist } from '../geometry/vec.js';
import { bboxOf, centroid, offsetInward, pointInPolygon, ringArea, signedArea, stripCollinear } from '../geometry/polygon.js';

/**
 * @param {{id:string,x:number,y:number}[]} nodes
 * @param {object[]} walls normalized walls (id, a, b, thickness, virtual)
 * @returns {{ faces: object[], unclosed: { endpoints: object[], chains: object[], gap: number|null } }}
 */
export function findFaces(nodes, walls) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  /** @type {Map<string, {to:string, wallId:string, angle:number}[]>} */
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const w of walls) {
    const a = nodeById.get(w.a);
    const b = nodeById.get(w.b);
    if (!a || !b || w.a === w.b) continue;
    adj.get(w.a).push({ to: w.b, wallId: w.id, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    adj.get(w.b).push({ to: w.a, wallId: w.id, angle: Math.atan2(a.y - b.y, a.x - b.x) });
  }
  for (const outs of adj.values()) {
    outs.sort((p, q) => p.angle - q.angle || (p.wallId < q.wallId ? -1 : p.wallId > q.wallId ? 1 : 0));
  }

  const active = new Set(walls.map((w) => w.id));
  const unclosed = collectUnclosed(adj, active, nodeById);
  pruneFilaments(adj, active);

  const wallById = new Map(walls.map((w) => [w.id, w]));
  const rawFaces = traceFaces(adj, active, nodeById);
  const compOfNode = components(adj, active);
  const faces = assembleFaces(rawFaces, compOfNode, nodeById, wallById);
  faces.sort(compareFaces);
  faces.forEach((face, i) => {
    face.faceId = `face${i + 1}`;
  });
  return { faces, unclosed };
}

function degree(adj, active, id) {
  const outs = adj.get(id);
  if (!outs) return 0;
  return outs.reduce((n, o) => n + (active.has(o.wallId) ? 1 : 0), 0);
}

function collectUnclosed(adj, active, nodeById) {
  const deg = new Map();
  for (const id of adj.keys()) deg.set(id, degree(adj, active, id));
  const endpoints = [];
  for (const [id, d] of deg) {
    if (d === 1) {
      const n = nodeById.get(id);
      endpoints.push({ id, x: n.x, y: n.y });
    }
  }
  const visited = new Set();
  const chains = [];
  for (const ep of endpoints) {
    const first = (adj.get(ep.id) || []).find((o) => active.has(o.wallId));
    if (!first || visited.has(first.wallId)) continue;
    const nodeIds = [ep.id];
    let prev = ep.id;
    let curEdge = first;
    while (curEdge && !visited.has(curEdge.wallId)) {
      visited.add(curEdge.wallId);
      const next = curEdge.to;
      nodeIds.push(next);
      if (deg.get(next) !== 2) break;
      const outs = (adj.get(next) || []).filter((o) => active.has(o.wallId) && o.to !== prev);
      prev = next;
      curEdge = outs[0];
    }
    const a = nodeById.get(nodeIds[0]);
    const b = nodeById.get(nodeIds[nodeIds.length - 1]);
    const ends = [];
    if (deg.get(a.id) === 1) ends.push({ id: a.id, x: a.x, y: a.y });
    if (b.id !== a.id && deg.get(b.id) === 1) ends.push({ id: b.id, x: b.x, y: b.y });
    let gap = null;
    if (ends.length >= 2) gap = dist(ends[0], ends[1]);
    chains.push({ nodeIds, endpoints: ends, gap });
  }
  let nearest = null;
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const d = dist(endpoints[i], endpoints[j]);
      if (nearest == null || d < nearest) nearest = d;
    }
  }
  return { endpoints, chains, gap: nearest };
}

function pruneFilaments(adj, active) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of adj.keys()) {
      const live = (adj.get(id) || []).filter((o) => active.has(o.wallId));
      if (live.length === 1) {
        active.delete(live[0].wallId);
        changed = true;
      }
    }
  }
}

function traceFaces(adj, active, nodeById) {
  const used = new Set();
  const faces = [];
  const directed = [];
  for (const [from, outs] of adj) {
    for (const o of outs) {
      if (active.has(o.wallId)) directed.push({ from, to: o.to, wallId: o.wallId });
    }
  }
  for (const start of directed) {
    const startKey = `${start.wallId}@${start.from}>${start.to}`;
    if (used.has(startKey)) continue;
    const ring = [];
    const wallIds = [];
    let cur = start;
    let guard = 0;
    const limit = directed.length + 2;
    let closed = false;
    do {
      const key = `${cur.wallId}@${cur.from}>${cur.to}`;
      if (used.has(key)) break;
      used.add(key);
      const fromNode = nodeById.get(cur.from);
      ring.push({ x: fromNode.x, y: fromNode.y });
      wallIds.push(cur.wallId);
      const outs = (adj.get(cur.to) || []).filter((o) => active.has(o.wallId));
      const rev = outs.findIndex((o) => o.wallId === cur.wallId && o.to === cur.from);
      if (rev < 0 || outs.length === 0) break;
      const next = outs[(rev - 1 + outs.length) % outs.length];
      cur = { from: cur.to, to: next.to, wallId: next.wallId };
      guard += 1;
      if (`${cur.wallId}@${cur.from}>${cur.to}` === startKey) {
        closed = true;
        break;
      }
    } while (guard < limit);
    if (!closed || ring.length < 3) continue;
    const area = signedArea(ring);
    if (Math.abs(area) < 1e-3) continue;
    faces.push({ ring, wallIds, area, startNode: start.from });
  }
  return faces;
}

function components(adj, active) {
  const parent = new Map();
  function find(id) {
    if (!parent.has(id)) parent.set(id, id);
    let p = id;
    while (parent.get(p) !== p) p = parent.get(p);
    let c = id;
    while (parent.get(c) !== p) {
      const n = parent.get(c);
      parent.set(c, p);
      c = n;
    }
    return p;
  }
  function unite(a, b) {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  }
  for (const [from, outs] of adj) {
    for (const o of outs) {
      if (!active.has(o.wallId)) continue;
      unite(from, o.to);
    }
  }
  const out = new Map();
  for (const id of adj.keys()) {
    if (degree(adj, active, id) > 0) out.set(id, find(id));
  }
  return out;
}

function reversedLoop(ring, wallIds) {
  const n = ring.length;
  const revRing = [...ring].reverse();
  const revWalls = [];
  for (let i = 0; i < n; i += 1) {
    const oldIndex = i === n - 1 ? n - 1 : n - 2 - i;
    revWalls.push(wallIds[oldIndex]);
  }
  return { ring: revRing, wallIds: revWalls };
}

function edgeDistances(wallIds, wallById) {
  return wallIds.map((id) => {
    const w = wallById.get(id);
    if (!w || w.virtual) return 0;
    return (Number(w.thickness) || 0) / 2;
  });
}

function assembleFaces(rawFaces, compOfNode, nodeById, wallById) {
  const bounded = rawFaces.filter((f) => f.area > 0);
  const unbounded = rawFaces.filter((f) => f.area < 0);
  const compOfFace = (face) => compOfNode.get(face.startNode) ?? compOfNode.get(face.ring && '') ?? null;
  const compKey = (face) => {
    const id = compOfNode.get(face.startNode);
    return id ?? face.startNode;
  };

  /** @type {Map<string, {bounded: object[], unbounded: object[]}>} */
  const groups = new Map();
  for (const face of bounded) {
    const key = compKey(face);
    if (!groups.has(key)) groups.set(key, { bounded: [], unbounded: [] });
    groups.get(key).bounded.push(face);
  }
  for (const face of unbounded) {
    const key = compKey(face);
    if (!groups.has(key)) groups.set(key, { bounded: [], unbounded: [] });
    groups.get(key).unbounded.push(face);
  }

  // Footprint of each component: clockwise outer ring + the wall id of each edge.
  const footprint = new Map();
  for (const [key, group] of groups) {
    if (group.unbounded.length) {
      const outer = group.unbounded.reduce((a, b) => (Math.abs(a.area) > Math.abs(b.area) ? a : b));
      footprint.set(key, reversedLoop(outer.ring, outer.wallIds));
    } else if (group.bounded.length === 1) {
      footprint.set(key, { ring: group.bounded[0].ring, wallIds: group.bounded[0].wallIds });
    }
  }

  /** @type {Map<string, {ring:{x:number,y:number}[], wallIds:string[]}[]>} */
  const holesOf = new Map();
  for (const face of bounded) holesOf.set(face, []);

  const keys = [...groups.keys()];
  for (const innerKey of keys) {
    const fp = footprint.get(innerKey);
    if (!fp) continue;
    const sample = centroid(fp.ring);
    for (const outerFace of bounded) {
      if (compKey(outerFace) === innerKey) continue;
      if (!pointInPolygon(sample, outerFace.ring)) continue;
      const inside = fp.ring.every((p) => pointInPolygon(p, outerFace.ring) || onRing(p, outerFace.ring));
      if (!inside) continue;
      holesOf.get(outerFace).push(fp);
      break;
    }
  }

  const faces = [];
  for (const face of bounded) {
    const holes = holesOf.get(face) || [];
    const centerline = face.ring.map((p) => ({ x: p.x, y: p.y }));
    const holeRings = holes.map((h) => h.ring.map((p) => ({ x: p.x, y: p.y })));
    let centerlineArea = Math.abs(face.area);
    for (const h of holeRings) centerlineArea -= ringArea(h);

    const outerDist = edgeDistances(face.wallIds, wallById);
    const polygon = offsetInward(centerline, outerDist);
    const holePolygons = holes.map((h) => {
      const dists = edgeDistances(h.wallIds, wallById).map((d) => -d);
      return offsetInward(h.ring, dists);
    });
    let area = ringArea(polygon);
    for (const h of holePolygons) area -= ringArea(h);
    if (area < 0) area = 0;

    const c = centroid(centerline);
    faces.push({
      centerline: stripCollinear(centerline).length >= 3 ? stripCollinear(centerline) : centerline,
      holes: holeRings,
      polygon,
      holePolygons,
      area,
      areaM2: area / 1e6,
      centerlineArea,
      centerlineAreaM2: centerlineArea / 1e6,
      centroid: { x: c.x, y: c.y },
      wallIds: [...new Set(face.wallIds)],
      bbox: bboxOf(centerline),
    });
  }
  return faces;
}

function onRing(p, ring) {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-9) continue;
    const t = (apx * abx + apy * aby) / ab2;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const dx = a.x + abx * t - p.x;
    const dy = a.y + aby * t - p.y;
    if (dx * dx + dy * dy <= 1e-4) return true;
  }
  return false;
}

function compareFaces(a, b) {
  if (a.centroid.y !== b.centroid.y) return a.centroid.y - b.centroid.y;
  if (a.centroid.x !== b.centroid.x) return a.centroid.x - b.centroid.x;
  return b.centerlineArea - a.centerlineArea;
}
