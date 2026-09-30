/**
 * Generic furniture primitives. Keyed by shape so a later asset pass can
 * replace one shape without touching the view. Each shape is at most four
 * parts and three materials. Parts are fractions of the item's w / d / h:
 * local +x is width, local +z is depth, cy is the part centre from the
 * floor (0) to the top (1).
 */

/** @type {Record<string, string>} */
export const TYPE_SHAPE = {
  'bed-double': 'bed',
  'bed-single': 'bed',
  wardrobe: 'cabinet',
  nightstand: 'cabinet',
  'sofa-3': 'sofa',
  armchair: 'sofa',
  'coffee-table': 'table',
  'tv-cabinet': 'cabinet',
  rug: 'flat',
  'dining-table': 'table',
  'dining-chair': 'chair',
  desk: 'table',
  'office-chair': 'chair',
  bookshelf: 'cabinet',
  fridge: 'cabinet',
  counter: 'counter',
  toilet: 'round',
  washbasin: 'cabinet',
  shower: 'box',
  bathtub: 'tub',
  'washing-machine': 'cabinet',
  plant: 'round',
  'floor-lamp': 'round',
};

/** Default size in millimetres when a caller has only a type. */
export const TYPE_DEFAULTS = {
  'bed-double': { w: 1800, d: 2000, h: 450 },
  'bed-single': { w: 1200, d: 2000, h: 450 },
  wardrobe: { w: 1800, d: 600, h: 2200 },
  nightstand: { w: 450, d: 400, h: 500 },
  'sofa-3': { w: 2100, d: 900, h: 800 },
  armchair: { w: 850, d: 850, h: 800 },
  'coffee-table': { w: 1200, d: 600, h: 420 },
  'tv-cabinet': { w: 1800, d: 400, h: 500 },
  rug: { w: 2000, d: 1400, h: 10 },
  'dining-table': { w: 1400, d: 800, h: 750 },
  'dining-chair': { w: 450, d: 500, h: 900 },
  desk: { w: 1200, d: 600, h: 750 },
  'office-chair': { w: 600, d: 600, h: 1000 },
  bookshelf: { w: 900, d: 350, h: 2000 },
  fridge: { w: 700, d: 700, h: 1800 },
  counter: { w: 2400, d: 600, h: 850 },
  toilet: { w: 400, d: 700, h: 750 },
  washbasin: { w: 600, d: 450, h: 850 },
  shower: { w: 900, d: 900, h: 2000 },
  bathtub: { w: 1700, d: 750, h: 550 },
  'washing-machine': { w: 600, d: 600, h: 850 },
  plant: { w: 400, d: 400, h: 1200 },
  'floor-lamp': { w: 400, d: 400, h: 1600 },
};

/**
 * @param {string} geo
 * @param {string} material
 * @param {number} cx
 * @param {number} cz
 * @param {number} cy
 * @param {number} sx
 * @param {number} sy
 * @param {number} sz
 */
function part(geo, material, cx, cz, cy, sx, sy, sz) {
  return { geo, material, cx, cz, cy, sx, sy, sz };
}

const SHAPES = {
  box: [part('box', 'wood', 0, 0, 0.5, 1, 1, 1)],
  flat: [part('box', 'fabric', 0, 0, 0.5, 1, 1, 1)],
  bed: [
    part('box', 'wood', 0, 0.02, 0.175, 1, 0.35, 0.92),
    part('box', 'fabric', 0, 0.06, 0.46, 0.92, 0.22, 0.78),
    part('box', 'wood', 0, -0.46, 0.5, 1, 0.72, 0.08),
    part('box', 'fabric', 0, -0.3, 0.64, 0.5, 0.14, 0.18),
  ],
  cabinet: [
    part('box', 'wood', 0, -0.02, 0.48, 1, 0.96, 0.9),
    part('box', 'wood', 0, 0.47, 0.48, 0.92, 0.88, 0.05),
    part('box', 'metal', 0.38, 0.51, 0.48, 0.05, 0.05, 0.04),
  ],
  sofa: [
    part('box', 'fabric', 0, 0.06, 0.22, 0.84, 0.38, 0.7),
    part('box', 'fabric', 0, -0.4, 0.55, 0.96, 0.62, 0.16),
    part('box', 'fabric', -0.44, 0.04, 0.32, 0.12, 0.42, 0.72),
    part('box', 'fabric', 0.44, 0.04, 0.32, 0.12, 0.42, 0.72),
  ],
  table: [
    part('box', 'wood', 0, 0, 0.96, 1, 0.08, 1),
    part('box', 'wood', -0.42, 0, 0.46, 0.08, 0.92, 0.72),
    part('box', 'wood', 0.42, 0, 0.46, 0.08, 0.92, 0.72),
  ],
  chair: [
    part('box', 'fabric', 0, 0.02, 0.48, 0.92, 0.1, 0.88),
    part('box', 'fabric', 0, -0.42, 0.76, 0.9, 0.42, 0.1),
    part('box', 'wood', 0, 0.02, 0.23, 0.8, 0.46, 0.78),
  ],
  counter: [
    part('box', 'wood', 0, -0.02, 0.43, 1, 0.86, 0.9),
    part('box', 'metal', 0, 0, 0.96, 1.02, 0.08, 1),
  ],
  round: [
    part('cyl', 'metal', 0, 0, 0.43, 0.16, 0.86, 0.16),
    part('cyl', 'leaf', 0, 0, 0.96, 0.9, 0.08, 0.9),
  ],
  tub: [
    part('box', 'metal', 0, 0, 0.34, 0.92, 0.62, 0.86),
    part('box', 'metal', 0, 0, 0.7, 1, 0.12, 1),
  ],
};

/**
 * @param {string} type
 * @returns {string}
 */
export function shapeForType(type) {
  return TYPE_SHAPE[type] || 'box';
}

/**
 * Fresh part list. Unknown shapes fall back to a single box.
 * @param {string} shape
 */
export function partsForShape(shape) {
  const src = SHAPES[shape] || SHAPES.box;
  return src.map((p) => ({ ...p }));
}

/** Shape names the instancer knows about, in a stable order. */
export function knownShapes() {
  return Object.keys(SHAPES);
}
