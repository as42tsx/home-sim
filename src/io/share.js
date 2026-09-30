/**
 * Share-link codec (PRD §12.6, US-15).
 *
 * Hash form: `#p=` + one prefix character + payload.
 * - `d` — JSON, deflate-raw, base64url. Used when `CompressionStream` exists.
 * - `z` — vendored lz-string `compressToEncodedURIComponent`. Fallback, or
 *   when `opts.codec` is `'lz'` or `'z'`.
 *
 * The hash must be at most `SHARE_MAX_BYTES` UTF-8 bytes or the result is
 * `{ ok: false, code: 'TOO_LONG' }`. Decode never touches storage. Any
 * truncation, corruption, or failed validation is `LINK_INCOMPLETE`.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from '../../vendor/lz-string/lz-string.js';
import { SHARE_MAX_BYTES } from '../model/constants.js';
import { exportPlanJSON, importPlanJSON } from './json.js';

/**
 * @param {object} plan
 * @param {{ baseUrl?: string, codec?: 'd'|'deflate'|'z'|'lz' }} [opts]
 * @returns {Promise<{ ok: true, url: string, hash: string, bytes: number } | { ok: false, code: 'TOO_LONG', bytes: number }>}
 */
export async function encodeShareLink(plan, opts = {}) {
  const baseUrl = opts.baseUrl ?? '';
  const json = exportPlanJSON(plan, { pretty: false });
  const useLz = opts.codec === 'lz' || opts.codec === 'z' || typeof CompressionStream === 'undefined';
  let prefix;
  let payload;
  if (useLz) {
    prefix = 'z';
    payload = compressToEncodedURIComponent(json);
  } else {
    prefix = 'd';
    const raw = await deflateRaw(json);
    payload = bytesToBase64Url(raw);
  }
  const hash = `#p=${prefix}${payload}`;
  const bytes = utf8Size(hash);
  if (bytes > SHARE_MAX_BYTES) return { ok: false, code: 'TOO_LONG', bytes };
  return { ok: true, url: `${baseUrl}${hash}`, hash, bytes };
}

/**
 * @param {string} hashOrUrl hash (`#p=…` or `p=…`) or a full URL containing `#p=`
 * @returns {Promise<{ ok: true, plan: object } | { ok: false, code: 'LINK_INCOMPLETE' }>}
 */
export async function decodeShareLink(hashOrUrl) {
  try {
    const hash = extractHash(hashOrUrl);
    if (!hash || !hash.startsWith('#p=') || hash.length < 5) {
      return { ok: false, code: 'LINK_INCOMPLETE' };
    }
    const body = hash.slice(3);
    const prefix = body[0];
    const payload = body.slice(1);
    if (!payload) return { ok: false, code: 'LINK_INCOMPLETE' };
    let json;
    if (prefix === 'd') {
      json = await inflateRaw(base64UrlToBytes(payload));
    } else if (prefix === 'z') {
      json = decompressFromEncodedURIComponent(payload);
      if (typeof json !== 'string' || json.length === 0) return { ok: false, code: 'LINK_INCOMPLETE' };
    } else {
      return { ok: false, code: 'LINK_INCOMPLETE' };
    }
    const imported = importPlanJSON(json);
    if (!imported.ok || !imported.plan) return { ok: false, code: 'LINK_INCOMPLETE' };
    return { ok: true, plan: imported.plan };
  } catch {
    return { ok: false, code: 'LINK_INCOMPLETE' };
  }
}

function extractHash(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  const at = input.indexOf('#p=');
  if (at >= 0) return input.slice(at);
  if (input.startsWith('p=')) return `#${input}`;
  return null;
}

function utf8Size(text) {
  return new TextEncoder().encode(text).length;
}

async function deflateRaw(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function bytesToBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(text) {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4));
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
