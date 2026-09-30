/**
 * Editor defaults for new objects. Persisted by the storage layer under
 * `homesim:prefs`. Changing a default never rewrites objects already placed.
 */

import { WALL_THICKNESS } from '../model/constants.js';

export const PREFS_KEY = 'homesim:prefs';

export const DEFAULT_PREFS = Object.freeze({
  lang: 'zh',
  wallThickness: WALL_THICKNESS.default,
  exteriorThickness: 240,
  doorWidth: 900,
  doorHeight: 2100,
  windowWidth: 1500,
  windowHeight: 1500,
  windowSill: 900,
  furnitureSnap: true,
  wallVirtual: false,
  wallBearing: false,
  wallExterior: false,
});

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** @param {object|null|undefined} raw */
export function normalizePrefs(raw) {
  const base = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return base;
  if (raw.lang === 'en' || raw.lang === 'zh') base.lang = raw.lang;
  base.wallThickness = clamp(num(raw.wallThickness, base.wallThickness), WALL_THICKNESS.min, WALL_THICKNESS.max);
  base.exteriorThickness = clamp(num(raw.exteriorThickness, base.exteriorThickness), WALL_THICKNESS.min, WALL_THICKNESS.max);
  base.doorWidth = clamp(num(raw.doorWidth, base.doorWidth), 100, 6000);
  base.doorHeight = clamp(num(raw.doorHeight, base.doorHeight), 100, 6000);
  base.windowWidth = clamp(num(raw.windowWidth, base.windowWidth), 100, 6000);
  base.windowHeight = clamp(num(raw.windowHeight, base.windowHeight), 100, 6000);
  base.windowSill = clamp(num(raw.windowSill, base.windowSill), 0, 6000);
  if (typeof raw.furnitureSnap === 'boolean') base.furnitureSnap = raw.furnitureSnap;
  if (typeof raw.wallVirtual === 'boolean') base.wallVirtual = raw.wallVirtual;
  if (typeof raw.wallBearing === 'boolean') base.wallBearing = raw.wallBearing;
  if (typeof raw.wallExterior === 'boolean') base.wallExterior = raw.wallExterior;
  if (base.wallVirtual) base.wallBearing = false;
  return base;
}
