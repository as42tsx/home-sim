/**
 * Which furniture ids actually changed between two arrays.
 * Missing h / z / rot match the view's defaults, so a document that omits
 * them is not a rebuild. Colour is compared case-insensitively.
 */

function norm(item) {
  return {
    type: item.type ?? '',
    cx: item.cx ?? 0,
    cy: item.cy ?? 0,
    z: item.z ?? 0,
    w: item.w ?? 0,
    d: item.d ?? 0,
    h: item.h ?? 750,
    rot: item.rot ?? 0,
    color: String(item.color ?? '').toLowerCase(),
    host: item.host ?? null,
  };
}

function same(a, b) {
  return a.type === b.type
    && a.cx === b.cx
    && a.cy === b.cy
    && a.z === b.z
    && a.w === b.w
    && a.d === b.d
    && a.h === b.h
    && a.rot === b.rot
    && a.color === b.color
    && a.host === b.host;
}

/**
 * @param {object[]} prev
 * @param {object[]} next
 * @returns {string[]} ids that were added, removed, or visually changed
 */
export function changedFurnitureIds(prev, next) {
  const before = new Map();
  for (const item of prev || []) {
    if (item && item.id != null) before.set(item.id, norm(item));
  }
  const after = new Map();
  for (const item of next || []) {
    if (item && item.id != null) after.set(item.id, norm(item));
  }
  /** @type {string[]} */
  const ids = [];
  for (const [id, item] of after) {
    const old = before.get(id);
    if (!old || !same(old, item)) ids.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) ids.push(id);
  }
  return ids;
}
