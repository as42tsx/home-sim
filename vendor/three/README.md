# three.js 0.186.1

Vendored for Home Sim's 3D view. No bundler and no CDN.

- Source: `npm pack three@0.186.1` (registry tarball, unpacked outside this repo).
- License: MIT. See `LICENSE` in this directory (Three.js authors).
- Runtime entry: `three.module.js`, which imports `three.core.js` beside it.
- Addons actually used, at three's own example paths:
  - `addons/controls/OrbitControls.js`
  - `addons/utils/BufferGeometryUtils.js` (`mergeGeometries`)

The page import map points `three` at `three.module.js` and `three/addons/` at `addons/`.
Both addons import the bare specifier `three`.
