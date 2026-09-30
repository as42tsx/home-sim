/**
 * localStorage plan index. Pure aside from the storage object passed in.
 * Keys: `homesim:index`, `homesim:plan:<id>`, `homesim:last`, `homesim:prefs`.
 * Quota is an estimate (UTF-16 code units × 2) against 5 MB.
 */

import { PREFS_KEY, normalizePrefs } from '../editor/prefs.js';

export const INDEX_KEY = 'homesim:index';
export const LAST_KEY = 'homesim:last';
export { PREFS_KEY };
export const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024;

export function planKey(id) {
  return `homesim:plan:${id}`;
}

/** @param {Storage} storage */
export function estimateBytes(storage) {
  let bytes = 0;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key == null) continue;
    const value = storage.getItem(key) ?? '';
    bytes += (key.length + value.length) * 2;
  }
  return bytes;
}

/**
 * @param {Storage} storage
 * @param {number} [quota]
 */
export function estimateUsage(storage, quota = DEFAULT_QUOTA_BYTES) {
  const bytes = estimateBytes(storage);
  return {
    bytes,
    quota,
    ratio: quota > 0 ? bytes / quota : 1,
    warn: quota > 0 && bytes > quota * 0.8,
  };
}

/** @param {Storage} storage */
export function readIndex(storage) {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : data?.plans;
    if (!Array.isArray(list)) return [];
    return list.filter((item) => item && typeof item.id === 'string').map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : '',
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      template: item.template ?? null,
    }));
  } catch {
    return [];
  }
}

function writeIndex(storage, list) {
  storage.setItem(INDEX_KEY, JSON.stringify(list));
}

/** Newest first. */
export function sortPlans(list) {
  return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (a.id < b.id ? -1 : 1));
}

/** @param {Storage} storage @param {string} id */
export function readPlan(storage, id) {
  try {
    const raw = storage.getItem(planKey(id));
    if (!raw) return null;
    const plan = JSON.parse(raw);
    if (!plan || typeof plan !== 'object') return null;
    return plan;
  } catch {
    return null;
  }
}

/** @param {Storage} storage */
export function readLastId(storage) {
  try {
    return storage.getItem(LAST_KEY) || null;
  } catch {
    return null;
  }
}

/** @param {Storage} storage @param {string} id */
export function writeLastId(storage, id) {
  storage.setItem(LAST_KEY, id);
}

/**
 * @param {Storage} storage
 * @param {object} plan
 * @param {{ quota?: number, now?: number }} [opts]
 * @returns {{ ok: boolean, warn: boolean, error?: unknown, bytes?: number, quota?: number }}
 */
export function writePlan(storage, plan, opts = {}) {
  const quota = opts.quota ?? DEFAULT_QUOTA_BYTES;
  const key = planKey(plan.meta.id);
  const text = JSON.stringify(plan);
  const old = storage.getItem(key);
  const oldBytes = old == null ? 0 : (key.length + old.length) * 2;
  const nextBytes = estimateBytes(storage) - oldBytes + (key.length + text.length) * 2;
  const warn = quota > 0 && nextBytes > quota * 0.8;
  try {
    storage.setItem(key, text);
    const list = readIndex(storage).filter((item) => item.id !== plan.meta.id);
    list.push({
      id: plan.meta.id,
      name: plan.meta.name,
      updatedAt: plan.meta.updatedAt,
      template: plan.meta.template ?? null,
    });
    writeIndex(storage, list);
    writeLastId(storage, plan.meta.id);
  } catch (error) {
    return { ok: false, warn, error, bytes: nextBytes, quota };
  }
  return { ok: true, warn, bytes: nextBytes, quota };
}

/** @param {Storage} storage @param {string} id */
export function removePlan(storage, id) {
  storage.removeItem(planKey(id));
  writeIndex(storage, readIndex(storage).filter((item) => item.id !== id));
  if (readLastId(storage) === id) storage.removeItem(LAST_KEY);
}

/**
 * @param {Storage} storage
 * @param {string} id
 * @param {string} name
 * @param {number} now
 */
export function renameStored(storage, id, name, now) {
  const plan = readPlan(storage, id);
  if (!plan) return { ok: false, reason: 'missing' };
  plan.meta.name = name;
  plan.meta.updatedAt = now;
  return writePlan(storage, plan);
}

/** @param {Storage} storage */
export function readPrefs(storage) {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return normalizePrefs(null);
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return normalizePrefs(null);
  }
}

/** @param {Storage} storage @param {object} prefs */
export function writePrefs(storage, prefs) {
  const normal = normalizePrefs(prefs);
  storage.setItem(PREFS_KEY, JSON.stringify(normal));
  return normal;
}
