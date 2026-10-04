// @browser-only

/**
 * WebGL half of the 3D view. three.js is passed in so this module can be
 * imported from Node (the smoke test) without resolving the bare specifier.
 * Scene graph: Building → Floor(id) → {slab, walls, openings, furniture, stairs}.
 * One unit is one metre. Floor groups sit at elevation on Y.
 */

import { getFloor } from '../model/document.js';
import { shapeForType, partsForShape } from './furniture-shapes.js';
import { composeFloor, floorOffsetM } from './model/structure.js';
import { leafPose } from './model/openings.js';
import { partMatrix } from './model/placement.js';
import {
  planBoundsMm,
  buildingTopMm,
  frameCamera,
  cameraPose,
} from './model/bounds.js';
import { enterPose, exitPose } from './model/easing.js';
import { createSlotAllocator } from './model/slots.js';
import { collisionSegments, resolveWalkStart, clipMove } from './model/walk.js';
import { encodePNG } from './model/png.js';
import { TOKEN_FALLBACK } from './model/tokens.js';
import {
  CUTAWAY_M,
  EYE_M,
  WALK_RADIUS_M,
  WALK_SPEED_MPS,
  ENTER_MS,
  EXIT_MS,
  REDUCED_MS,
} from './model/constants.js';

const PARK = [
  0.001, 0, 0, 0,
  0, 0.001, 0, 0,
  0, 0, 0.001, 0,
  0, -50, 0, 1,
];

const CLIP_VERT = `
attribute float aStart;
attribute float aRise;
attribute float aFullH;
varying float vLocalY;
varying float vStart;
varying float vRise;
varying float vFullH;
`;

const CLIP_FRAG = `
uniform float uTime;
uniform float uHeightCap;
varying float vLocalY;
varying float vStart;
varying float vRise;
varying float vFullH;
`;

const CLIP_DISCARD = `
{
  float denom = max(vRise, 0.0001);
  float u = clamp((uTime - vStart) / denom, 0.0, 1.0);
  float eased = 1.0 - pow(1.0 - u, 3.0);
  float risen = min(vFullH * eased, uHeightCap);
  if (vLocalY > risen + 0.0005) discard;
}
`;

/* Cutaway clips the real top face, so the visible section is the side faces
   just under the clip. Swap those fragments to the dark cap colour. */
const WALL_SECTION = `
diffuseColor.rgb *= uWallLift;
if (uHeightCap < 40.0) {
  float denomC = max(vRise, 0.0001);
  float uC = clamp((uTime - vStart) / denomC, 0.0, 1.0);
  float easedC = 1.0 - pow(1.0 - uC, 3.0);
  float risenC = min(vFullH * easedC, uHeightCap);
  if (vLocalY > risenC - 0.08) diffuseColor.rgb = vCap;
}
`;

/**
 * @param {object} THREE
 * @param {{OrbitControls: Function, mergeGeometries: Function}} addons
 * @param {object} options
 */
export function mountView(THREE, addons, options) {
  const { OrbitControls, mergeGeometries } = addons;
  const container = options.container;
  const getPlan = typeof options.getPlan === 'function' ? options.getPlan : () => ({ floors: [] });
  const reduced = !!options.reducedMotion;
  const onSelectFurniture = typeof options.onSelectFurniture === 'function' ? options.onSelectFurniture : () => {};

  const shadows = !queryFlag('noshadow');
  const coarse = pointerCoarse();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = true;
  renderer.setPixelRatio(pixelCap());
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = skyBackdrop(THREE);
  scene.fog = new THREE.Fog(readColor(THREE, '--sky-day-bottom'), 100, 1500);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
  const building = new THREE.Group();
  building.name = 'Building';
  scene.add(building);

  const hemi = new THREE.HemisphereLight(0xfff6ec, 0xcbbba6, 0.55);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xfff8f0, 0.38);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2e4, 2.5);
  sun.castShadow = shadows;
  const mapSize = coarse ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const uTime = { value: 0 };
  const uHeightCap = { value: 100 };
  const uDrop = { value: 0 };

  const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  const doorMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  const paintFace = readColor(THREE, '--wall-3d-face');
  const paintShade = readColor(THREE, '--wall-3d-face-shade');
  const uWallLift = { value: 1 };
  const wallFactor = (ndot, up) => lambertFactor(ambient, hemi, sun, ndot, up);
  {
    const dark = wallFactor(0, 0);
    let lift = 1;
    for (const color of [paintFace, paintShade]) {
      lift = Math.max(lift, color.r / dark[0], color.g / dark[1], color.b / dark[2]);
    }
    uWallLift.value = lift * 1.02;
  }
  patchWallPaint(wallMat, uTime, uHeightCap, uWallLift);
  patchClip(doorMat, uTime, uHeightCap);
  patchClip(glassMat, uTime, uHeightCap);
  patchClip(depthMat, uTime, uHeightCap);

  const roomMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const slabMat = new THREE.MeshLambertMaterial({ color: readColor(THREE, '--slab'), side: THREE.DoubleSide });
  const groundMat = new THREE.MeshLambertMaterial({ color: readColor(THREE, '--ground-3d'), side: THREE.DoubleSide });
  const stairMat = new THREE.MeshLambertMaterial({ color: readColor(THREE, '--stair'), side: THREE.DoubleSide });
  const furnMat = {
    wood: patchDrop(new THREE.MeshLambertMaterial({ color: 0xffffff }), uDrop),
    fabric: patchDrop(new THREE.MeshLambertMaterial({ color: 0xffffff }), uDrop),
    metal: patchDrop(new THREE.MeshLambertMaterial({ color: 0xffffff }), uDrop),
    leaf: patchDrop(new THREE.MeshLambertMaterial({ color: 0xffffff }), uDrop),
  };
  const overlayMat = new THREE.MeshLambertMaterial({
    color: readColor(THREE, '--night-accent'),
    emissive: readColor(THREE, '--night-accent'),
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const overlay = new THREE.Mesh(unitBox, overlayMat);
  overlay.name = 'selection';
  overlay.visible = false;
  overlay.castShadow = false;
  overlay.receiveShadow = false;
  overlay.userData.casts = false;
  overlay.raycast = () => {};
  building.add(overlay);

  const wallColor = {
    bearing: readColor(THREE, '--wall-bearing'),
    exterior: readColor(THREE, '--wall'),
    interior: readColor(THREE, '--wall-interior'),
  };
  const woodColor = readColor(THREE, '--leaf-wood');
  const glassColor = readColor(THREE, '--glass');

  // OrbitControls reads the camera inside its constructor. Park the oblique
  // pose first, then put it back: the constructor aims at the origin and
  // would otherwise leave the bird's-eye framing.
  let controls = null;
  applyPose(enterPose(ENTER_MS, reduced));
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 0.4;
  controls.maxDistance = 400;
  controls.enabled = false;
  applyPose(enterPose(ENTER_MS, reduced));
  let suppressControl = false;
  controls.addEventListener('change', () => {
    if (suppressControl || transitioning || walking) return;
    requestRender();
  });

  const floors = new Map();
  const floorVisible = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const parkMatrix = new THREE.Matrix4().fromArray(PARK);
  const upVec = new THREE.Vector3(0, 1, 0);
  const fwdVec = new THREE.Vector3();
  const rightVec = new THREE.Vector3();

  let currentFloorId = options.floorId ?? null;
  let cutaway = false;
  let walking = false;
  let transitioning = false;
  let entered = false;
  let disposed = false;
  let capturing = false;
  let selectedId = null;
  let raf = 0;
  let mode = '';
  let animResolve = null;
  let animToken = 0;
  let frames = 0;
  let lastFrameAt = 0;
  let lastCalls = 0;
  let lastTriangles = 0;
  let lastGeometries = 0;
  let lastTextures = 0;
  let furnitureBuilds = 0;
  let lastBuildMs = 0;
  let walkFloorId = null;
  let segments = [];
  let yaw = 0;
  let pitch = 0;
  let lookDx = 0;
  let lookDy = 0;
  let walkRaf = 0;
  let lastWalkT = 0;
  let dragging = false;
  let savedCam = null;
  const held = new Set();

  uHeightCap.value = 100;
  applyPose(enterPose(0, reduced));
  applySize();

  const resizeObserver = new ResizeObserver(() => {
    if (capturing || disposed) return;
    applySize();
    requestRender();
  });
  if (container) resizeObserver.observe(container);

  let pointerDown = null;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function prepare() {
    syncFloors();
    for (const id of [...floors.keys()]) ensureBuilt(id);
    fitShadow();
    applySize();
  }

  function enter({ animate = true } = {}) {
    if (disposed) return Promise.resolve();
    const token = ++animToken;
    if (walking) exitWalk();
    cancelAnim();
    prepare();
    if (!animate) {
      applyPose(enterPose(ENTER_MS, reduced));
      controls.enabled = true;
      syncControls();
      renderFrame();
      entered = true;
      return Promise.resolve();
    }
    return play(token, 'enter').then(() => {
      if (token === animToken) entered = true;
    });
  }

  function exit({ animate = true } = {}) {
    if (disposed) return Promise.resolve();
    const token = ++animToken;
    if (walking) exitWalk();
    cancelAnim();
    if (!animate) {
      applyPose(exitPose(EXIT_MS, reduced));
      controls.enabled = false;
      renderFrame();
      entered = false;
      return Promise.resolve();
    }
    return play(token, 'exit').then(() => {
      if (token === animToken) entered = false;
    });
  }

  function play(token, kind) {
    transitioning = true;
    controls.enabled = false;
    const dur = reduced ? REDUCED_MS : (kind === 'enter' ? ENTER_MS : EXIT_MS);
    const t0 = performance.now();
    applyPose(kind === 'enter' ? enterPose(0, reduced) : exitPose(0, reduced));
    renderFrame();
    return new Promise((resolve) => {
      animResolve = resolve;
      const step = (now) => {
        if (animResolve !== resolve || token !== animToken) return;
        const elapsed = now - t0;
        const pose = kind === 'enter'
          ? enterPose(Math.min(elapsed, dur), reduced)
          : exitPose(Math.min(elapsed, dur), reduced);
        applyPose(pose);
        renderFrame();
        if (elapsed >= dur) {
          transitioning = false;
          mode = '';
          raf = 0;
          animResolve = null;
          if (kind === 'enter') {
            controls.enabled = true;
            syncControls();
          } else {
            controls.enabled = false;
          }
          resolve();
          return;
        }
        mode = 'anim';
        raf = requestAnimationFrame(step);
      };
      mode = 'anim';
      raf = requestAnimationFrame(step);
    });
  }

  function update(change) {
    if (disposed || !change || change.kind === 'meta') return;
    if (change.kind === 'furniture') {
      syncFloors();
      const id = change.floorId;
      const rec = floors.get(id);
      if (!rec) return;
      const ids = [...new Set(change.ids || [])];
      if (!rec.built) {
        ensureBuilt(id);
        const t0 = performance.now();
        patchItems(rec, ids);
        lastBuildMs = performance.now() - t0;
      } else {
        patchItems(rec, ids);
      }
      requestRender();
      return;
    }
    if (change.kind === 'structure') {
      syncFloors();
      const rec = floors.get(change.floorId);
      if (rec) {
        buildStatic(rec);
        reconcileFurniture(rec);
        rec.built = true;
        if (walking && walkFloorId === rec.id) {
          segments = collisionSegments(getFloor(getPlan(), rec.id) || {});
        }
      }
      fitShadow();
      requestRender();
      return;
    }
    if (change.kind === 'full') {
      syncFloors();
      for (const rec of floors.values()) {
        buildStatic(rec);
        reconcileFurniture(rec);
        rec.built = true;
      }
      fitShadow();
      if (!walking) {
        applyPose(enterPose(entered ? ENTER_MS : 0, reduced));
        if (entered) syncControls();
      }
      requestRender();
    }
  }

  function setCurrentFloor(floorId) {
    currentFloorId = floorId;
  }

  function setFloorVisible(floorId, visible) {
    floorVisible.set(floorId, !!visible);
    const rec = floors.get(floorId);
    if (rec) applyVisibility(rec);
    requestRender();
  }

  function select(id) {
    selectedId = id || null;
    if (!selectedId) {
      overlay.visible = false;
      requestRender();
      return;
    }
    const found = findItem(selectedId);
    if (!found) {
      overlay.visible = false;
      requestRender();
      return;
    }
    const { floor, item } = found;
    const rec = floors.get(floor.id);
    const origin = rec?.model ? floorOffsetM(rec.model.rooms, item.cx, item.cy) : 0;
    const h = (item.h ?? 750) / 1000;
    const z = (item.z ?? 0) / 1000;
    const baseY = (floor.elevation ?? 0) / 1000 + origin + z + h / 2;
    overlay.scale.set(
      Math.max((item.w || 100) / 1000, 0.05) * 1.04,
      Math.max(h, 0.05) * 1.04,
      Math.max((item.d || 100) / 1000, 0.05) * 1.04,
    );
    overlay.rotation.set(0, -((item.rot || 0) * Math.PI) / 180, 0);
    overlay.userData.baseY = baseY;
    overlay.position.set((item.cx || 0) / 1000, baseY + uDrop.value, (item.cy || 0) / 1000);
    overlay.visible = true;
    requestRender();
  }

  function setCutaway(on) {
    cutaway = !!on;
    uHeightCap.value = cutaway ? CUTAWAY_M : 100;
    requestRender();
  }

  function enterWalk() {
    if (disposed || walking) return;
    if (transitioning) {
      animToken += 1;
      cancelAnim();
      applyPose(enterPose(ENTER_MS, reduced));
    }
    savedCam = {
      pos: camera.position.clone(),
      target: controls.target.clone(),
      up: camera.up.clone(),
    };
    const plan = getPlan() || {};
    const start = resolveWalkStart(plan, currentFloorId);
    walkFloorId = start.floorId;
    const floor = getFloor(plan, walkFloorId);
    segments = floor ? collisionSegments(floor) : [];
    yaw = ((start.yaw || 0) * Math.PI) / 180;
    pitch = 0;
    camera.position.set((start.x || 0) / 1000, (start.elevation || 0) / 1000 + EYE_M, (start.y || 0) / 1000);
    applyLook();
    controls.enabled = false;
    walking = true;
    lookDx = 0;
    lookDy = 0;
    renderFrame();
  }

  function exitWalk() {
    if (!walking) return;
    walking = false;
    held.clear();
    dragging = false;
    if (walkRaf) cancelAnimationFrame(walkRaf);
    walkRaf = 0;
    if (mode === 'walk') mode = '';
    if (savedCam) {
      camera.position.copy(savedCam.pos);
      camera.up.copy(savedCam.up);
      controls.target.copy(savedCam.target);
      camera.lookAt(savedCam.target);
      if (savedCam.up.y > 0.5) {
        controls.enabled = true;
        syncControls();
      }
    }
    savedCam = null;
    renderFrame();
  }

  function requestRender() {
    if (disposed) return;
    if (mode === 'anim' || mode === 'walk' || mode === 'once') return;
    mode = 'once';
    raf = requestAnimationFrame(() => {
      raf = 0;
      mode = '';
      if (!disposed) renderFrame();
    });
  }

  function resize() {
    applySize();
    requestRender();
  }

  function renderInfo() {
    const info = {
      calls: lastCalls,
      triangles: lastTriangles,
      geometries: lastGeometries,
      textures: lastTextures,
      frames,
      lastFrameAt,
      furnitureBuilds,
      lastBuildMs,
      floors: {},
    };
    for (const [id, rec] of floors) {
      info.floors[id] = {
        visible: !!rec.group.visible,
        calls: rec.group.visible ? estimateCalls(rec.group) : 0,
      };
    }
    return info;
  }

  function toPNG({ longEdge = 1600 } = {}) {
    const edge = Math.max(2, Math.min(4096, Number(longEdge) || 1600));
    const viewW = Math.max(1, container.clientWidth || canvas.width || 1);
    const viewH = Math.max(1, container.clientHeight || canvas.height || 1);
    const aspect = viewW / viewH;
    let w;
    let h;
    if (aspect >= 1) {
      w = edge;
      h = Math.max(2, Math.round(edge / aspect));
    } else {
      h = edge;
      w = Math.max(2, Math.round(edge * aspect));
    }
    capturing = true;
    const pr = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.finish();
    const dw = canvas.width;
    const dh = canvas.height;
    const pixels = new Uint8Array(dw * dh * 4);
    gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    noteFrame();
    const png = encodePNG(flipY(pixels, dw, dh), dw, dh);
    renderer.setPixelRatio(pr);
    camera.aspect = prevAspect;
    applySize();
    capturing = false;
    requestRender();
    return Promise.resolve(new Blob([png], { type: 'image/png' }));
  }

  function resetView() {
    if (disposed) return;
    if (walking) exitWalk();
    animToken += 1;
    cancelAnim();
    applyPose(enterPose(ENTER_MS, reduced));
    controls.enabled = true;
    syncControls();
    entered = true;
    requestRender();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    animToken += 1;
    cancelAnim();
    if (walkRaf) cancelAnimationFrame(walkRaf);
    walking = false;
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    for (const id of [...floors.keys()]) destroyRecord(id);
    unitBox.dispose();
    unitCyl.dispose();
    controls.dispose();
    renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  function debugState() {
    camera.getWorldDirection(fwdVec);
    const flat = fwdVec.clone();
    flat.y = 0;
    if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0);
    else flat.normalize();
    const right = new THREE.Vector3().crossVectors(flat, upVec);
    const listed = [];
    for (const [id, rec] of floors) {
      listed.push({
        id,
        visible: rec.group.visible,
        elevation: rec.group.position.y,
        children: rec.group.children.map((child) => child.name),
      });
    }
    return {
      walking,
      selectedId,
      floorId: currentFloorId,
      walkFloorId,
      camera: camera.position.toArray(),
      target: controls.target.toArray(),
      up: camera.up.toArray(),
      forward: [fwdVec.x, fwdVec.y, fwdVec.z],
      flatForward: flat.toArray(),
      right: right.toArray(),
      yaw,
      pitch,
      floors: listed,
      cutaway,
      entered,
    };
  }

  function debugRay(ox, oy, oz, dx, dy, dz) {
    raycaster.set(
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(dx, dy, dz).normalize(),
    );
    raycaster.far = Infinity;
    const hits = raycaster.intersectObject(building, true);
    return hits.slice(0, 12).map((hit) => ({
      name: hit.object.name || '',
      kind: hit.object.userData.kind || '',
      floorId: hit.object.userData.floorId || null,
      distance: hit.distance,
      point: [hit.point.x, hit.point.y, hit.point.z],
    }));
  }

  function debugProject(xMm, yMm, yMeters = 0) {
    const v = new THREE.Vector3((Number(xMm) || 0) / 1000, Number(yMeters) || 0, (Number(yMm) || 0) / 1000);
    camera.updateMatrixWorld(true);
    v.project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z >= -1 && v.z <= 1,
    };
  }

  function syncFloors() {
    const plan = getPlan() || {};
    const seen = new Set();
    for (const floor of plan.floors || []) {
      if (!floor || floor.id == null) continue;
      seen.add(floor.id);
      let rec = floors.get(floor.id);
      if (!rec) {
        rec = createRecord(floor);
        floors.set(floor.id, rec);
        building.add(rec.group);
      }
      rec.group.position.y = (floor.elevation ?? 0) / 1000;
      applyVisibility(rec);
    }
    for (const id of [...floors.keys()]) {
      if (!seen.has(id)) destroyRecord(id);
    }
    if (currentFloorId == null) {
      let best = null;
      for (const floor of plan.floors || []) {
        if (!floor) continue;
        if (!best) best = floor;
        else {
          const de = (floor.elevation ?? 0) - (best.elevation ?? 0);
          if (de < 0 || (de === 0 && String(floor.id) < String(best.id))) best = floor;
        }
      }
      if (best) currentFloorId = best.id;
    }
  }

  function createRecord(floor) {
    const group = new THREE.Group();
    group.name = String(floor.id);
    group.position.y = (floor.elevation ?? 0) / 1000;
    group.userData.floorId = floor.id;
    const slab = namedGroup(THREE, 'slab');
    const walls = namedGroup(THREE, 'walls');
    const openings = namedGroup(THREE, 'openings');
    const furniture = namedGroup(THREE, 'furniture');
    const stairs = namedGroup(THREE, 'stairs');
    group.add(slab, walls, openings, furniture, stairs);
    const baseRaycast = group.raycast.bind(group);
    group.raycast = function raycast(raycasterArg, intersects) {
      if (!this.visible) return false;
      return baseRaycast(raycasterArg, intersects);
    };
    return {
      id: floor.id,
      group,
      slab,
      walls,
      openings,
      furniture,
      stairs,
      buckets: new Map(),
      itemSlots: new Map(),
      openIds: new Set(),
      model: null,
      built: false,
    };
  }

  function ensureBuilt(id) {
    const rec = floors.get(id);
    if (!rec || rec.built) return rec;
    buildStatic(rec);
    reconcileFurniture(rec);
    rec.built = true;
    return rec;
  }

  function buildStatic(rec) {
    const plan = getPlan();
    rec.model = composeFloor(plan, rec.id);
    rec.group.position.y = rec.model.elevationM;
    emptyGroup(rec.slab);
    emptyGroup(rec.walls);
    emptyGroup(rec.openings);
    emptyGroup(rec.stairs);
    fillGroundAndRooms(rec);
    fillWalls(rec);
    fillLeaves(rec);
    fillStairs(rec);
    applyVisibility(rec);
  }

  function fillGroundAndRooms(rec) {
    const model = rec.model;
    if (model.isGround) {
      const bounds = planBoundsMm(getPlan());
      const cx = (bounds.minX + bounds.maxX) / 2 / 1000;
      const cz = (bounds.minY + bounds.maxY) / 2 / 1000;
      const reach = (camera.far || 2000) + (controls.maxDistance || 400);
      const geo = new THREE.PlaneGeometry(reach * 2, reach * 2);
      geo.rotateX(-Math.PI / 2);
      geo.translate(cx, -0.02, cz);
      const mesh = new THREE.Mesh(geo, groundMat);
      mesh.name = 'ground';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.casts = false;
      mesh.userData.kind = 'ground';
      mesh.userData.floorId = rec.id;
      rec.slab.add(mesh);
    } else if (model.slabPolys.length) {
      const geos = [];
      for (const poly of model.slabPolys) {
        const geo = extrudePoly(THREE, poly, model.slabThicknessM);
        if (geo) geos.push(geo);
      }
      const merged = mergeList(geos);
      if (merged) {
        const mesh = new THREE.Mesh(merged, slabMat);
        mesh.name = 'slab-mesh';
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.casts = false;
        mesh.userData.kind = 'slab';
        mesh.userData.floorId = rec.id;
        rec.slab.add(mesh);
      }
    }
    const roomGeos = [];
    for (const surface of model.rooms) {
      try {
        const shape = toShape(THREE, surface);
        const geo = new THREE.ShapeGeometry(shape);
        if (!geo.getAttribute('position') || geo.getAttribute('position').count < 3) {
          geo.dispose();
          continue;
        }
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, (surface.floorOffsetMm || 0) / 1000 + 0.008, 0);
        stampColor(THREE, geo, readColor(THREE, surface.token));
        roomGeos.push(geo);
      } catch (err) {
        /* skip a face the triangulator cannot close */
      }
    }
    const roomsMerged = mergeList(roomGeos);
    if (roomsMerged) {
      const mesh = new THREE.Mesh(roomsMerged, roomMat);
      mesh.name = 'room-floors';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.casts = false;
      mesh.userData.kind = 'rooms';
      mesh.userData.floorId = rec.id;
      rec.slab.add(mesh);
    }
  }

  function fillWalls(rec) {
    const geos = [];
    const bake = {
      face: paintFace,
      shade: paintShade,
      sun: sunDir(),
      lift: uWallLift.value,
      factor: wallFactor,
      section: wallFactor(0, 0),
    };
    for (const piece of rec.model.wallPieces) {
      const geo = orientedBox(
        THREE,
        piece.cx / 1000,
        ((piece.z0 + piece.z1) / 2) / 1000,
        piece.cy / 1000,
        piece.length / 1000,
        piece.height / 1000,
        piece.thickness / 1000,
        piece.rotDeg,
      );
      const cap = piece.bearing ? wallColor.bearing : wallColor.exterior;
      stampWallPaint(THREE, geo, cap, bake);
      stampClipOnly(THREE, geo, piece.startSec, piece.riseSec, piece.fullHeight / 1000);
      geos.push(geo);
    }
    const merged = mergeList(geos);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, wallMat);
    mesh.name = 'wall-mesh';
    mesh.customDepthMaterial = depthMat;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.casts = true;
    mesh.userData.kind = 'walls';
    mesh.userData.floorId = rec.id;
    rec.walls.add(mesh);
  }

  function fillLeaves(rec) {
    const solids = [];
    const glass = [];
    const solidIds = [];
    for (const leaf of rec.model.leaves) {
      const open = leaf.mode !== 'glass' && rec.openIds.has(leaf.id);
      const pose = leafPose(leaf, open);
      const geo = orientedBox(
        THREE,
        pose.cx / 1000,
        ((leaf.z0 + leaf.z1) / 2) / 1000,
        pose.cy / 1000,
        leaf.length / 1000,
        (leaf.z1 - leaf.z0) / 1000,
        leaf.thickness / 1000,
        pose.rotDeg,
      );
      const tint = leaf.mode === 'glass' ? glassColor : woodColor;
      stampClipAttrs(THREE, geo, tint, leaf.startSec, leaf.riseSec, leaf.fullHeight / 1000);
      if (leaf.mode === 'glass') glass.push(geo);
      else {
        solids.push(geo);
        solidIds.push(leaf.id);
      }
    }
    const solidMerged = mergeList(solids);
    if (solidMerged) {
      const mesh = new THREE.Mesh(solidMerged, doorMat);
      mesh.name = 'leaves';
      mesh.customDepthMaterial = depthMat;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.userData.casts = true;
      mesh.userData.kind = 'leaf';
      mesh.userData.floorId = rec.id;
      mesh.userData.leafIds = solidIds;
      rec.openings.add(mesh);
    }
    const glassMerged = mergeList(glass);
    if (glassMerged) {
      const mesh = new THREE.Mesh(glassMerged, glassMat);
      mesh.name = 'glass';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.casts = false;
      mesh.userData.kind = 'glass';
      mesh.userData.floorId = rec.id;
      rec.openings.add(mesh);
    }
  }

  function fillStairs(rec) {
    for (const stair of rec.model.stairs) {
      const geos = [];
      for (const box of stair.boxes) {
        if (!(box.length > 0) || !(box.width > 0) || !(box.z1 > box.z0)) continue;
        geos.push(orientedBox(
          THREE,
          box.cx / 1000,
          ((box.z0 + box.z1) / 2) / 1000,
          box.cy / 1000,
          box.length / 1000,
          (box.z1 - box.z0) / 1000,
          box.width / 1000,
          box.rotDeg,
        ));
      }
      for (const landing of stair.landings || []) {
        const thick = Math.max((landing.y1 - landing.y0) / 1000, 0.02);
        const geo = extrudePoly(THREE, landing, thick);
        if (!geo) continue;
        geo.translate(0, landing.y0 / 1000, 0);
        geos.push(geo);
      }
      const merged = mergeList(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, stairMat);
      mesh.name = `stair-${stair.id}`;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.userData.casts = true;
      mesh.userData.kind = 'stairs';
      mesh.userData.floorId = rec.id;
      rec.stairs.add(mesh);
    }
  }

  function reconcileFurniture(rec) {
    const floor = getFloor(getPlan(), rec.id);
    const items = floor?.furniture || [];
    const keep = new Set(items.map((item) => item.id));
    for (const id of [...rec.itemSlots.keys()]) {
      if (!keep.has(id)) releaseItem(rec, id);
    }
    for (const item of items) syncItem(rec, item);
  }

  function patchItems(rec, ids) {
    const floor = getFloor(getPlan(), rec.id);
    const byId = new Map((floor?.furniture || []).map((item) => [item.id, item]));
    const t0 = performance.now();
    for (const id of ids) {
      const item = byId.get(id);
      if (item) syncItem(rec, item);
      else releaseItem(rec, id);
    }
    furnitureBuilds += ids.length;
    lastBuildMs = performance.now() - t0;
  }

  function syncItem(rec, item) {
    releaseItem(rec, item.id);
    const shape = shapeForType(item.type);
    const parts = partsForShape(shape);
    const origin = rec.model ? floorOffsetM(rec.model.rooms, item.cx, item.cy) : 0;
    const slots = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const bucket = ensureBucket(rec, shape, i, part);
      const slot = bucket.alloc.acquire();
      growIfNeeded(bucket, slot);
      tmpMatrix.fromArray(partMatrix(item, part, origin));
      bucket.mesh.setMatrixAt(slot, tmpMatrix);
      paintItem(item.color);
      bucket.mesh.setColorAt(slot, tmpColor);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
      bucket.slotToId.set(slot, item.id);
      bucket.mesh.count = bucket.alloc.highWater;
      bucket.mesh.boundingSphere = null;
      slots.push({ key: bucket.key, slot });
    }
    rec.itemSlots.set(item.id, slots);
    if (selectedId === item.id) select(item.id);
  }

  function releaseItem(rec, id) {
    const slots = rec.itemSlots.get(id);
    if (!slots) return;
    for (const entry of slots) {
      const bucket = rec.buckets.get(entry.key);
      if (!bucket) continue;
      bucket.alloc.release(entry.slot);
      bucket.slotToId.delete(entry.slot);
      bucket.mesh.setMatrixAt(entry.slot, parkMatrix);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      bucket.mesh.boundingSphere = null;
    }
    rec.itemSlots.delete(id);
  }

  function ensureBucket(rec, shape, partIndex, part) {
    const key = `${shape}:${partIndex}`;
    let bucket = rec.buckets.get(key);
    if (bucket) return bucket;
    const geo = part.geo === 'cyl' ? unitCyl : unitBox;
    const mat = furnMat[part.material] || furnMat.wood;
    const mesh = new THREE.InstancedMesh(geo, mat, 8);
    mesh.count = 0;
    mesh.name = `item-${shape}-${partIndex}`;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.casts = true;
    mesh.userData.sharedGeo = true;
    bucket = {
      key,
      floorId: rec.id,
      mesh,
      alloc: createSlotAllocator(),
      slotToId: new Map(),
    };
    decorateInstance(mesh, bucket);
    rec.buckets.set(key, bucket);
    rec.furniture.add(mesh);
    return bucket;
  }

  function growIfNeeded(bucket, slot) {
    const mesh = bucket.mesh;
    if (slot < mesh.instanceMatrix.count) return;
    let cap = mesh.instanceMatrix.count || 8;
    while (cap <= slot) cap *= 2;
    const next = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
    next.count = mesh.count;
    next.frustumCulled = false;
    next.castShadow = mesh.castShadow;
    next.receiveShadow = true;
    next.name = mesh.name;
    next.userData.casts = true;
    next.userData.sharedGeo = true;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, m);
      next.setMatrixAt(i, m);
      if (mesh.instanceColor) {
        mesh.getColorAt(i, c);
        next.setColorAt(i, c);
      }
    }
    next.instanceMatrix.needsUpdate = true;
    if (next.instanceColor) next.instanceColor.needsUpdate = true;
    decorateInstance(next, bucket);
    if (mesh.parent) {
      mesh.parent.add(next);
      mesh.parent.remove(mesh);
    } else {
      bucketFloorGroup(bucket).add(next);
    }
    mesh.dispose();
    bucket.mesh = next;
  }

  function bucketFloorGroup(bucket) {
    const rec = floors.get(bucket.floorId);
    return rec ? rec.furniture : building;
  }

  function decorateInstance(mesh, bucket) {
    const base = THREE.InstancedMesh.prototype.raycast;
    mesh.raycast = function raycast(raycasterArg, intersects) {
      const before = intersects.length;
      base.call(this, raycasterArg, intersects);
      for (let i = intersects.length - 1; i >= before; i -= 1) {
        if (!bucket.slotToId.has(intersects[i].instanceId)) intersects.splice(i, 1);
      }
    };
    mesh.userData.kind = 'furniture';
    mesh.userData.floorId = bucket.floorId;
    mesh.userData.bucket = bucket;
    mesh.frustumCulled = false;
  }

  function paintItem(color) {
    const fallback = '#c4b6a2';
    try {
      tmpColor.setStyle(color || fallback);
    } catch (err) {
      tmpColor.set(fallback);
    }
  }

  function applyVisibility(rec) {
    const vis = floorVisible.get(rec.id) !== false;
    rec.group.visible = vis;
    rec.group.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = !!(shadows && vis && obj.userData.casts !== false);
    });
  }

  function emptyGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.geometry && !child.userData.sharedGeo) child.geometry.dispose();
    }
  }

  function destroyRecord(id) {
    const rec = floors.get(id);
    if (!rec) return;
    for (const group of [rec.slab, rec.walls, rec.openings, rec.stairs, rec.furniture]) {
      for (const child of [...group.children]) {
        group.remove(child);
        if (child.geometry && !child.userData.sharedGeo) child.geometry.dispose();
        if (child.isInstancedMesh) child.dispose();
      }
    }
    building.remove(rec.group);
    floors.delete(id);
  }

  function mergeList(geos) {
    if (!geos.length) return null;
    if (geos.length === 1) {
      geos[0].computeBoundingSphere();
      return geos[0];
    }
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    if (merged) merged.computeBoundingSphere();
    return merged;
  }

  function sunDir() {
    const plan = getPlan() || {};
    const bounds = planBoundsMm(plan);
    const top = buildingTopMm(plan) / 1000;
    const w = Math.max(0.5, (bounds.maxX - bounds.minX) / 1000);
    const d = Math.max(0.5, (bounds.maxY - bounds.minY) / 1000);
    const span = Math.max(w, d) * 0.72 + 0.8;
    const dx = w * 0.2;
    const dy = top + Math.max(8, span) - Math.min(top * 0.35, 1.5);
    const dz = d * 0.45;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  function fitShadow() {
    const plan = getPlan() || {};
    const bounds = planBoundsMm(plan);
    const top = buildingTopMm(plan) / 1000;
    const cx = (bounds.minX + bounds.maxX) / 2 / 1000;
    const cz = (bounds.minY + bounds.maxY) / 2 / 1000;
    const w = Math.max(0.5, (bounds.maxX - bounds.minX) / 1000);
    const d = Math.max(0.5, (bounds.maxY - bounds.minY) / 1000);
    const span = Math.max(w, d) * 0.72 + 0.8;
    sun.position.set(cx + w * 0.2, top + Math.max(8, span), cz + d * 0.45);
    sun.target.position.set(cx, Math.min(top * 0.35, 1.5), cz);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.4;
    cam.far = top + span + 20;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
  }

  function currentFrame() {
    const plan = getPlan() || {};
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    return frameCamera(planBoundsMm(plan), buildingTopMm(plan), { aspect, fovDeg: camera.fov });
  }

  function applyPose(pose) {
    const frame = currentFrame();
    const cam = cameraPose(frame, pose.cameraT);
    camera.up.set(cam.up.x, cam.up.y, cam.up.z);
    camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
    if (controls) controls.target.set(cam.target.x, cam.target.y, cam.target.z);
    uTime.value = pose.wallTimeMs / 1000;
    uDrop.value = pose.furnitureDropM;
    canvas.style.opacity = String(pose.opacity);
    if (overlay.visible) overlay.position.y = (overlay.userData.baseY || 0) + pose.furnitureDropM;
  }

  function applyLook() {
    const cp = Math.cos(pitch);
    const fx = Math.cos(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = Math.sin(yaw) * cp;
    camera.up.set(0, 1, 0);
    camera.lookAt(camera.position.x + fx, camera.position.y + fy, camera.position.z + fz);
  }

  function syncControls() {
    suppressControl = true;
    controls.update();
    suppressControl = false;
  }

  function applySize() {
    const w = Math.max(1, container?.clientWidth || 1);
    const h = Math.max(1, container?.clientHeight || 1);
    renderer.setPixelRatio(pixelCap());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function renderFrame() {
    if (disposed) return;
    renderer.render(scene, camera);
    noteFrame();
  }

  function noteFrame() {
    lastCalls = renderer.info.render.calls;
    lastTriangles = renderer.info.render.triangles;
    lastGeometries = renderer.info.memory.geometries;
    lastTextures = renderer.info.memory.textures;
    frames += 1;
    lastFrameAt = performance.now();
  }

  function estimateCalls(group) {
    let n = 0;
    group.traverse((obj) => {
      if (!obj.isMesh || obj.visible === false) return;
      if (obj.isInstancedMesh && obj.count === 0) return;
      n += 1;
      if (shadows && obj.castShadow) n += 1;
    });
    return n;
  }

  function findItem(id) {
    const plan = getPlan() || {};
    for (const floor of plan.floors || []) {
      for (const item of floor.furniture || []) {
        if (item && item.id === id) return { floor, item };
      }
    }
    return null;
  }

  function toggleLeaf(floorId, leafId) {
    const rec = floors.get(floorId);
    if (!rec || !rec.model) return;
    const leaf = rec.model.leaves.find((item) => item.id === leafId);
    if (!leaf || leaf.mode === 'glass') return;
    if (rec.openIds.has(leafId)) rec.openIds.delete(leafId);
    else rec.openIds.add(leafId);
    emptyGroup(rec.openings);
    fillLeaves(rec);
    applyVisibility(rec);
    requestRender();
  }

  function onPointerDown(event) {
    if (walking) {
      dragging = true;
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(event.pointerId); } catch (err) { /* already captured */ }
      }
      return;
    }
    pointerDown = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event) {
    if (!walking || !dragging) return;
    lookDx += event.movementX || 0;
    lookDy += event.movementY || 0;
    kickWalk();
  }

  function onPointerUp(event) {
    if (walking) {
      dragging = false;
      return;
    }
    if (!pointerDown) return;
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > 16) return;
    const hit = pick(event.clientX, event.clientY);
    if (!hit) {
      onSelectFurniture(null);
      return;
    }
    if (hit.type === 'furniture') {
      onSelectFurniture(hit.id);
      return;
    }
    if (hit.type === 'leaf') toggleLeaf(hit.floorId, hit.id);
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(building, true);
    for (const hit of hits) {
      const kind = hit.object.userData.kind;
      if (kind === 'furniture') {
        const id = hit.object.userData.bucket?.slotToId.get(hit.instanceId);
        if (id) return { type: 'furniture', id };
      } else if (kind === 'leaf') {
        const index = Math.floor((hit.faceIndex || 0) / 12);
        const id = hit.object.userData.leafIds?.[index];
        if (id) return { type: 'leaf', id, floorId: hit.object.userData.floorId };
      }
    }
    return null;
  }

  function onKeyDown(event) {
    if (!walking) return;
    if (event.code === 'Escape') {
      exitWalk();
      return;
    }
    held.add(event.code);
    if (event.code.startsWith('Arrow')) event.preventDefault();
    kickWalk();
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function kickWalk() {
    if (!walking || walkRaf) return;
    lastWalkT = performance.now();
    mode = 'walk';
    walkRaf = requestAnimationFrame(walkFrame);
  }

  function walkFrame(now) {
    walkRaf = 0;
    if (!walking || disposed) {
      if (mode === 'walk') mode = '';
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - lastWalkT) / 1000));
    lastWalkT = now;
    let moved = false;
    if (lookDx || lookDy) {
      yaw += lookDx * 0.004;
      pitch -= lookDy * 0.004;
      if (pitch > 1.2) pitch = 1.2;
      if (pitch < -1.2) pitch = -1.2;
      lookDx = 0;
      lookDy = 0;
      moved = true;
    }
    applyLook();
    camera.getWorldDirection(fwdVec);
    fwdVec.y = 0;
    if (fwdVec.lengthSq() < 1e-8) fwdVec.set(1, 0, 0);
    else fwdVec.normalize();
    rightVec.crossVectors(fwdVec, upVec);
    let f = 0;
    let r = 0;
    if (held.has('KeyW') || held.has('ArrowUp')) f += 1;
    if (held.has('KeyS') || held.has('ArrowDown')) f -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) r += 1;
    if (held.has('KeyA') || held.has('ArrowLeft')) r -= 1;
    const mag = Math.hypot(f, r);
    if (mag > 0) {
      const scale = (WALK_SPEED_MPS * dt) / mag;
      const mx = (fwdVec.x * f + rightVec.x * r) * scale;
      const mz = (fwdVec.z * f + rightVec.z * r) * scale;
      const next = clipMove(
        camera.position.x * 1000,
        camera.position.z * 1000,
        mx * 1000,
        mz * 1000,
        WALK_RADIUS_M * 1000,
        segments,
      );
      camera.position.x = next.x / 1000;
      camera.position.z = next.y / 1000;
      applyLook();
      moved = true;
    }
    if (moved) {
      renderFrame();
      mode = 'walk';
      walkRaf = requestAnimationFrame(walkFrame);
    } else if (mode === 'walk') {
      mode = '';
    }
  }

  function cancelAnim() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (mode === 'anim' || mode === 'once') mode = '';
    transitioning = false;
    if (animResolve) {
      const done = animResolve;
      animResolve = null;
      done();
    }
  }

  return {
    enter,
    exit,
    update,
    setCurrentFloor,
    select,
    setCutaway,
    enterWalk,
    exitWalk,
    requestRender,
    renderInfo,
    toPNG,
    resetView,
    resize,
    dispose,
    setFloorVisible,
    debugState,
    debugRay,
    debugProject,
  };
}

function namedGroup(THREE, name) {
  const group = new THREE.Group();
  group.name = name;
  return group;
}

function patchWallPaint(material, uTime, uHeightCap, uWallLift) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uHeightCap = uHeightCap;
    shader.uniforms.uWallLift = uWallLift;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CLIP_VERT}\nattribute vec3 aCap;\nvarying vec3 vCap;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vLocalY = position.y;\n  vStart = aStart;\n  vRise = aRise;\n  vFullH = aFullH;\n  vCap = aCap;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLIP_FRAG}\nvarying vec3 vCap;\nuniform float uWallLift;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CLIP_DISCARD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WALL_SECTION}`);
  };
  material.customProgramCacheKey = () => 'hs-wall-paint-1';
}

function patchClip(material, uTime, uHeightCap) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uHeightCap = uHeightCap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CLIP_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vLocalY = position.y;\n  vStart = aStart;\n  vRise = aRise;\n  vFullH = aFullH;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLIP_FRAG}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CLIP_DISCARD}`);
  };
  material.customProgramCacheKey = () => 'hs-wall-clip-1';
}

function patchDrop(material, uDrop) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDrop = uDrop;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uDrop;')
      .replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_BATCHING',
        '  mvPosition = batchingMatrix * mvPosition;',
        '#endif',
        '#ifdef USE_INSTANCING',
        '  mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        'mvPosition.y += uDrop;',
        'mvPosition = modelViewMatrix * mvPosition;',
        'gl_Position = projectionMatrix * mvPosition;',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'hs-furn-drop-1';
  return material;
}

function orientedBox(THREE, cx, cy, cz, sx, sy, sz, rotDeg) {
  const geo = new THREE.BoxGeometry(
    Math.max(sx, 1e-4),
    Math.max(sy, 1e-4),
    Math.max(sz, 1e-4),
  );
  geo.rotateY((-rotDeg * Math.PI) / 180);
  geo.translate(cx, cy, cz);
  return geo;
}

function stampColor(THREE, geo, color) {
  const count = geo.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    data[i * 3] = color.r;
    data[i * 3 + 1] = color.g;
    data[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(data, 3));
}

function stampClipAttrs(THREE, geo, color, start, rise, fullH) {
  stampColor(THREE, geo, color);
  stampClipOnly(THREE, geo, start, rise, fullH);
}

function stampClipOnly(THREE, geo, start, rise, fullH) {
  const count = geo.getAttribute('position').count;
  geo.setAttribute('aStart', new THREE.Float32BufferAttribute(new Float32Array(count).fill(start), 1));
  geo.setAttribute('aRise', new THREE.Float32BufferAttribute(new Float32Array(count).fill(rise), 1));
  geo.setAttribute('aFullH', new THREE.Float32BufferAttribute(new Float32Array(count).fill(fullH), 1));
}

/** Per-vertex paint so Lambert lands on the latex colours. Cap stays dark. */
function stampWallPaint(THREE, geo, capColor, bake) {
  const normal = geo.getAttribute('normal');
  const count = geo.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  const caps = new Float32Array(count * 3);
  const section = bake.section;
  for (let i = 0; i < count; i += 1) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    let target = bake.shade;
    let ndot = 0;
    let up = 0;
    if (ny > 0.5) {
      target = capColor;
      ndot = bake.sun.y;
      up = 1;
    } else if (ny > -0.5) {
      const toward = nx * bake.sun.x + nz * bake.sun.z;
      target = toward > 0 ? bake.face : bake.shade;
      ndot = Math.max(0, toward);
    }
    const factor = bake.factor(ndot, up);
    const lift = bake.lift;
    color[i * 3] = clamp01(target.r / (lift * factor[0]));
    color[i * 3 + 1] = clamp01(target.g / (lift * factor[1]));
    color[i * 3 + 2] = clamp01(target.b / (lift * factor[2]));
    caps[i * 3] = clamp01(capColor.r / section[0]);
    caps[i * 3 + 1] = clamp01(capColor.g / section[1]);
    caps[i * 3 + 2] = clamp01(capColor.b / section[2]);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geo.setAttribute('aCap', new THREE.Float32BufferAttribute(caps, 3));
}

function clamp01(value) {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

/** Linear multiplier Lambert applies to diffuseColor for this NdotL / normal.y. */
function lambertFactor(ambient, hemi, sun, ndot, up) {
  const weight = 0.5 * up + 0.5;
  const out = [0, 0, 0];
  const keys = ['r', 'g', 'b'];
  for (let i = 0; i < 3; i += 1) {
    const key = keys[i];
    const irr = ambient.color[key] * ambient.intensity
      + (hemi.groundColor[key] * (1 - weight) + hemi.color[key] * weight) * hemi.intensity
      + Math.max(ndot, 0) * sun.color[key] * sun.intensity;
    out[i] = irr / Math.PI;
  }
  return out;
}

function skyBackdrop(THREE) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, cssToken('--sky-day-top'));
    gradient.addColorStop(1, cssToken('--sky-day-bottom'));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  } catch (err) {
    return readColor(THREE, '--sky-day-bottom');
  }
}

function cssToken(name) {
  const fallback = TOKEN_FALLBACK[name] || '#cccccc';
  try {
    const got = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (got) return got;
  } catch (err) {
    return fallback;
  }
  return fallback;
}

function toShape(THREE, poly) {
  let outer = ringToVec(THREE, poly.outer);
  if (outer.length >= 3 && THREE.ShapeUtils.isClockWise(outer)) outer = outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const hole of poly.holes || []) {
    let pts = ringToVec(THREE, hole);
    if (pts.length < 3) continue;
    if (!THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  return shape;
}

function ringToVec(THREE, ring) {
  const out = [];
  for (const p of ring || []) out.push(new THREE.Vector2(p.x / 1000, -p.y / 1000));
  return out;
}

function extrudePoly(THREE, poly, thickness) {
  try {
    if (!poly.outer || poly.outer.length < 3) return null;
    const shape = toShape(THREE, poly);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(thickness, 0.02), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -Math.max(thickness, 0.02), 0);
    return geo;
  } catch (err) {
    return null;
  }
}

function readColor(THREE, name) {
  const fallback = TOKEN_FALLBACK[name] || '#cccccc';
  let value = fallback;
  try {
    const got = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (got) value = got;
  } catch (err) {
    value = fallback;
  }
  const color = new THREE.Color();
  try {
    color.setStyle(value);
  } catch (err) {
    color.setStyle(fallback);
  }
  return color;
}

function pixelCap() {
  const cap = pointerCoarse() ? 1.5 : 2;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(dpr, cap);
}

function pointerCoarse() {
  try {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (err) {
    return false;
  }
}

function queryFlag(name) {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch (err) {
    return false;
  }
}

function flipY(pixels, width, height) {
  const stride = width * 4;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    out.set(pixels.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
  }
  return out;
}
