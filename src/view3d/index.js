// @browser-only

import { mountView } from './gl.js';

const REASON = '这台设备的浏览器不支持 3D，2D 功能不受影响';

/**
 * Probe a detached canvas. `reason` is the Luna copy when WebGL is missing.
 */
export function isWebGLAvailable() {
  try {
    if (typeof document === 'undefined') return { ok: false, reason: REASON };
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { ok: false, reason: REASON };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: REASON };
  }
}

/**
 * Load three.js (import map) and mount a view. Resolves once the library is ready.
 * @param {object} options
 */
export async function createView3D(options) {
  const THREE = await import('three');
  const controls = await import('three/addons/controls/OrbitControls.js');
  const utils = await import('three/addons/utils/BufferGeometryUtils.js');
  return mountView(THREE, {
    OrbitControls: controls.OrbitControls,
    mergeGeometries: utils.mergeGeometries,
  }, options || {});
}
