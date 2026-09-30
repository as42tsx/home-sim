/** Display formatters. Thousands use a thin space, areas use two decimals. */

const THIN = '\u2009';

/** @param {number} value millimetres */
export function formatMm(value) {
  const n = Math.round(Number(value) || 0);
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  const parts = [];
  for (let i = digits.length; i > 0; i -= 3) {
    parts.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return sign + parts.join(THIN);
}

/**
 * @param {number} areaMm2
 * @returns {string} two decimal places, already in m²
 */
export function formatAreaMm2(areaMm2) {
  return formatAreaM2((Number(areaMm2) || 0) / 1e6);
}

/** @param {number} m2 */
export function formatAreaM2(m2) {
  const n = Math.round((Number(m2) || 0) * 100) / 100;
  return n.toFixed(2);
}

/** Bearing from +x, y-down, degrees in [0, 360). */
export function angleDeg(dx, dy) {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/** @param {number} deg */
export function formatAngle(deg) {
  return String(Math.round(((deg % 360) + 360) % 360));
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}
