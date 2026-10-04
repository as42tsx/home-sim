/**
 * User-facing copy never includes an error code. Codes go to the console.
 */

const KEY_BY_CODE = {
  NEWER_VERSION: 'error.newer',
  UNSUPPORTED_VERSION: 'error.unsupported',
  INVALID_JSON: 'error.badFile',
  INVALID_TYPE: 'error.badFile',
  TOO_LONG: 'share.tooBigTitle',
  LINK_INCOMPLETE: 'share.incomplete',
};

/**
 * @param {string} [code]
 * @param {unknown} [detail]
 */
export function logIssue(code, detail) {
  const label = code == null || code === '' ? 'UNKNOWN' : String(code);
  console.warn('[homesim]', label, detail ?? '');
}

/**
 * i18n key for a validation or import code. Unknown codes use a generic sentence.
 * @param {string} [code]
 */
export function messageKeyForCode(code) {
  return KEY_BY_CODE[code] || 'error.generic';
}
