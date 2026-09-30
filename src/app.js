// @browser-only
import { SCHEMA_VERSION } from './model/constants.js';
import { validatePlan } from './model/validate.js';
import { deriveAllFloors } from './rooms/index.js';
import { mountApp } from './ui/app.js';

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
  mountApp(debug);
}

export { debug };
