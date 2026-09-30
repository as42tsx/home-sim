/**
 * Top-view marks for each catalog shape, in local millimetres.
 * The origin is the item centre. +x is width, +y is depth (y-down).
 * The back edge is y = -d/2 so a zero rotation shows the back toward -y.
 * Batch-2 art can replace these drawings without touching the editor.
 */

/**
 * @param {string} shape
 * @param {number} w
 * @param {number} d
 * @returns {object[]}
 */
export function furnitureSymbol(shape, w, d) {
  const x = -w / 2;
  const y = -d / 2;
  const frame = { type: 'rect', x, y, w, d };
  if (shape === 'bed') {
    return [
      frame,
      { type: 'rect', x: x + w * 0.08, y: y + d * 0.06, w: w * 0.84, d: Math.min(d * 0.16, 280) },
    ];
  }
  if (shape === 'sofa') {
    return [
      frame,
      { type: 'rect', x, y, w, d: Math.max(80, d * 0.28) },
      { type: 'line', x1: x + w * 0.08, y1: y, x2: x + w * 0.08, y2: y + d },
      { type: 'line', x1: x + w * 0.92, y1: y, x2: x + w * 0.92, y2: y + d },
    ];
  }
  if (shape === 'chair') {
    return [
      frame,
      { type: 'rect', x: x + w * 0.12, y, w: w * 0.76, d: Math.max(60, d * 0.22) },
    ];
  }
  if (shape === 'table') {
    return [
      frame,
      { type: 'line', x1: x + 80, y1: y + 80, x2: x + w - 80, y2: y + d - 80 },
    ];
  }
  if (shape === 'cabinet' || shape === 'counter') {
    return [
      frame,
      { type: 'line', x1: x, y1: 0, x2: x + w, y2: 0 },
    ];
  }
  if (shape === 'flat') {
    return [{ type: 'rect', x, y, w, d, dash: true }];
  }
  if (shape === 'round') {
    return [{ type: 'circle', cx: 0, cy: 0, r: Math.min(w, d) / 2 }];
  }
  if (shape === 'tub') {
    return [
      frame,
      { type: 'rect', x: x + 40, y: y + 40, w: w - 80, d: d - 80 },
    ];
  }
  if (shape === 'box') return [frame];
  return [frame];
}
