/**
 * Turn one floor's wall list into a clean planar graph for face finding.
 * The input floor is never mutated.
 *
 * Order of operations:
 * 1. Demolished walls are left out of the graph (they still exist on the plan).
 * 2. Nodes closer than `tolerance` weld together. The earliest node (y, then x,
 *    then id) keeps its coordinates, so the result does not depend on input order.
 * 3. Zero-length walls and walls shorter than `minWallLen` are dropped.
 * 4. Proper crossings split both walls and share one node. A node that lands
 *    within tolerance of another wall's interior splits that wall (T-junction)
 *    and the stem endpoint moves onto the host so the host stays straight.
 * 5. Near-collinear overlaps (perpendicular distance within tolerance, overlap
 *    longer than tolerance) are subdivided at each other's endpoints and the
 *    duplicate pieces are removed. Walls that only meet end to end stay split,
 *    because a third wall may connect at that node.
 * 6. Each opening is moved onto the piece that contains its original centre.
 *    `t` is recomputed along that piece. `map[originalWallId]` lists the
 *    surviving piece ids (empty when the wall was demolished or dropped).
 *
 * Virtual walls stay in the graph. Offset later treats them as zero thickness.
 */

import { GEOM_TOLERANCE_MM, MIN_WALL_LEN_MM } from '../model/constants.js';
import { dist, lerp, unit } from '../geometry/vec.js';
import { lineDistance, lineParam, pointOnSegment, projectParam, segmentIntersection } from '../geometry/segment.js';

/**
 * @param {object} floor
 * @param {{ tolerance?: number, minWallLen?: number }} [opts]
 * @returns {{ nodes: object[], walls: object[], openings: object[], map: Record<string, string[]> }}
 */
export function normalizeFloor(floor, opts = {}) {
  const tol = opts.tolerance ?? GEOM_TOLERANCE_MM;
  const minLen = opts.minWallLen ?? MIN_WALL_LEN_MM;

  const origNodes = new Map((floor.nodes || []).map((n) => [n.id, { x: n.x, y: n.y }]));
  const origWalls = new Map((floor.walls || []).map((w) => [w.id, w]));

  /** @type {Map<string, {id:string, x:number, y:number}>} */
  const nodes = new Map();
  for (const n of floor.nodes || []) nodes.set(n.id, { id: n.id, x: n.x, y: n.y });

  /** @type {Array<{id:string, a:string, b:string, sourceIds:string[], attrs:object}>} */
  let walls = [];
  for (const w of floor.walls || []) {
    if (w.demolished) continue;
    if (!nodes.has(w.a) || !nodes.has(w.b)) continue;
    walls.push(makeWall(w.id, w.a, w.b, [w.id], w));
  }

  weldNodes(nodes, walls, tol);
  walls = dropShort(walls, nodes, minLen);

  const freshId = createIdFactory();

  // Crossings and T-junctions. A few passes pick up junctions created by snaps.
  for (let pass = 0; pass < 5; pass += 1) {
    walls.sort(compareWalls);
    const splits = collectSplits(walls, nodes, tol);
    if (splits.size === 0) break;
    walls = applySplits(walls, nodes, splits, tol, freshId);
    weldNodes(nodes, walls, tol);
    walls = dropShort(walls, nodes, minLen);
  }

  walls = collapseCollinear(walls, nodes, tol, minLen, freshId);
  weldNodes(nodes, walls, tol);
  walls = dropShort(walls, nodes, minLen);
  walls = dedupeEdges(walls);

  const openings = remapOpenings(floor.openings || [], origWalls, origNodes, walls, nodes, tol);
  const used = new Set();
  for (const w of walls) {
    used.add(w.a);
    used.add(w.b);
  }
  const nodeList = [...nodes.values()]
    .filter((n) => used.has(n.id))
    .sort(compareNodes)
    .map((n) => ({ id: n.id, x: n.x, y: n.y }));

  const wallList = walls
    .map((w) => ({
      ...w.attrs,
      id: w.id,
      a: w.a,
      b: w.b,
      sourceIds: [...w.sourceIds],
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /** @type {Record<string, string[]>} */
  const map = {};
  for (const w of floor.walls || []) map[w.id] = [];
  for (const w of wallList) {
    for (const src of w.sourceIds) {
      if (!map[src]) map[src] = [];
      map[src].push(w.id);
    }
  }

  return { nodes: nodeList, walls: wallList, openings, map };
}

function compareNodes(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function compareWalls(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function createIdFactory() {
  let n = 0;
  return function freshId(existing) {
    n += 1;
    let id = `j${n}`;
    while (existing.has(id)) {
      n += 1;
      id = `j${n}`;
    }
    return id;
  };
}

function copyAttrs(wall) {
  return {
    thickness: wall.thickness,
    height: wall.height ?? null,
    bearing: !!wall.bearing,
    exterior: !!wall.exterior,
    demolished: false,
    virtual: !!wall.virtual,
    finish: wall.finish ? { left: wall.finish.left, right: wall.finish.right } : { left: '', right: '' },
    ...(wall.ext ? { ext: { ...wall.ext } } : {}),
  };
}

function makeWall(id, a, b, sourceIds, attrsFrom) {
  return {
    id,
    a,
    b,
    sourceIds: [...sourceIds],
    attrs: copyAttrs(attrsFrom),
  };
}

function nodeOf(nodes, id) {
  return nodes.get(id);
}

function wallLength(wall, nodes) {
  const a = nodeOf(nodes, wall.a);
  const b = nodeOf(nodes, wall.b);
  if (!a || !b) return 0;
  return dist(a, b);
}

/**
 * Union nodes within `tol` of an existing representative. Representatives are
 * chosen in sorted order so a chain cannot collapse further than `tol` from
 * the representative that was created first.
 */
function weldNodes(nodes, walls, tol) {
  const list = [...nodes.values()].sort(compareNodes);
  const parent = new Map();
  const reps = [];
  for (const n of list) {
    let host = null;
    for (const r of reps) {
      if (dist(r, n) <= tol) {
        host = r;
        break;
      }
    }
    if (host) parent.set(n.id, host.id);
    else {
      parent.set(n.id, n.id);
      reps.push(n);
    }
  }
  for (const n of list) {
    if (parent.get(n.id) !== n.id) nodes.delete(n.id);
  }
  for (const w of walls) {
    w.a = parent.get(w.a) ?? w.a;
    w.b = parent.get(w.b) ?? w.b;
  }
}

function dropShort(walls, nodes, minLen) {
  return walls.filter((w) => w.a !== w.b && wallLength(w, nodes) >= minLen);
}

function isInteriorParam(t, length, tol) {
  const along = t * length;
  return along > tol && length - along > tol;
}

/**
 * @returns {Map<string, {t:number, x:number, y:number, reuseId:string|null}[]>}
 */
function collectSplits(walls, nodes, tol) {
  /** @type {Map<string, {t:number, x:number, y:number, reuseId:string|null}[]>} */
  const splits = new Map();
  const add = (wall, t, point, reuseId) => {
    const length = wallLength(wall, nodes);
    if (!isInteriorParam(t, length, tol)) return;
    if (!splits.has(wall.id)) splits.set(wall.id, []);
    const list = splits.get(wall.id);
    for (const s of list) {
      if (Math.abs(s.t - t) * length <= tol) {
        if (!s.reuseId && reuseId) s.reuseId = reuseId;
        return;
      }
    }
    list.push({ t, x: point.x, y: point.y, reuseId: reuseId ?? null });
  };

  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const wi = walls[i];
      const wj = walls[j];
      const ai = nodeOf(nodes, wi.a);
      const bi = nodeOf(nodes, wi.b);
      const aj = nodeOf(nodes, wj.a);
      const bj = nodeOf(nodes, wj.b);
      if (!ai || !bi || !aj || !bj) continue;
      const hit = segmentIntersection(ai, bi, aj, bj, tol);
      if (!hit) continue;
      add(wi, hit.t, hit.point, null);
      add(wj, hit.u, hit.point, null);
    }
  }

  for (const n of nodes.values()) {
    for (const w of walls) {
      if (w.a === n.id || w.b === n.id) continue;
      const a = nodeOf(nodes, w.a);
      const b = nodeOf(nodes, w.b);
      if (!a || !b) continue;
      const tRaw = projectParam(n, a, b);
      const length = dist(a, b);
      if (!isInteriorParam(tRaw, length, tol)) continue;
      const proj = pointOnSegment(n, a, b);
      if (proj.distance > tol) continue;
      const point = {
        x: a.x + (b.x - a.x) * tRaw,
        y: a.y + (b.y - a.y) * tRaw,
      };
      n.x = point.x;
      n.y = point.y;
      add(w, tRaw, point, n.id);
    }
  }
  return splits;
}

function applySplits(walls, nodes, splits, tol, freshId) {
  const out = [];
  const taken = new Set(nodes.keys());
  for (const w of walls) taken.add(w.id);
  for (const w of walls) {
    const cuts = splits.get(w.id);
    if (!cuts || cuts.length === 0) {
      out.push(w);
      continue;
    }
    const a = nodeOf(nodes, w.a);
    const b = nodeOf(nodes, w.b);
    const length = dist(a, b);
    cuts.sort((p, q) => p.t - q.t);
    const mids = [];
    for (const cut of cuts) {
      let id = cut.reuseId;
      if (id && nodes.has(id)) {
        const n = nodes.get(id);
        n.x = cut.x;
        n.y = cut.y;
      } else {
        id = freshId(taken);
        taken.add(id);
        nodes.set(id, { id, x: cut.x, y: cut.y });
      }
      // Skip a cut that welded onto an endpoint.
      if (dist(nodes.get(id), a) <= tol || dist(nodes.get(id), b) <= tol) continue;
      if (mids.some((m) => m.id === id || Math.abs(m.t - cut.t) * length <= tol)) continue;
      mids.push({ id, t: cut.t });
    }
    if (mids.length === 0) {
      out.push(w);
      continue;
    }
    const chain = [w.a, ...mids.map((m) => m.id), w.b];
    const count = chain.length - 1;
    for (let i = 0; i < count; i += 1) {
      const id = count === 1 ? w.id : uniquePieceId(w.id, i + 1, taken);
      taken.add(id);
      out.push(makeWall(id, chain[i], chain[i + 1], w.sourceIds, w.attrs));
    }
  }
  return out;
}

function uniquePieceId(base, index, taken) {
  let id = `${base}_${index}`;
  let n = index;
  while (taken.has(id)) {
    n += 1;
    id = `${base}_${n}`;
  }
  return id;
}

function segmentLine(wall, nodes) {
  const a = nodeOf(nodes, wall.a);
  const b = nodeOf(nodes, wall.b);
  const dir = unit({ x: b.x - a.x, y: b.y - a.y });
  return { a, b, dir };
}

function nearCollinearOverlap(w1, w2, nodes, tol) {
  const s1 = segmentLine(w1, nodes);
  const s2 = segmentLine(w2, nodes);
  if (s1.dir.x === 0 && s1.dir.y === 0) return false;
  if (s2.dir.x === 0 && s2.dir.y === 0) return false;
  const ends2 = [nodeOf(nodes, w2.a), nodeOf(nodes, w2.b)];
  const ends1 = [nodeOf(nodes, w1.a), nodeOf(nodes, w1.b)];
  if (ends2.some((p) => lineDistance(p, s1.a, s1.dir) > tol)) return false;
  if (ends1.some((p) => lineDistance(p, s1.a, s1.dir) > tol)) return false;
  const proj = (p) => lineParam(p, s1.a, s1.dir);
  const i1 = [proj(ends1[0]), proj(ends1[1])].sort((a, b) => a - b);
  const i2 = [proj(ends2[0]), proj(ends2[1])].sort((a, b) => a - b);
  const overlap = Math.min(i1[1], i2[1]) - Math.max(i1[0], i2[0]);
  return overlap > tol;
}

function collapseCollinear(walls, nodes, tol, minLen, freshId) {
  let current = walls;
  for (let pass = 0; pass < 4; pass += 1) {
    const splits = new Map();
    const addCut = (wall, t, point) => {
      const length = wallLength(wall, nodes);
      if (!isInteriorParam(t, length, tol)) return;
      if (!splits.has(wall.id)) splits.set(wall.id, []);
      const list = splits.get(wall.id);
      if (list.some((s) => Math.abs(s.t - t) * length <= tol)) return;
      list.push({ t, x: point.x, y: point.y, reuseId: null });
    };
    let found = false;
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        const wi = current[i];
        const wj = current[j];
        if (!nearCollinearOverlap(wi, wj, nodes, tol)) continue;
        found = true;
        const line = segmentLine(wi, nodes);
        for (const id of [wj.a, wj.b]) {
          const p = nodeOf(nodes, id);
          const t = projectParam(p, line.a, line.b);
          const point = {
            x: line.a.x + (line.b.x - line.a.x) * t,
            y: line.a.y + (line.b.y - line.a.y) * t,
          };
          // Snap the duplicate's endpoint onto the host line.
          if (dist(p, point) <= tol) {
            p.x = point.x;
            p.y = point.y;
          }
          addCut(wi, t, point);
        }
        const lineJ = segmentLine(wj, nodes);
        for (const id of [wi.a, wi.b]) {
          const p = nodeOf(nodes, id);
          const t = projectParam(p, lineJ.a, lineJ.b);
          const point = {
            x: lineJ.a.x + (lineJ.b.x - lineJ.a.x) * t,
            y: lineJ.a.y + (lineJ.b.y - lineJ.a.y) * t,
          };
          addCut(wj, t, point);
        }
      }
    }
    if (found) {
      current = applySplits(current, nodes, splits, tol, freshId);
      weldNodes(nodes, current, tol);
      current = dropShort(current, nodes, minLen);
    }
    const before = current.length;
    current = dedupeEdges(current);
    if (!found && current.length === before) break;
  }
  return current;
}

function edgeKey(wall) {
  return wall.a < wall.b ? `${wall.a}|${wall.b}` : `${wall.b}|${wall.a}`;
}

function mergeAttrs(list) {
  const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const anyReal = sorted.some((w) => !w.attrs.virtual);
  const donor = sorted.find((w) => !w.attrs.virtual) || sorted[0];
  const thickness = anyReal
    ? Math.max(...sorted.filter((w) => !w.attrs.virtual).map((w) => w.attrs.thickness))
    : donor.attrs.thickness;
  return {
    thickness,
    height: donor.attrs.height,
    bearing: sorted.some((w) => w.attrs.bearing),
    exterior: sorted.some((w) => w.attrs.exterior),
    demolished: false,
    virtual: !anyReal && sorted.every((w) => w.attrs.virtual),
    finish: { left: donor.attrs.finish.left, right: donor.attrs.finish.right },
    ...(donor.attrs.ext ? { ext: { ...donor.attrs.ext } } : {}),
  };
}

function dedupeEdges(walls) {
  const groups = new Map();
  for (const w of walls) {
    if (w.a === w.b) continue;
    const key = edgeKey(w);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const out = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
    const sources = [];
    for (const w of sorted) {
      for (const src of w.sourceIds) if (!sources.includes(src)) sources.push(src);
    }
    out.push({
      id: sorted[0].id,
      a: sorted[0].a,
      b: sorted[0].b,
      sourceIds: sources,
      attrs: mergeAttrs(sorted),
    });
  }
  return out;
}

function remapOpenings(openings, origWalls, origNodes, walls, nodes, tol) {
  const out = [];
  for (const op of openings) {
    const orig = origWalls.get(op.wall);
    if (!orig || orig.demolished) continue;
    const a0 = origNodes.get(orig.a);
    const b0 = origNodes.get(orig.b);
    if (!a0 || !b0) continue;
    const centre = lerp(a0, b0, op.t);
    let best = null;
    for (const w of walls) {
      if (!w.sourceIds.includes(orig.id) && w.id !== orig.id) continue;
      const a = nodeOf(nodes, w.a);
      const b = nodeOf(nodes, w.b);
      if (!a || !b) continue;
      const proj = pointOnSegment(centre, a, b);
      const slack = tol + 1;
      if (proj.distance > slack) continue;
      const score = proj.distance + (w.sourceIds.includes(orig.id) ? 0 : 1000);
      if (!best || score < best.score) {
        best = { wall: w, t: projectParam(centre, a, b), score };
      }
    }
    if (!best) {
      // Fall back to any segment that contains the centre (the original piece
      // may have been merged into a neighbour's id).
      for (const w of walls) {
        const a = nodeOf(nodes, w.a);
        const b = nodeOf(nodes, w.b);
        const proj = pointOnSegment(centre, a, b);
        if (proj.distance > tol + 1) continue;
        if (!best || proj.distance < best.score) {
          best = { wall: w, t: projectParam(centre, a, b), score: proj.distance };
        }
      }
    }
    if (!best) continue;
    const t = Math.max(0, Math.min(1, best.t));
    out.push({ ...op, wall: best.wall.id, t });
  }
  return out;
}
