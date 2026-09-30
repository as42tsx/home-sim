/**
 * Zero-dependency plan validator (structure + referential semantics).
 * Ajv is a devDependency and is not used here, so the same checks run in the browser.
 * Issues use stable English codes, English messages, and JSON Pointer paths.
 * `NEWER_VERSION` is the exception: its message is the Chinese UI string 「请使用新版本」.
 */

import { SCHEMA_VERSION } from './constants.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const ROOM_TYPES = [
  'bedroom', 'living', 'dining', 'ldk', 'kitchen', 'bath', 'toilet', 'washroom',
  'balcony', 'corridor', 'entry', 'study', 'storage', 'closet', 'washitsu',
  'garage', 'loft', 'other',
];
const OPENING_KINDS = ['door', 'window', 'slide', 'shoji', 'fusuma', 'garage', 'bay'];
const TEMPLATES = ['apt-1br', 'apt-2br', 'apt-3br', 'jp-ikkodate', 'us-villa'];

const PLAN_KEYS = new Set(['schemaVersion', 'meta', 'floors', 'stairs', 'markers', 'ext']);
const META_KEYS = new Set(['id', 'name', 'createdAt', 'updatedAt', 'unit', 'displayUnit', 'codeset', 'template']);
const FLOOR_KEYS = new Set(['id', 'name', 'elevation', 'height', 'slab', 'ceiling', 'nodes', 'walls', 'openings', 'rooms', 'furniture', 'voids', 'ext']);
const NODE_KEYS = new Set(['id', 'x', 'y', 'ext']);
const WALL_KEYS = new Set(['id', 'a', 'b', 'thickness', 'height', 'bearing', 'exterior', 'demolished', 'finish', 'virtual', 'ext']);
const FINISH_KEYS = new Set(['left', 'right']);
const OPENING_KEYS = new Set(['id', 'wall', 't', 'kind', 'width', 'height', 'sill', 'hinge', 'swing', 'ext']);
const ROOM_KEYS = new Set(['id', 'name', 'type', 'floor', 'floorOffset', 'seed', 'ext']);
const SEED_KEYS = new Set(['x', 'y']);
const FURN_KEYS = new Set(['id', 'type', 'name', 'cx', 'cy', 'z', 'w', 'd', 'h', 'rot', 'color', 'host', 'ext']);
const HOST_KEYS = new Set(['wall', 'side']);
const VOID_KEYS = new Set(['id', 'poly', 'reason', 'ext']);
const STAIR_KEYS = new Set(['id', 'kind', 'from', 'to', 'x', 'y', 'rot', 'width', 'tread', 'maxRiser', 'landing', 'handrail', 'opening', 'turn', 'well', 'ext']);
const LANDING_KEYS = new Set(['at', 'size']);
const MARKER_KEYS = new Set(['walkStart']);
const WALK_KEYS = new Set(['floor', 'x', 'y', 'yaw']);

/**
 * @param {object} plan
 * @returns {{ path: string, code: string, message: string, severity: 'error'|'warning' }[]}
 */
export function validatePlan(plan) {
  /** @type {object[]} */
  const issues = [];
  const add = (path, code, message, severity = 'error') => {
    issues.push({ path, code, message, severity });
  };

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    add('', 'INVALID_TYPE', 'Plan must be an object');
    return issues;
  }

  rejectUnknown(plan, PLAN_KEYS, '', add);

  if (!Object.prototype.hasOwnProperty.call(plan, 'schemaVersion')) {
    add('/schemaVersion', 'UNSUPPORTED_VERSION', 'Unsupported plan version');
    return issues;
  }
  if (typeof plan.schemaVersion !== 'number' || !Number.isFinite(plan.schemaVersion)) {
    add('/schemaVersion', 'INVALID_TYPE', 'schemaVersion must be a number');
    return issues;
  }
  if (plan.schemaVersion > SCHEMA_VERSION) {
    add('/schemaVersion', 'NEWER_VERSION', '请使用新版本');
    return issues;
  }
  if (plan.schemaVersion !== SCHEMA_VERSION) {
    add('/schemaVersion', 'UNSUPPORTED_VERSION', 'Unsupported plan version');
    return issues;
  }

  const meta = plan.meta;
  if (!isObj(meta)) {
    add('/meta', meta === undefined ? 'REQUIRED' : 'INVALID_TYPE', 'meta is required');
  } else {
    rejectUnknown(meta, META_KEYS, '/meta', add);
    requireKeys(meta, ['id', 'name', 'createdAt', 'updatedAt', 'unit', 'displayUnit', 'codeset', 'template'], '/meta', add);
    checkId(meta.id, '/meta/id', add);
    checkString(meta.name, '/meta/name', add);
    checkInteger(meta.createdAt, '/meta/createdAt', add);
    checkInteger(meta.updatedAt, '/meta/updatedAt', add);
    if (meta.unit !== undefined && meta.unit !== 'mm') {
      add('/meta/unit', 'INVALID_ENUM', 'unit must be "mm"');
    }
    checkEnum(meta.displayUnit, ['metric', 'imperial'], '/meta/displayUnit', add);
    checkEnum(meta.codeset, ['cn', 'jp', 'us'], '/meta/codeset', add);
    if (meta.template !== undefined && meta.template !== null && !TEMPLATES.includes(meta.template)) {
      add('/meta/template', 'INVALID_ENUM', 'Unknown template id');
    }
  }

  if (!Array.isArray(plan.floors)) {
    add('/floors', plan.floors === undefined ? 'REQUIRED' : 'INVALID_TYPE', 'floors must be an array');
  } else if (plan.floors.length < 1) {
    add('/floors', 'REQUIRED', 'At least one floor is required');
  }

  if (!Array.isArray(plan.stairs)) {
    add('/stairs', plan.stairs === undefined ? 'REQUIRED' : 'INVALID_TYPE', 'stairs must be an array');
  }

  if (plan.markers !== undefined) {
    if (!isObj(plan.markers)) add('/markers', 'INVALID_TYPE', 'markers must be an object');
    else {
      rejectUnknown(plan.markers, MARKER_KEYS, '/markers', add);
      if (plan.markers.walkStart !== undefined) {
        const walk = plan.markers.walkStart;
        if (!isObj(walk)) add('/markers/walkStart', 'INVALID_TYPE', 'walkStart must be an object');
        else {
          rejectUnknown(walk, WALK_KEYS, '/markers/walkStart', add);
          requireKeys(walk, ['floor', 'x', 'y', 'yaw'], '/markers/walkStart', add);
          checkId(walk.floor, '/markers/walkStart/floor', add);
          checkNumber(walk.x, '/markers/walkStart/x', add);
          checkNumber(walk.y, '/markers/walkStart/y', add);
          checkNumber(walk.yaw, '/markers/walkStart/yaw', add);
        }
      }
    }
  }
  if (plan.ext !== undefined) checkExt(plan.ext, '/ext', add);

  /** @type {Map<string, string>} */
  const ids = new Map();
  const claim = (id, path) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) return;
    if (ids.has(id)) add(path, 'DUPLICATE_ID', `Duplicate id "${id}"`);
    else ids.set(id, path);
  };

  if (isObj(meta) && typeof meta.id === 'string') claim(meta.id, '/meta/id');

  const floors = Array.isArray(plan.floors) ? plan.floors : [];
  floors.forEach((floor, fi) => {
    const base = `/floors/${fi}`;
    if (!isObj(floor)) {
      add(base, 'INVALID_TYPE', 'Floor must be an object');
      return;
    }
    rejectUnknown(floor, FLOOR_KEYS, base, add);
    requireKeys(floor, ['id', 'name', 'elevation', 'height', 'slab', 'ceiling', 'nodes', 'walls', 'openings', 'rooms', 'furniture', 'voids'], base, add);
    checkId(floor.id, `${base}/id`, add);
    if (typeof floor.id === 'string') claim(floor.id, `${base}/id`);
    checkString(floor.name, `${base}/name`, add);
    checkNumber(floor.elevation, `${base}/elevation`, add);
    checkNumber(floor.height, `${base}/height`, add);
    if (typeof floor.height === 'number' && floor.height <= 0) {
      add(`${base}/height`, 'OUT_OF_RANGE', 'Floor height must be positive');
    }
    checkNumber(floor.slab, `${base}/slab`, add);
    if (typeof floor.slab === 'number' && floor.slab < 0) add(`${base}/slab`, 'OUT_OF_RANGE', 'Slab thickness must be >= 0');
    checkNumber(floor.ceiling, `${base}/ceiling`, add);
    if (typeof floor.ceiling === 'number' && floor.ceiling < 0) add(`${base}/ceiling`, 'OUT_OF_RANGE', 'Ceiling must be >= 0');
    checkExt(floor.ext, `${base}/ext`, add);

    const nodeById = new Map();
    if (!Array.isArray(floor.nodes)) add(`${base}/nodes`, 'INVALID_TYPE', 'nodes must be an array');
    else floor.nodes.forEach((node, ni) => {
      const p = `${base}/nodes/${ni}`;
      if (!isObj(node)) {
        add(p, 'INVALID_TYPE', 'Node must be an object');
        return;
      }
      rejectUnknown(node, NODE_KEYS, p, add);
      requireKeys(node, ['id', 'x', 'y'], p, add);
      checkId(node.id, `${p}/id`, add);
      if (typeof node.id === 'string') {
        claim(node.id, `${p}/id`);
        nodeById.set(node.id, node);
      }
      checkNumber(node.x, `${p}/x`, add);
      checkNumber(node.y, `${p}/y`, add);
      checkExt(node.ext, `${p}/ext`, add);
    });

    const wallById = new Map();
    if (!Array.isArray(floor.walls)) add(`${base}/walls`, 'INVALID_TYPE', 'walls must be an array');
    else floor.walls.forEach((wall, wi) => {
      const p = `${base}/walls/${wi}`;
      if (!isObj(wall)) {
        add(p, 'INVALID_TYPE', 'Wall must be an object');
        return;
      }
      rejectUnknown(wall, WALL_KEYS, p, add);
      requireKeys(wall, ['id', 'a', 'b', 'thickness', 'height', 'bearing', 'exterior', 'demolished', 'finish'], p, add);
      checkId(wall.id, `${p}/id`, add);
      if (typeof wall.id === 'string') {
        claim(wall.id, `${p}/id`);
        wallById.set(wall.id, wall);
      }
      checkId(wall.a, `${p}/a`, add);
      checkId(wall.b, `${p}/b`, add);
      if (typeof wall.a === 'string' && typeof wall.b === 'string') {
        if (wall.a === wall.b) add(p, 'WALL_DEGENERATE', 'Wall endpoints must differ');
        if (!nodeById.has(wall.a)) add(`${p}/a`, 'DANGLING_NODE', `Node "${wall.a}" is not on this floor`);
        if (!nodeById.has(wall.b)) add(`${p}/b`, 'DANGLING_NODE', `Node "${wall.b}" is not on this floor`);
      }
      checkNumber(wall.thickness, `${p}/thickness`, add);
      if (typeof wall.thickness === 'number' && (wall.thickness < 60 || wall.thickness > 500)) {
        add(`${p}/thickness`, 'OUT_OF_RANGE', 'Wall thickness must be between 60 and 500 mm');
      }
      if (wall.height !== undefined && wall.height !== null && (typeof wall.height !== 'number' || !Number.isFinite(wall.height))) {
        add(`${p}/height`, 'INVALID_TYPE', 'Wall height must be a number or null');
      }
      checkBool(wall.bearing, `${p}/bearing`, add);
      checkBool(wall.exterior, `${p}/exterior`, add);
      checkBool(wall.demolished, `${p}/demolished`, add);
      if (wall.virtual !== undefined && typeof wall.virtual !== 'boolean') {
        add(`${p}/virtual`, 'INVALID_TYPE', 'virtual must be a boolean');
      }
      if (wall.virtual === true && wall.bearing === true) {
        add(p, 'VIRTUAL_BEARING', 'A virtual separator cannot be bearing');
      }
      if (wall.finish !== undefined) {
        if (!isObj(wall.finish)) add(`${p}/finish`, 'INVALID_TYPE', 'finish must be an object');
        else {
          rejectUnknown(wall.finish, FINISH_KEYS, `${p}/finish`, add);
          requireKeys(wall.finish, ['left', 'right'], `${p}/finish`, add);
          checkString(wall.finish.left, `${p}/finish/left`, add);
          checkString(wall.finish.right, `${p}/finish/right`, add);
        }
      }
      checkExt(wall.ext, `${p}/ext`, add);
    });

    if (!Array.isArray(floor.openings)) add(`${base}/openings`, 'INVALID_TYPE', 'openings must be an array');
    else floor.openings.forEach((op, oi) => {
      const p = `${base}/openings/${oi}`;
      if (!isObj(op)) {
        add(p, 'INVALID_TYPE', 'Opening must be an object');
        return;
      }
      rejectUnknown(op, OPENING_KEYS, p, add);
      requireKeys(op, ['id', 'wall', 't', 'kind', 'width', 'height', 'sill', 'hinge', 'swing'], p, add);
      checkId(op.id, `${p}/id`, add);
      if (typeof op.id === 'string') claim(op.id, `${p}/id`);
      checkId(op.wall, `${p}/wall`, add);
      checkNumber(op.t, `${p}/t`, add);
      if (typeof op.t === 'number' && (op.t < 0 || op.t > 1)) add(`${p}/t`, 'OUT_OF_RANGE', 'Opening t must be between 0 and 1');
      checkEnum(op.kind, OPENING_KINDS, `${p}/kind`, add);
      checkNumber(op.width, `${p}/width`, add);
      if (typeof op.width === 'number' && op.width <= 0) add(`${p}/width`, 'OUT_OF_RANGE', 'Opening width must be positive');
      checkNumber(op.height, `${p}/height`, add);
      if (typeof op.height === 'number' && op.height <= 0) add(`${p}/height`, 'OUT_OF_RANGE', 'Opening height must be positive');
      checkNumber(op.sill, `${p}/sill`, add);
      if (typeof op.sill === 'number' && op.sill < 0) add(`${p}/sill`, 'OUT_OF_RANGE', 'Sill must be >= 0');
      checkEnum(op.hinge, ['left', 'right'], `${p}/hinge`, add);
      checkEnum(op.swing, ['in', 'out'], `${p}/swing`, add);
      checkExt(op.ext, `${p}/ext`, add);

      if (typeof op.wall === 'string') {
        const local = wallById.get(op.wall);
        if (!local) {
          const elsewhere = wallLivesOnOtherFloor(floors, fi, op.wall);
          add(`${p}/wall`, elsewhere ? 'OPENING_WALL_FLOOR' : 'OPENING_WALL_MISSING',
            elsewhere ? `Opening wall "${op.wall}" belongs to another floor` : `Opening wall "${op.wall}" does not exist on this floor`);
        } else {
          if (local.virtual === true) add(p, 'OPENING_ON_VIRTUAL', 'Openings cannot sit on a virtual separator');
          const a = nodeById.get(local.a);
          const b = nodeById.get(local.b);
          if (a && b && typeof op.width === 'number') {
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (op.width > length + 1e-6) add(p, 'OPENING_TOO_WIDE', `Opening width ${op.width} mm exceeds wall length ${length} mm`);
          }
        }
      }
    });

    if (!Array.isArray(floor.rooms)) add(`${base}/rooms`, 'INVALID_TYPE', 'rooms must be an array');
    else floor.rooms.forEach((room, ri) => {
      const p = `${base}/rooms/${ri}`;
      if (!isObj(room)) {
        add(p, 'INVALID_TYPE', 'Room must be an object');
        return;
      }
      rejectUnknown(room, ROOM_KEYS, p, add);
      requireKeys(room, ['id', 'name', 'type', 'floor', 'seed'], p, add);
      checkId(room.id, `${p}/id`, add);
      if (typeof room.id === 'string') claim(room.id, `${p}/id`);
      checkString(room.name, `${p}/name`, add);
      checkEnum(room.type, ROOM_TYPES, `${p}/type`, add);
      checkString(room.floor, `${p}/floor`, add);
      if (room.floorOffset !== undefined) {
        checkNumber(room.floorOffset, `${p}/floorOffset`, add);
      }
      if (room.seed !== undefined) {
        if (!isObj(room.seed)) add(`${p}/seed`, 'INVALID_TYPE', 'seed must be an object');
        else {
          rejectUnknown(room.seed, SEED_KEYS, `${p}/seed`, add);
          requireKeys(room.seed, ['x', 'y'], `${p}/seed`, add);
          checkNumber(room.seed.x, `${p}/seed/x`, add);
          checkNumber(room.seed.y, `${p}/seed/y`, add);
        }
      }
      checkExt(room.ext, `${p}/ext`, add);
    });

    if (!Array.isArray(floor.furniture)) add(`${base}/furniture`, 'INVALID_TYPE', 'furniture must be an array');
    else floor.furniture.forEach((item, ii) => {
      const p = `${base}/furniture/${ii}`;
      if (!isObj(item)) {
        add(p, 'INVALID_TYPE', 'Furniture must be an object');
        return;
      }
      rejectUnknown(item, FURN_KEYS, p, add);
      requireKeys(item, ['id', 'type', 'name', 'cx', 'cy', 'z', 'w', 'd', 'color'], p, add);
      checkId(item.id, `${p}/id`, add);
      if (typeof item.id === 'string') claim(item.id, `${p}/id`);
      checkString(item.type, `${p}/type`, add);
      checkString(item.name, `${p}/name`, add);
      checkNumber(item.cx, `${p}/cx`, add);
      checkNumber(item.cy, `${p}/cy`, add);
      checkNumber(item.z, `${p}/z`, add);
      checkNumber(item.w, `${p}/w`, add);
      checkNumber(item.d, `${p}/d`, add);
      if (typeof item.w === 'number' && (item.w < 50 || item.w > 6000)) add(`${p}/w`, 'OUT_OF_RANGE', 'Furniture w must be between 50 and 6000 mm');
      if (typeof item.d === 'number' && (item.d < 50 || item.d > 6000)) add(`${p}/d`, 'OUT_OF_RANGE', 'Furniture d must be between 50 and 6000 mm');
      if (item.h !== undefined) checkNumber(item.h, `${p}/h`, add);
      if (item.rot !== undefined) checkNumber(item.rot, `${p}/rot`, add);
      if (item.color !== undefined && (typeof item.color !== 'string' || !COLOR_RE.test(item.color))) {
        add(`${p}/color`, 'BAD_COLOR', 'Color must be a #RRGGBB hex string');
      }
      if (item.host !== undefined) {
        if (!isObj(item.host)) add(`${p}/host`, 'INVALID_TYPE', 'host must be an object');
        else {
          rejectUnknown(item.host, HOST_KEYS, `${p}/host`, add);
          requireKeys(item.host, ['wall', 'side'], `${p}/host`, add);
          checkId(item.host.wall, `${p}/host/wall`, add);
          checkEnum(item.host.side, ['left', 'right'], `${p}/host/side`, add);
        }
      }
      checkExt(item.ext, `${p}/ext`, add);
    });

    if (!Array.isArray(floor.voids)) add(`${base}/voids`, 'INVALID_TYPE', 'voids must be an array');
    else floor.voids.forEach((hole, vi) => {
      const p = `${base}/voids/${vi}`;
      if (!isObj(hole)) {
        add(p, 'INVALID_TYPE', 'Void must be an object');
        return;
      }
      rejectUnknown(hole, VOID_KEYS, p, add);
      requireKeys(hole, ['id', 'poly', 'reason'], p, add);
      checkId(hole.id, `${p}/id`, add);
      if (typeof hole.id === 'string') claim(hole.id, `${p}/id`);
      checkEnum(hole.reason, ['double-height', 'stair', 'other'], `${p}/reason`, add);
      if (!Array.isArray(hole.poly) || hole.poly.length < 3) add(`${p}/poly`, 'OUT_OF_RANGE', 'Void polygon needs at least 3 points');
      else hole.poly.forEach((pt, pi) => {
        if (!Array.isArray(pt) || pt.length !== 2 || !pt.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          add(`${p}/poly/${pi}`, 'INVALID_TYPE', 'Void point must be [x, y]');
        }
      });
      checkExt(hole.ext, `${p}/ext`, add);
    });
  });

  for (let i = 0; i + 1 < floors.length; i += 1) {
    const a = floors[i];
    const b = floors[i + 1];
    if (!isObj(a) || !isObj(b)) continue;
    if (typeof a.elevation !== 'number' || typeof b.elevation !== 'number' || typeof a.height !== 'number') continue;
    if (b.elevation <= a.elevation) {
      add(`/floors/${i + 1}/elevation`, 'FLOORS_UNSORTED', 'Floors must be stored in ascending elevation');
    } else if (Math.abs(b.elevation - (a.elevation + a.height)) > 1) {
      add(`/floors/${i + 1}/elevation`, 'FLOOR_GAP', 'Next floor elevation should equal this elevation plus floor-to-floor height (tolerance 1 mm)', 'warning');
    }
  }

  const floorById = new Map();
  for (const floor of floors) {
    if (isObj(floor) && typeof floor.id === 'string') floorById.set(floor.id, floor);
  }

  if (Array.isArray(plan.stairs)) {
    plan.stairs.forEach((stair, si) => {
      const p = `/stairs/${si}`;
      if (!isObj(stair)) {
        add(p, 'INVALID_TYPE', 'Stair must be an object');
        return;
      }
      rejectUnknown(stair, STAIR_KEYS, p, add);
      requireKeys(stair, ['id', 'kind', 'from', 'to', 'x', 'y', 'rot', 'width', 'tread', 'maxRiser', 'handrail', 'opening'], p, add);
      checkId(stair.id, `${p}/id`, add);
      if (typeof stair.id === 'string') claim(stair.id, `${p}/id`);
      checkEnum(stair.kind, ['straight', 'L', 'U'], `${p}/kind`, add);
      checkId(stair.from, `${p}/from`, add);
      checkId(stair.to, `${p}/to`, add);
      checkNumber(stair.x, `${p}/x`, add);
      checkNumber(stair.y, `${p}/y`, add);
      checkNumber(stair.rot, `${p}/rot`, add);
      checkNumber(stair.width, `${p}/width`, add);
      checkNumber(stair.tread, `${p}/tread`, add);
      checkNumber(stair.maxRiser, `${p}/maxRiser`, add);
      if (typeof stair.width === 'number' && stair.width <= 0) add(`${p}/width`, 'OUT_OF_RANGE', 'Stair width must be positive');
      if (typeof stair.tread === 'number' && stair.tread <= 0) add(`${p}/tread`, 'OUT_OF_RANGE', 'Tread must be positive');
      if (typeof stair.maxRiser === 'number' && stair.maxRiser <= 0) add(`${p}/maxRiser`, 'OUT_OF_RANGE', 'maxRiser must be positive');
      checkEnum(stair.handrail, ['left', 'right', 'both'], `${p}/handrail`, add);
      if (stair.opening !== undefined && stair.opening !== 'auto') add(`${p}/opening`, 'INVALID_ENUM', 'Stair opening must be "auto"');
      if (stair.turn !== undefined) checkEnum(stair.turn, ['left', 'right'], `${p}/turn`, add);
      if (stair.well !== undefined) {
        checkNumber(stair.well, `${p}/well`, add);
        if (typeof stair.well === 'number' && stair.well < 0) add(`${p}/well`, 'OUT_OF_RANGE', 'Well gap must be >= 0');
      }
      const needsLanding = stair.kind === 'L' || stair.kind === 'U';
      if (needsLanding && (stair.landing === undefined || stair.landing === null)) {
        add(`${p}/landing`, 'REQUIRED', 'L and U stairs require a landing');
      }
      if (stair.landing !== undefined && stair.landing !== null) {
        if (!isObj(stair.landing)) add(`${p}/landing`, 'INVALID_TYPE', 'landing must be an object');
        else {
          rejectUnknown(stair.landing, LANDING_KEYS, `${p}/landing`, add);
          requireKeys(stair.landing, ['at', 'size'], `${p}/landing`, add);
          checkNumber(stair.landing.at, `${p}/landing/at`, add);
          checkNumber(stair.landing.size, `${p}/landing/size`, add);
          if (typeof stair.landing.at === 'number' && (stair.landing.at < 0 || stair.landing.at > 1)) {
            add(`${p}/landing/at`, 'OUT_OF_RANGE', 'landing.at must be between 0 and 1');
          }
          if (typeof stair.landing.size === 'number' && stair.landing.size <= 0) {
            add(`${p}/landing/size`, 'OUT_OF_RANGE', 'landing.size must be positive');
          }
        }
      }
      checkExt(stair.ext, `${p}/ext`, add);

      if (typeof stair.from === 'string' && typeof stair.to === 'string') {
        const from = floorById.get(stair.from);
        const to = floorById.get(stair.to);
        if (!from || !to) add(p, 'STAIR_FLOOR', 'Stair from/to must be floor ids on this plan');
        else if (from.id === to.id) add(p, 'STAIR_SAME_FLOOR', 'Stair must connect two different floors');
        else if (typeof from.elevation === 'number' && typeof from.height === 'number' && typeof to.elevation === 'number'
          && Math.abs(to.elevation - (from.elevation + from.height)) > 1) {
          add(p, 'STAIR_NOT_ADJACENT', 'Stair "to" must be the floor directly above "from"');
        }
      }
    });
  }

  if (isObj(plan.markers) && isObj(plan.markers.walkStart)) {
    const floorId = plan.markers.walkStart.floor;
    if (typeof floorId === 'string' && !floorById.has(floorId)) {
      add('/markers/walkStart/floor', 'WALK_FLOOR', `walkStart floor "${floorId}" does not exist`);
    }
  }

  return issues;
}

function wallLivesOnOtherFloor(floors, floorIndex, wallId) {
  for (let i = 0; i < floors.length; i += 1) {
    if (i === floorIndex || !isObj(floors[i]) || !Array.isArray(floors[i].walls)) continue;
    if (floors[i].walls.some((wall) => wall && wall.id === wallId)) return true;
  }
  return false;
}

function isObj(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknown(obj, allowed, path, add) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) add(`${path}/${key}`.replace('//', '/'), 'UNKNOWN_PROPERTY', `Unknown property "${key}"`);
  }
}

function requireKeys(obj, keys, path, add) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) add(`${path}/${key}`, 'REQUIRED', `Missing "${key}"`);
  }
}

function checkId(value, path, add) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !ID_RE.test(value)) add(path, 'BAD_ID', 'Id must match ^[A-Za-z0-9_-]{1,64}$');
}

function checkString(value, path, add) {
  if (value === undefined) return;
  if (typeof value !== 'string') add(path, 'INVALID_TYPE', 'Expected a string');
}

function checkNumber(value, path, add) {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) add(path, 'INVALID_TYPE', 'Expected a finite number');
}

function checkInteger(value, path, add) {
  if (value === undefined) return;
  if (!Number.isInteger(value)) add(path, 'INVALID_TYPE', 'Expected an integer');
}

function checkBool(value, path, add) {
  if (value === undefined) return;
  if (typeof value !== 'boolean') add(path, 'INVALID_TYPE', 'Expected a boolean');
}

function checkEnum(value, allowed, path, add) {
  if (value === undefined) return;
  if (!allowed.includes(value)) add(path, 'INVALID_ENUM', `Value must be one of ${allowed.join(', ')}`);
}

function checkExt(value, path, add) {
  if (value === undefined) return;
  if (!isObj(value)) add(path, 'INVALID_TYPE', 'ext must be an object');
}
