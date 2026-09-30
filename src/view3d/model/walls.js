/**
 * Wall solids in plan millimetres.
 * A wall is cut into boxes around its openings: full-height pieces beside
 * the holes, a sill under a window, a lintel over a door or window.
 * Virtual and demolished walls produce nothing.
 */

/**
 * @param {object} wall normalized or raw wall; `height` must already be resolved
 * @param {object[]} openings openings whose `wall` matches this wall
 * @param {Map<string, {x:number,y:number}>|{[id:string]:{x:number,y:number}}} nodes
 */
export function splitWallPieces(wall, openings, nodes) {
  if (!wall || wall.virtual || wall.demolished) return [];
  const a = nodes instanceof Map ? nodes.get(wall.a) : nodes[wall.a];
  const b = nodes instanceof Map ? nodes.get(wall.b) : nodes[wall.b];
  if (!a || !b) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return [];
  const height = wall.height > 0 ? wall.height : 0;
  if (!(height > 0)) return [];
  const thickness = wall.thickness > 0 ? wall.thickness : 0;
  if (!(thickness > 0)) return [];
  const ux = dx / length;
  const uy = dy / length;
  const rotDeg = (Math.atan2(uy, ux) * 180) / Math.PI;

  /** @type {{t0:number,t1:number,z0:number,z1:number}[]} */
  const holes = [];
  for (const op of openings || []) {
    if (!op || op.wall !== wall.id) continue;
    const width = op.width || 0;
    if (!(width > 0)) continue;
    const center = (op.t ?? 0.5) * length;
    const t0 = Math.max(0, Math.min(length, center - width / 2));
    const t1 = Math.max(0, Math.min(length, center + width / 2));
    if (t1 - t0 < 1) continue;
    const sill = op.sill || 0;
    const oh = op.height || 0;
    const z0 = Math.max(0, Math.min(height, sill));
    const z1 = Math.max(0, Math.min(height, sill + oh));
    if (z1 - z0 < 1) continue;
    holes.push({ t0, t1, z0, z1 });
  }
  holes.sort((p, q) => p.t0 - q.t0 || p.z0 - q.z0);

  /** @type {object[]} */
  const pieces = [];
  const pushBox = (t0, t1, z0, z1, role) => {
    if (t1 - t0 < 1 || z1 - z0 < 1) return;
    const mid = (t0 + t1) / 2;
    pieces.push({
      wallId: wall.id,
      role,
      t0,
      t1,
      z0,
      z1,
      length: t1 - t0,
      thickness,
      height: z1 - z0,
      fullHeight: height,
      cx: a.x + ux * mid,
      cy: a.y + uy * mid,
      rotDeg,
      exterior: !!wall.exterior,
      bearing: !!wall.bearing,
      ux,
      uy,
    });
  };

  let cursor = 0;
  for (const hole of holes) {
    pushBox(cursor, hole.t0, 0, height, 'side');
    if (hole.z0 > 0) pushBox(hole.t0, hole.t1, 0, hole.z0, 'sill');
    if (hole.z1 < height) pushBox(hole.t0, hole.t1, hole.z1, height, 'lintel');
    cursor = Math.max(cursor, hole.t1);
  }
  pushBox(cursor, length, 0, height, 'side');
  return pieces;
}

/**
 * Exterior walls rise before interior walls. Each wall starts 20 ms after the
 * previous one inside the 300–750 ms window. If that stagger would push the
 * last wall past the window, the stagger shrinks so the last rise still ends
 * at 750 ms.
 *
 * @param {{id:string, exterior?:boolean}[]} walls
 * @param {{ windowMs?:number, startMs?:number, staggerMs?:number, minRiseMs?:number }} [opts]
 */
export function wallRiseSchedule(walls, opts = {}) {
  const windowMs = opts.windowMs ?? 450;
  const startMs = opts.startMs ?? 300;
  const staggerMs = opts.staggerMs ?? 20;
  const minRiseMs = opts.minRiseMs ?? 160;
  const list = [...(walls || [])].sort((a, b) => {
    const ae = a.exterior ? 0 : 1;
    const be = b.exterior ? 0 : 1;
    if (ae !== be) return ae - be;
    const ia = String(a.id);
    const ib = String(b.id);
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
  });
  const n = list.length;
  let stagger = staggerMs;
  if (n > 1) {
    const need = (n - 1) * stagger + minRiseMs;
    if (need > windowMs) {
      stagger = (windowMs - minRiseMs) / (n - 1);
      if (stagger < 0) stagger = 0;
    }
  }
  const riseMs = Math.min(minRiseMs, Math.max(windowMs, 1));
  return list.map((w, index) => ({
    wallId: w.id,
    index,
    exterior: !!w.exterior,
    startSec: (startMs + index * stagger) / 1000,
    riseSec: Math.max(0.001, riseMs / 1000),
  }));
}
