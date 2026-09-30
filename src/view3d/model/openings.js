/**
 * Door leaves and window glass in plan millimetres.
 * A leaf is one box. Swing doors rotate about the hinge; sliding leaves
 * translate along the wall. Glass is a thinner box and does not toggle.
 */

const GLASS = new Set(['window', 'bay']);
const SLIDE = new Set(['slide', 'shoji', 'fusuma', 'garage']);

/**
 * @param {object[]} walls
 * @param {object[]} openings
 * @param {Map<string, {x:number,y:number}>} nodes
 * @param {Map<string, {startSec:number, riseSec:number}>} schedule
 * @param {number} ceilingMm fallback wall height
 */
export function buildOpeningLeaves(walls, openings, nodes, schedule, ceilingMm) {
  const wallById = new Map();
  for (const wall of walls || []) wallById.set(wall.id, wall);
  /** @type {object[]} */
  const leaves = [];
  for (const op of openings || []) {
    const wall = wallById.get(op.wall);
    if (!wall || wall.virtual || wall.demolished) continue;
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const width = op.width || 0;
    if (!(width > 0)) continue;
    const ux = dx / length;
    const uy = dy / length;
    const center = (op.t ?? 0.5) * length;
    const half = width / 2;
    const hingeSide = op.hinge === 'right' ? 'right' : 'left';
    const hingeT = hingeSide === 'right' ? center + half : center - half;
    const wallH = wall.height > 0 ? wall.height : ceilingMm;
    const sill = op.sill || 0;
    const oh = op.height || 0;
    const z0 = Math.max(0, sill);
    const z1 = Math.min(wallH, sill + oh);
    if (!(z1 - z0 > 1) || !(wallH > 0)) continue;
    const mode = GLASS.has(op.kind) ? 'glass' : (SLIDE.has(op.kind) ? 'slide' : 'swing');
    const swingIn = op.swing !== 'out';
    const swingSign = (hingeSide === 'left' ? -1 : 1) * (swingIn ? 1 : -1);
    const timed = schedule.get(wall.id);
    leaves.push({
      id: op.id,
      kind: op.kind,
      mode,
      cx: a.x + ux * center,
      cy: a.y + uy * center,
      rotDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
      length: width,
      thickness: mode === 'glass' ? 16 : 40,
      z0,
      z1,
      hingeX: a.x + ux * hingeT,
      hingeY: a.y + uy * hingeT,
      hingeSide,
      swingSign,
      wallUx: ux,
      wallUy: uy,
      wallId: wall.id,
      startSec: timed ? timed.startSec : 0.3,
      riseSec: timed ? timed.riseSec : 0.16,
      fullHeight: wallH,
    });
  }
  return leaves;
}

/**
 * Plan position of a leaf. Closed leaves stay on the opening centre.
 * @param {object} leaf
 * @param {boolean} open
 * @returns {{cx:number, cy:number, rotDeg:number}}
 */
export function leafPose(leaf, open) {
  if (!open || leaf.mode === 'glass') {
    return { cx: leaf.cx, cy: leaf.cy, rotDeg: leaf.rotDeg };
  }
  if (leaf.mode === 'slide') {
    const shift = leaf.length * 0.85;
    return {
      cx: leaf.cx + leaf.wallUx * shift,
      cy: leaf.cy + leaf.wallUy * shift,
      rotDeg: leaf.rotDeg,
    };
  }
  const angle = leaf.swingSign * 80 * Math.PI / 180;
  const dirSign = leaf.hingeSide === 'right' ? -1 : 1;
  const lx = dirSign * leaf.length / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = lx * c;
  const rz = -lx * s;
  const wx = rx * leaf.wallUx + rz * (-leaf.wallUy);
  const wy = rx * leaf.wallUy + rz * leaf.wallUx;
  return {
    cx: leaf.hingeX + wx,
    cy: leaf.hingeY + wy,
    rotDeg: leaf.rotDeg + leaf.swingSign * 80,
  };
}
