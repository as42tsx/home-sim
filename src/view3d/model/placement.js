/**
 * Furniture instance matrices.
 *
 * Plan x is world x, plan y is world z, world y is up. Item local +x runs
 * along `rot` (0 = +x, 90 = +y). Item local +z is the plan left normal
 * (sin θ, −cos θ), matching `orientedRect`. The matrix is column-major and
 * bakes the part scale into the basis so a unit box (or cylinder) lands on
 * the oriented rectangle.
 */

/**
 * @param {object} item
 */
export function itemSizeM(item) {
  return {
    w: (item.w ?? 0) / 1000,
    d: (item.d ?? 0) / 1000,
    h: (item.h ?? 750) / 1000,
    z: (item.z ?? 0) / 1000,
    rot: item.rot ?? 0,
  };
}

/**
 * @param {number} rotDeg
 * @returns {{ width:{x:number,z:number}, depth:{x:number,z:number} }}
 */
export function basisOf(rotDeg) {
  const th = (rotDeg * Math.PI) / 180;
  return {
    width: { x: Math.cos(th), z: Math.sin(th) },
    depth: { x: Math.sin(th), z: -Math.cos(th) },
  };
}

/**
 * Column-major 4×4 for one part. `originYM` is the floor finish the item sits on.
 * @param {object} item
 * @param {object} part
 * @param {number} originYM
 * @returns {number[]}
 */
export function partMatrix(item, part, originYM) {
  const size = itemSizeM(item);
  const { width, depth } = basisOf(size.rot);
  const sx = part.sx * size.w;
  const sy = part.sy * size.h;
  const sz = part.sz * size.d;
  const px = (item.cx ?? 0) / 1000
    + width.x * part.cx * size.w
    + depth.x * part.cz * size.d;
  const pz = (item.cy ?? 0) / 1000
    + width.z * part.cx * size.w
    + depth.z * part.cz * size.d;
  const py = originYM + size.z + part.cy * size.h;
  return [
    width.x * sx, 0, width.z * sx, 0,
    0, sy, 0, 0,
    depth.x * sz, 0, depth.z * sz, 0,
    px, py, pz, 1,
  ];
}

/**
 * Transform a unit-box corner by a column-major matrix.
 * @param {number[]} m
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function transformPoint(m, x, y, z) {
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}
