/**
 * Identifier helpers.
 * Tests inject {@link createIdGenerator} so room splits are deterministic.
 * Ids match `^[A-Za-z0-9_-]{1,64}$`.
 */

/**
 * @param {string} [prefix]
 * @param {number} [start] last value already issued; the next call returns start+1
 * @returns {() => string}
 */
export function createIdGenerator(prefix = 'id', start = 0) {
  let n = start;
  return function nextId() {
    n += 1;
    return `${prefix}${n}`;
  };
}

let fallbackSeq = 0;

/**
 * Non-deterministic id for interactive callers (empty plans, ad-hoc entities).
 * @param {string} [prefix]
 * @returns {string}
 */
export function uniqueId(prefix = 'id') {
  fallbackSeq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  const stamp = Date.now().toString(36);
  return `${prefix}-${stamp}-${rand}-${fallbackSeq}`;
}
