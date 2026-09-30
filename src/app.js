/**
 * Placeholder bootstrap. Proves the modules load and the two-bedroom template
 * derives. The editor UI is a later milestone.
 */

import { SCHEMA_VERSION } from './model/constants.js';
import { validatePlan } from './model/validate.js';
import { deriveAllFloors } from './rooms/index.js';

const version = '0.1.0-m1';

const debug = {
  version,
  schemaVersion: SCHEMA_VERSION,
  deriveAllFloors,
  validatePlan,
  renderInfo: () => ({ note: '3D not loaded' }),
};

if (typeof window !== 'undefined') {
  window.__HOMESIM_DEBUG__ = debug;
}

async function boot() {
  const status = document.querySelector('[data-status]');
  try {
    const url = new URL('../templates/apt-2br.json', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法读取两居模板（${res.status}）`);
    const tpl = await res.json();
    const issues = validatePlan(tpl.plan);
    const errors = issues.filter((item) => item.severity !== 'warning');
    if (errors.length) throw new Error(errors.map((item) => item.message).join('；'));
    const derived = deriveAllFloors(tpl.plan);
    let count = 0;
    for (const floorId of Object.keys(derived)) {
      count += derived[floorId].rooms.length;
    }
    if (status) {
      status.textContent = `schemaVersion ${SCHEMA_VERSION} · 模块加载正常 · 两居模板识别出 ${count} 个房间`;
    }
    document.documentElement.dataset.app = 'ready';
  } catch (error) {
    document.documentElement.dataset.app = 'error';
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
}

if (typeof document !== 'undefined') boot();

export { debug };
