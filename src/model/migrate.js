/**
 * Plan migration registry.
 * Version 2 is the identity. There is no importer for the unlicensed
 * reference format (that work is P2, US-36).
 */

import { SCHEMA_VERSION } from './constants.js';

/**
 * @param {object} plan
 * @returns {{ ok: boolean, plan: object|null, errors: object[], warnings: object[] }}
 */
export function migrate(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return {
      ok: false,
      plan: null,
      errors: [issue('/schemaVersion', 'UNSUPPORTED_VERSION', 'Unsupported plan version')],
      warnings: [],
    };
  }
  const version = plan.schemaVersion;
  if (version === SCHEMA_VERSION) {
    return { ok: true, plan, errors: [], warnings: [] };
  }
  if (typeof version === 'number' && Number.isFinite(version) && version > SCHEMA_VERSION) {
    return {
      ok: false,
      plan: null,
      errors: [issue('/schemaVersion', 'NEWER_VERSION', '请使用新版本')],
      warnings: [],
    };
  }
  return {
    ok: false,
    plan: null,
    errors: [issue('/schemaVersion', 'UNSUPPORTED_VERSION', 'Unsupported plan version')],
    warnings: [],
  };
}

function issue(path, code, message) {
  return { path, code, message, severity: 'error' };
}
