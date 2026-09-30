/**
 * Pure stair-rule checks. The caller loads `rules/*.json` and passes the object.
 * Warnings are hints for the designer. They are not a compliance certificate
 * (PRD §12.4).
 */

/**
 * Read one limit. A null value (unverified or "do not invent") is ignored.
 * @param {object|null|undefined} rules
 * @param {string} key
 * @returns {object|null}
 */
export function ruleLimit(rules, key) {
  const item = rules?.limits?.[key];
  if (!item || item.value == null || typeof item.value !== 'number' || !Number.isFinite(item.value)) return null;
  return item;
}

/**
 * @param {object} metrics
 * @param {number} metrics.riser
 * @param {number} metrics.tread
 * @param {number} metrics.width
 * @param {string} metrics.kind
 * @param {{ risers: number, rise: number }[]} metrics.flights
 * @param {{ depth: number }|null} metrics.landing
 * @param {object|null|undefined} rules
 * @returns {{ code: string, clause: string, source: string, message: string, actual: number|null, limit: number|null }[]}
 */
export function applyStairRules(metrics, rules) {
  if (!rules) return [];
  /** @type {object[]} */
  const warnings = [];
  const sourceOf = (item) => item?.source || rules.title || '';

  const push = (code, item, message, actual, limit) => {
    warnings.push({
      code,
      clause: item?.clause || '',
      source: sourceOf(item),
      message,
      actual,
      limit: limit ?? item?.value ?? null,
    });
  };

  const riserMax = ruleLimit(rules, 'riserMax');
  if (riserMax && metrics.riser > riserMax.value + 1e-6) {
    push('RISER_TOO_HIGH', riserMax, `Riser ${fmt(metrics.riser)} mm exceeds ${riserMax.value} mm`, metrics.riser, riserMax.value);
  }

  const treadMin = ruleLimit(rules, 'treadMin');
  if (treadMin && metrics.tread < treadMin.value - 1e-6) {
    push('TREAD_TOO_SHALLOW', treadMin, `Tread ${fmt(metrics.tread)} mm is under ${treadMin.value} mm`, metrics.tread, treadMin.value);
  }

  const widthItem = strictestWidth(rules);
  if (widthItem && metrics.width < widthItem.value - 1e-6) {
    push('WIDTH_TOO_NARROW', widthItem, `Stair width ${fmt(metrics.width)} mm is under ${widthItem.value} mm`, metrics.width, widthItem.value);
  }

  const stepsMin = ruleLimit(rules, 'flightStepsMin');
  const stepsMax = ruleLimit(rules, 'flightStepsMax');
  const riseMax = ruleLimit(rules, 'flightRiseMax');
  for (const flight of metrics.flights || []) {
    if (stepsMin && flight.risers < stepsMin.value) {
      push('FLIGHT_RISERS_OUT_OF_RANGE', stepsMin, `Flight has ${flight.risers} risers (minimum ${stepsMin.value})`, flight.risers, stepsMin.value);
    }
    if (stepsMax && flight.risers > stepsMax.value) {
      push('FLIGHT_RISERS_OUT_OF_RANGE', stepsMax, `Flight has ${flight.risers} risers (maximum ${stepsMax.value})`, flight.risers, stepsMax.value);
    }
    if (riseMax && flight.rise > riseMax.value + 1e-6) {
      push('FLIGHT_RISE_TOO_HIGH', riseMax, `Flight rise ${fmt(flight.rise)} mm exceeds ${riseMax.value} mm`, flight.rise, riseMax.value);
    }
  }

  if (metrics.landing) {
    const turning = metrics.kind === 'L' || metrics.kind === 'U';
    const item = turning ? ruleLimit(rules, 'landingTurnMin') : ruleLimit(rules, 'straightLandingMin');
    if (item) {
      const limit = turning ? Math.max(item.value, metrics.width) : item.value;
      if (metrics.landing.depth < limit - 1e-6) {
        push('LANDING_TOO_SHALLOW', item, `Landing depth ${fmt(metrics.landing.depth)} mm is under ${fmt(limit)} mm`, metrics.landing.depth, limit);
      }
    }
  }

  const handrail = ruleLimit(rules, 'handrailMin') || rules?.limits?.handrailRequired;
  if (handrail) {
    push('HANDRAIL_REMINDER', handrail, 'Confirm handrail presence and height on site', null, handrail.value ?? null);
  }
  const guard = ruleLimit(rules, 'guardHeight') || ruleLimit(rules, 'guardLongMin') || ruleLimit(rules, 'stairGuardMin');
  if (guard) {
    push('GUARD_REMINDER', guard, 'Confirm guard height on open sides', null, guard.value ?? null);
  }

  return warnings;
}

function strictestWidth(rules) {
  const keys = ['widthBetweenWalls', 'widthMin', 'widthClear'];
  let best = null;
  for (const key of keys) {
    const item = ruleLimit(rules, key);
    if (!item) continue;
    if (!best || item.value > best.value) best = item;
  }
  return best;
}

function fmt(n) {
  return Math.round(n * 100) / 100;
}
