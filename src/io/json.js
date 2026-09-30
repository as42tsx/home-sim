/**
 * Plan JSON import and export.
 * `importPlanJSON` never throws: bad input comes back as `{ ok: false, errors }`.
 * A multi-floor plan is preserved intact (PRD §8).
 */

import { migrate } from '../model/migrate.js';
import { validatePlan } from '../model/validate.js';

/**
 * @param {object} plan
 * @param {{ pretty?: boolean }} [opts]
 * @returns {string}
 */
export function exportPlanJSON(plan, opts = {}) {
  const pretty = opts.pretty !== false;
  return pretty ? JSON.stringify(plan, null, 2) : JSON.stringify(plan);
}

/**
 * @param {string} text
 * @returns {{ ok: boolean, plan: object|null, errors: object[], warnings: object[] }}
 */
export function importPlanJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      plan: null,
      errors: [{
        path: '',
        code: 'INVALID_JSON',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        severity: 'error',
      }],
      warnings: [],
    };
  }
  const migrated = migrate(data);
  if (!migrated.ok) {
    return { ok: false, plan: null, errors: migrated.errors, warnings: migrated.warnings };
  }
  const issues = validatePlan(migrated.plan);
  const errors = issues.filter((item) => item.severity !== 'warning');
  const warnings = issues.filter((item) => item.severity === 'warning');
  if (errors.length) {
    return { ok: false, plan: null, errors, warnings };
  }
  return { ok: true, plan: migrated.plan, errors: [], warnings };
}
