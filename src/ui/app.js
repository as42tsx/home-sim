// @browser-only
/**
 * Desktop editor shell: template picker, tools, inspectors, autosave.
 * The 2D canvas lives in src/plan2d. 3D is loaded only when that module
 * exports a view constructor.
 */

import { suiteNetM2, aboutNetM2, planNetM2 } from '../editor/area.js';
import { shouldCloseChain, segmentTooShort } from '../editor/chain.js';
import { clonePlanFresh } from '../editor/clone.js';
import { firstOverlap, overlapPartners, warningIds } from '../editor/collision.js';
import {
  bakeCommand,
  furnitureAddCommand,
  furnitureDeleteCommand,
  furnitureDuplicateCommand,
  furniturePatchCommand,
  metaCommand,
  nodesMoveCommand,
  openingAddCommand,
  openingDeleteCommand,
  openingPatchCommand,
  renameCommand,
  roomPatchCommand,
  wallAddCommand,
  wallDeleteCommand,
  wallDemolishCommand,
  wallPatchCommand,
} from '../editor/commands.js';
import { previewDemolish } from '../editor/demolish.js';
import { entryMarker, exteriorDimensions } from '../editor/dimensions.js';
import { angleDeg, escapeHtml, formatAngle, formatAreaM2, formatAreaMm2, formatMm } from '../editor/format.js';
import { snapFurnitureToWall } from '../editor/furniture-snap.js';
import { hitTest, rotateHandlePoint } from '../editor/hit.js';
import { MATERIALS, ROOM_TYPES, roomFillVar } from '../editor/materials.js';
import { openingGeometry } from '../editor/opening-geom.js';
import { previewOpening } from '../editor/opening-preview.js';
import { resolveSnap } from '../editor/snap.js';
import { createEditorStore } from '../editor/store.js';
import { patchWall, updateOpening } from '../editor/structure.js';
import { roomThumbModel, thumbView } from '../editor/thumb.js';
import { wallQuad } from '../editor/wall-shape.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { ICONS } from '../assets/icons.js';
import { CATALOG, catalogCategories, catalogEntry } from '../furniture/catalog.js';
import { formatMessage, loadLocale } from '../i18n/index.js';
import { exportPlanJSON, importPlanJSON } from '../io/json.js';
import { PNG_LONG_EDGE } from '../io/png-fit.js';
import { decodeShareLink, encodeShareLink, formatThousands, shareUrlStats } from '../io/share.js';
import { WALL_THICKNESS } from '../model/constants.js';
import { createEmptyPlan, floorBelow, floorsByElevation, getFloor } from '../model/document.js';
import { uniqueId } from '../model/ids.js';
import { validatePlan } from '../model/validate.js';
import { checkOpeningPlacement, openingClearance } from '../openings/clearance.js';
import { legendForType } from '../plan2d/furniture-symbols.js';
import { placeRoomLabel, swingSectorBBox } from '../plan2d/label-place.js';
import { dimensionBandPx, mountPlanView } from '../plan2d/view.js';
import { renderPlanPng } from './png-2d.js';
import { deriveRooms } from '../rooms/index.js';
import {
  planKey,
  readIndex,
  readLastId,
  readPlan,
  deletePlanWithUndo,
  dropDeleted,
  readPrefs,
  renameStored,
  restoreDeleted,
  sortPlans,
  writePlan,
  writePrefs,
} from '../store/index.js';
import { logIssue, messageKeyForCode } from './issues.js';

const CAT_KEYS = {
  卧室: 'cat.bed',
  客厅: 'cat.living',
  餐厅: 'cat.dining',
  书房: 'cat.study',
  厨房: 'cat.kitchen',
  卫浴: 'cat.bath',
  装饰: 'cat.decor',
};

const TOOL_ICON = {
  select: 'select',
  wall: 'wall',
  room: 'room',
  door: 'door',
  window: 'window',
  demolish: 'demolish',
  measure: 'measure',
  pan: 'pan',
  library: 'sofa',
};

const TOOL_KEYS = {
  select: 'V',
  wall: 'W',
  room: 'R',
  door: 'D',
  window: 'N',
  demolish: 'X',
  measure: 'M',
  pan: 'H',
};

const EDIT_TOOLS = new Set(['wall', 'room', 'door', 'window', 'demolish', 'library']);

const READONLY_BLOCK = new Set([
  'undo', 'redo', 'import-json', 'show-picker', 'open-plan', 'copy-plan', 'rename-plan',
  'delete-plan', 'open-recent', 'pref-virtual', 'pref-thickness', 'wall-virtual', 'demolish',
  'delete-selection', 'duplicate-selection', 'opening-width', 'opening-kind', 'opening-swing',
  'opening-hinge', 'opening-center', 'conflict-keep', 'conflict-load', 'rotate-selection',
]);

const state = {
  prefs: null,
  messages: {},
  store: null,
  floorId: null,
  mode: 'plan',
  tool: 'select',
  selection: null,
  camera: { x: 0, y: 0, k: 0.05 },
  chain: null,
  lengthBuf: '',
  shift: false,
  space: false,
  snap: null,
  hoverWorld: null,
  openingPreview: null,
  openingSwing: 'in',
  measure: null,
  gesture: null,
  furnDrag: null,
  pointers: new Map(),
  pinch: null,
  pickerOpen: false,
  templates: [],
  armed: false,
  quiet: false,
  saveState: 'saved',
  saveTimer: 0,
  quotaToasted: false,
  formError: '',
  panelKey: '',
  condemnedId: null,
  shakeId: null,
  mergeId: null,
  hintTimer: 0,
  pillTimer: 0,
  toastTimer: 0,
  deleteUndoTimer: 0,
  overlapNoted: false,
  view3d: null,
  view3dMod: null,
  view3dBusy: false,
  webgl: null,
  camToken: 0,
  refit: false,
  readOnly: false,
  walkPick: false,
  cutaway: false,
  sheetSnap: 0,
  sheetPage: 'library',
  sheetDrag: null,
  sheetSuppressClick: false,
  layout: 'desk',
  lastSyncedSel: undefined,
  modeToken: 0,
};

let storage = null;
let view = null;
let svg = null;
let modalResolver = null;
let debugRef = null;
let enterGen = 0;

const ui = {};

function t(key, vars) {
  return formatMessage(state.messages, key, vars);
}

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

function typing(el) {
  if (!el?.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable;
}

export function mountApp(debug) {
  debugRef = debug;
  try {
    storage = window.localStorage;
    storage.getItem('homesim:prefs');
  } catch {
    storage = memoryStorage();
  }

  ui.top = document.querySelector('.topbar');
  ui.tools = document.querySelector('.toolrail');
  ui.side = document.querySelector('.sidepanel');
  ui.inspector = document.querySelector('.inspector');
  ui.status = document.querySelector('.statusbar');
  ui.tabs = document.querySelector('.tabbar');
  ui.canvas = document.querySelector('.canvas');
  svg = document.querySelector('.plan-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'plan-svg');
    svg.dataset.testid = 'canvas';
    ui.canvas.prepend(svg);
  }
  ensureChrome();
  view = mountPlanView(svg);
  bindDebug();
  bindEvents();
  void boot();
}

function ensureChrome() {
  ui.top.innerHTML = `
    <div class="brand" aria-hidden="true">家</div>
    <div class="name-wrap">
      <input class="name-input" data-testid="plan-name" data-plan-name aria-label="方案名" />
      <button type="button" class="icon-btn" data-menu-button="plan" data-action="plan-menu" aria-label="方案列表">▾</button>
      <div class="menu" data-menu="plan" hidden></div>
    </div>
    <div class="seg" role="tablist">
      <button type="button" data-mode="plan"><span class="ico">${iconSvg('plan', 16)}</span><span data-i18n="mode.plan">户型</span></button>
      <button type="button" data-mode="furnish"><span class="ico">${iconSvg('sofa', 16)}</span><span data-i18n="mode.furnish">布置</span></button>
      <button type="button" data-mode="view3d"><span class="ico">${iconSvg('cube', 16)}</span><span data-i18n="mode.view3d">3D</span></button>
    </div>
    <button type="button" class="icon-btn" data-action="undo" data-i18n-title="action.undo" aria-label="撤销">${iconSvg('undo', 20)}</button>
    <button type="button" class="icon-btn" data-action="redo" data-i18n-title="action.redo" aria-label="重做">${iconSvg('redo', 20)}</button>
    <button type="button" class="btn" data-action="share"><span class="ico">${iconSvg('share', 16)}</span><span data-i18n="action.share">分享</span></button>
    <div class="menu-wrap">
      <button type="button" class="btn" data-menu-button="file" data-action="file-menu"><span class="ico">${iconSvg('export', 16)}</span><span data-i18n="action.file">文件</span></button>
      <div class="menu right" data-menu="file" hidden>
        <button type="button" class="item" data-action="export-json"><span data-i18n="action.exportJson">导出 JSON</span></button>
        <button type="button" class="item" data-action="import-json"><span data-i18n="action.importJson">导入 JSON</span></button>
        <button type="button" class="item" data-action="export-png"><span data-i18n="action.exportPng">导出 PNG</span></button>
      </div>
    </div>
    <button type="button" class="btn ghost" data-action="lang" data-i18n="action.lang">中 / EN</button>
    <span class="top-spacer"></span>
    <button type="button" class="btn inspector-toggle" data-action="inspector" data-i18n="action.inspector">属性</button>
    <button type="button" class="btn primary" data-action="view3d"><span class="ico">${iconSvg('cube', 16)}</span><span data-i18n="action.view3d">看 3D</span></button>`;

  ui.tools.innerHTML = ['select', 'wall', 'room', 'door', 'window', 'demolish', 'measure', 'pan', 'library']
    .map((name) => {
      const key = TOOL_KEYS[name];
      return `<button type="button" class="tool" data-tool="${name}">${iconSvg(TOOL_ICON[name] || 'select', 22)}${key ? `<i>${key}</i>` : ''}</button>`;
    })
    .join('');

  ui.status.innerHTML = `
    <span data-cursor class="num"></span>
    <span data-zoom class="num"></span>
    <span data-snap></span>
    <span data-tool-hint></span>
    <span class="sp"></span>
    <span data-save></span>`;

  ui.tabs.innerHTML = `
    <button type="button" data-mode="plan"><span class="ico">${iconSvg('plan', 18)}</span><span data-i18n="mode.plan">户型</span></button>
    <button type="button" data-mode="furnish"><span class="ico">${iconSvg('sofa', 18)}</span><span data-i18n="mode.furnish">布置</span></button>
    <button type="button" data-mode="view3d"><span class="ico">${iconSvg('cube', 18)}</span><span data-i18n="mode.view3d">3D</span></button>
    <button type="button" data-action="more-menu"><span class="ico">${iconSvg('more', 18)}</span><span data-i18n="action.more">更多</span></button>
    <button type="button" data-action="save-copy" data-readonly-tab hidden data-i18n="share.saveShort">保存</button>
    <div class="menu up" data-menu="more" hidden>
      <button type="button" class="item" data-action="share"><span data-i18n="action.share">分享</span></button>
      <button type="button" class="item" data-action="export-json"><span data-i18n="action.exportJson">导出 JSON</span></button>
      <button type="button" class="item" data-action="import-json"><span data-i18n="action.importJson">导入 JSON</span></button>
      <button type="button" class="item" data-action="export-png"><span data-i18n="action.exportPng">导出 PNG</span></button>
      <button type="button" class="item" data-action="lang"><span data-i18n="action.lang">中 / EN</span></button>
      <button type="button" class="item" data-action="help"><span data-i18n="action.help">帮助</span></button>
      <button type="button" class="item" data-action="tool-measure"><span data-i18n="tool.measure">测量</span></button>
    </div>`;

  if (!ui.canvas.querySelector('#view3d-host')) {
    const host = document.createElement('div');
    host.id = 'view3d-host';
    host.hidden = true;
    ui.canvas.append(host);
  }
  ui.hud = ensureDiv('hud3d', 'data-hud');
  ui.hud.dataset.testid = 'hud3d';
  ui.hud.hidden = true;
  ui.hud.innerHTML = `
    <div class="hud-row">
      <div class="hud-seg" role="group">
        <button type="button" data-action="bird" data-testid="hud-bird" aria-pressed="true"><span data-i18n="action.bird">鸟瞰</span></button>
        <button type="button" data-action="walk" data-testid="hud-walk" aria-pressed="false"><span class="ico">${iconSvg('walk', 16)}</span><span data-i18n="action.walk">漫游</span></button>
        <button type="button" data-action="cutaway" data-testid="hud-cutaway" aria-pressed="false"><span data-i18n="action.cutaway">剖切墙</span></button>
      </div>
      <button type="button" class="btn hud-reset" data-action="reset-view" data-testid="hud-reset" data-i18n-title="action.resetView" aria-label="复位"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.2-5.5"/><path d="M4 4v5h5"/></svg></button>
    </div>
    <div class="hud-hint" data-hud-hint></div>`;
  ui.readout = ensureDiv('readonly-banner', 'data-readonly');
  ui.readout.dataset.testid = 'readonly-banner';
  ui.readout.hidden = true;
  ui.readout.innerHTML = `
    <span class="banner-note">${iconSvg('eye', 18)}<span data-i18n="share.banner">只读查看 ·</span></span>
    <button type="button" class="btn primary" data-action="save-copy" data-testid="save-copy"><span data-i18n="share.save">保存到我的方案</span></button>`;
  ui.sheet = ensureDiv('sheet', 'data-sheet');
  ui.sheet.dataset.testid = 'sheet';
  ui.sheet.innerHTML = `
    <button type="button" class="sheet-handle" data-sheet-handle data-action="sheet-cycle" aria-label="抽屉"></button>
    <div class="sheet-tabs">
      <button type="button" data-sheet-page="library" data-i18n="sheet.library">家具库</button>
      <button type="button" data-sheet-page="props" data-i18n="sheet.props">属性</button>
    </div>
    <div class="sheet-pages">
      <div class="sheet-page" data-page="library"></div>
      <div class="sheet-page" data-page="props" hidden></div>
    </div>`;
  ui.sheetLib = ui.sheet.querySelector('[data-page="library"]');
  ui.sheetProps = ui.sheet.querySelector('[data-page="props"]');
  ui.fab = ensureDiv('fab', 'data-fab');
  ui.fab.dataset.testid = 'fab';
  ui.fab.hidden = true;
  ui.fab.innerHTML = `
    <button type="button" data-action="rotate-selection" data-i18n-aria="action.rotate" aria-label="旋转">${iconSvg('rotate', 20)}</button>
    <button type="button" data-action="duplicate-selection" data-i18n-aria="action.copy" aria-label="复制">${iconSvg('copy', 20)}</button>
    <button type="button" data-action="delete-selection" data-i18n-aria="inspector.delete" aria-label="删除">${iconSvg('trash', 20)}</button>
    <button type="button" data-action="sheet-props" data-i18n-aria="action.props" aria-label="属性">${iconSvg('more', 20)}</button>`;
  state.layout = layoutName();
  document.body.dataset.mode = state.mode;
  document.body.dataset.sheet = '0';
  ui.floors = ensureDiv('floors', 'data-floors');
  ui.scale = ensureDiv('scalebar', 'data-scale');
  ui.scale.innerHTML = '<span data-scale-label></span><i data-scale-line></i>';
  ui.hint = ensureDiv('hint', 'data-hint');
  ui.hint.dataset.testid = 'hint';
  ui.hint.hidden = true;
  ui.pill = ensureDiv('float-pill', 'data-pill');
  ui.pill.hidden = true;
  ui.picker = ensureDiv('picker', 'data-picker');
  ui.picker.dataset.testid = 'picker';
  ui.picker.hidden = true;
  ui.banner = ensureDiv('banner', 'data-banner');
  ui.banner.hidden = true;
  ui.toasts = ensureDiv('toast-host', 'data-toasts');
  ui.modals = ensureDiv('modal-host', 'data-modals');
  ui.ghost = ensureDiv('drag-ghost', 'data-ghost');
  ui.ghost.hidden = true;
  ui.file = document.createElement('input');
  ui.file.type = 'file';
  ui.file.accept = 'application/json,.json';
  ui.file.hidden = true;
  document.body.append(ui.file);
}

function ensureDiv(className, attr) {
  let node = ui.canvas.querySelector(`.${className.split(' ')[0]}`);
  if (!node) {
    node = document.createElement('div');
    node.className = className;
    ui.canvas.append(node);
  }
  if (attr) node.setAttribute(attr, '');
  return node;
}

function layoutName() {
  const width = window.innerWidth;
  if (width < 600) return 'phone';
  if (width < 900) return 'tablet';
  if (width < 1200) return 'overlay';
  return 'desk';
}

function prefersReduced() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function walkingNow() {
  try { return !!state.view3d?.debugState?.().walking; } catch { return false; }
}

function syncLayoutClass() {
  state.layout = layoutName();
  document.body.dataset.layout = state.layout;
  document.body.dataset.mode = state.mode;
  document.body.dataset.sheet = String(state.sheetSnap);
  document.body.classList.toggle('is-readonly', !!state.readOnly);
  document.body.classList.toggle('is-walkpick', !!state.walkPick);
}

function syncSheet() {
  document.body.dataset.sheet = String(state.sheetSnap);
  if (!ui.sheet) return;
  for (const tab of ui.sheet.querySelectorAll('[data-sheet-page]')) {
    tab.classList.toggle('is-on', tab.dataset.sheetPage === state.sheetPage);
  }
  const lib = ui.sheet.querySelector('[data-page="library"]');
  const props = ui.sheet.querySelector('[data-page="props"]');
  if (lib) lib.hidden = state.sheetPage !== 'library';
  if (props) props.hidden = state.sheetPage !== 'props';
}

function paint3dButton() {
  const loading = !!state.view3dBusy;
  const blocked = !!(state.webgl && state.webgl.ok === false);
  const in3d = state.mode === 'view3d';
  const label = loading ? t('view3d.loading') : in3d ? t('action.to2d') : t('action.view3d');
  for (const button of document.querySelectorAll('[data-action="view3d"]')) {
    const span = button.querySelector('[data-i18n]');
    if (span) span.textContent = label;
    button.disabled = loading || (blocked && !in3d);
    if (blocked) button.title = state.webgl.reason || t('view3d.unavailable');
  }
  for (const button of document.querySelectorAll('button[data-mode="view3d"]')) {
    button.disabled = blocked;
    if (blocked) button.title = state.webgl.reason || t('view3d.unavailable');
  }
}

function touchHud() {
  if (state.layout === 'phone') return true;
  try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch { return false; }
}

function renderHud() {
  if (!ui.hud) return;
  const on = state.mode === 'view3d' && !state.pickerOpen;
  ui.hud.hidden = !on;
  const walking = walkingNow();
  const cut = ui.hud.querySelector('[data-action="cutaway"]');
  if (cut) cut.setAttribute('aria-pressed', state.cutaway ? 'true' : 'false');
  const walk = ui.hud.querySelector('[data-action="walk"]');
  if (walk) walk.setAttribute('aria-pressed', walking ? 'true' : 'false');
  const bird = ui.hud.querySelector('[data-action="bird"]');
  if (bird) bird.setAttribute('aria-pressed', walking ? 'false' : 'true');
  const reset = ui.hud.querySelector('[data-action="reset-view"]');
  if (reset) reset.setAttribute('aria-label', t('action.resetView'));
  const hint = ui.hud.querySelector('[data-hud-hint]');
  if (hint) {
    const key = walking ? 'hud.walk' : touchHud() ? 'hud.touch' : 'hud.orbit';
    hint.textContent = t(key);
  }
}

function selectionAnchor() {
  const floor = ensureFloor();
  if (!floor || !state.selection) return null;
  const sel = state.selection;
  if (sel.kind === 'furniture') {
    const item = floor.furniture.find((entry) => entry.id === sel.id);
    if (!item) return null;
    return { x: item.cx, y: item.cy - (item.d || 400) / 2 };
  }
  if (sel.kind === 'wall' || sel.kind === 'opening') {
    let wall = null;
    if (sel.kind === 'wall') wall = floor.walls.find((item) => item.id === sel.id);
    else {
      const opening = floor.openings.find((item) => item.id === sel.id);
      wall = opening && floor.walls.find((item) => item.id === opening.wall);
    }
    if (!wall) return null;
    const nodes = new Map(floor.nodes.map((node) => [node.id, node]));
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (sel.kind === 'room') {
    const live = liveDerive(state.floorId);
    const face = (live.derived || []).find((item) => item.roomId === sel.id);
    const at = face?.centroid || face?.centerline?.[0] || face?.polygon?.[0];
    if (!at) return null;
    return { x: at.x, y: at.y };
  }
  return null;
}

function renderFab() {
  if (!ui.fab) return;
  const show = state.layout === 'phone'
    && !state.readOnly
    && state.mode !== 'view3d'
    && !state.pickerOpen
    && !!state.selection
    && !svg?.hidden;
  if (!show || !view) {
    ui.fab.hidden = true;
    return;
  }
  const anchor = selectionAnchor();
  if (!anchor) {
    ui.fab.hidden = true;
    return;
  }
  const client = view.clientFromWorld(anchor.x, anchor.y);
  const barW = 44 * 4 + 4 * 3 + 8;
  let left = client.x - barW / 2;
  let top = client.y - 64;
  left = Math.max(8, Math.min(window.innerWidth - barW - 8, left));
  top = Math.max(60, Math.min(window.innerHeight - 140, top));
  ui.fab.style.left = `${Math.round(left)}px`;
  ui.fab.style.top = `${Math.round(top)}px`;
  ui.fab.hidden = false;
}

function applyReadOnlyLocks() {
  const name = ui.top.querySelector('[data-plan-name]');
  if (name) name.readOnly = !!state.readOnly;
  for (const button of ui.tools.querySelectorAll('[data-tool]')) {
    button.disabled = !!(state.readOnly && EDIT_TOOLS.has(button.dataset.tool));
  }
  if (!state.readOnly) return;
  for (const root of [ui.inspector, ui.sheetProps, ui.side]) {
    if (!root) continue;
    for (const el of root.querySelectorAll('input, select, textarea')) {
      if (el.hasAttribute('data-search')) continue;
      el.disabled = true;
    }
    for (const el of root.querySelectorAll('button')) {
      if (el.dataset.room) continue;
      const action = el.dataset.action;
      if (el.dataset.furn || el.dataset.pref || (action && READONLY_BLOCK.has(action))) el.disabled = true;
    }
  }
}

function syncViewSelection(force) {
  if (!state.view3d || state.mode !== 'view3d') return;
  const id = state.selection?.kind === 'furniture' ? state.selection.id : null;
  if (!force && id === state.lastSyncedSel) return;
  state.lastSyncedSel = id;
  try { state.view3d.select?.(id); } catch { /* highlight is cosmetic */ }
}

function onView3dSelect(id) {
  if (!state.store) return;
  if (!id) {
    state.selection = null;
    state.lastSyncedSel = null;
    state.formError = '';
    renderChrome();
    return;
  }
  const plan = state.store.getPlan();
  const floor = (plan.floors || []).find((item) => (item.furniture || []).some((entry) => entry.id === id));
  if (floor && floor.id !== state.floorId) {
    state.floorId = floor.id;
    try { state.view3d?.setCurrentFloor?.(floor.id); } catch { /* floor highlight follows the next render */ }
  }
  state.selection = { kind: 'furniture', id };
  state.lastSyncedSel = id;
  state.formError = '';
  renderAll();
}

function safeStem(name) {
  const cleaned = String(name || 'plan').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'plan';
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function pngModel() {
  const plan = state.store.getPlan();
  const floor = ensureFloor();
  const live = floor ? liveDerive(state.floorId) : null;
  const drawn = floor
    ? floorGraphics(floor, live, { labels: true })
    : { rooms: [], walls: [], openings: [], labels: [], nodes: new Map() };
  let furniture = [];
  if (floor) {
    const quads = [];
    for (const wall of floor.walls || []) {
      if (wall.virtual || wall.demolished) continue;
      const a = drawn.nodes?.get(wall.a);
      const b = drawn.nodes?.get(wall.b);
      if (a && b) quads.push(wallQuad(a, b, wall.thickness, false));
    }
    const warns = warningIds(floor.furniture || [], quads, live?.derived || []);
    furniture = (floor.furniture || []).map((item) => ({
      item,
      shape: shapeOf(item),
      type: item.type,
      warn: warns.has(item.id),
    }));
  }
  return {
    name: plan.meta?.name || '',
    rooms: drawn.rooms,
    walls: drawn.walls,
    openings: drawn.openings,
    furniture,
    labels: layoutLabels(drawn.labels, drawn.rooms, drawn.openings, state.camera?.k || 0.05),
  };
}

async function exportPng() {
  if (!state.store) return;
  const stem = safeStem(state.store.getPlan().meta?.name);
  try {
    if (state.mode === 'view3d' && state.view3d?.toPNG) {
      const blob = await state.view3d.toPNG({ longEdge: PNG_LONG_EDGE });
      downloadBlob(blob, `${stem}-3D.png`);
      return;
    }
    const blob = await renderPlanPng(pngModel());
    downloadBlob(blob, `${stem}-2D.png`);
  } catch {
    toast(t('toast.saveFail'), 'danger');
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to a selected field */ }
  try {
    const input = ui.modals.querySelector('[data-testid="share-link"]');
    if (input) {
      input.focus();
      input.select();
      if (document.execCommand('copy')) return true;
    }
  } catch { /* the dialog stays so the link can be copied by hand */ }
  return false;
}

async function copyShareField() {
  const input = ui.modals.querySelector('[data-testid="share-link"]');
  const text = input?.value || '';
  const ok = await copyText(text);
  if (ok) toast(t('share.copied'));
  else {
    input?.focus();
    input?.select();
    toast(t('share.copyFallback'), '', null, 4000);
  }
}

async function openShareDialog() {
  if (!state.store) return;
  const plan = state.store.getPlan();
  const baseUrl = `${location.origin}${location.pathname}`;
  let encoded;
  try {
    encoded = await encodeShareLink(plan, { baseUrl });
  } catch (err) {
    logIssue('SHARE_ENCODE', err && err.name);
    toast(t('share.incomplete'), 'danger');
    return;
  }
  if (!encoded.ok) {
    logIssue(encoded.code || 'TOO_LONG', encoded.bytes);
    const kb = (encoded.bytes / 1024).toFixed(1);
    const ok = await showModal({
      title: t('share.tooBigTitle'),
      body: `<p>${escapeHtml(t('share.tooBig', { kb }))}</p>`,
      confirm: t('action.exportJson'),
      cancel: t('share.close'),
    });
    if (ok) exportJSON();
    return;
  }
  const stats = shareUrlStats(encoded.url);
  const warn = stats.warn
    ? `<p class="warn share-warn" data-testid="share-warn">${iconSvg('warning', 16)}<span>${escapeHtml(t('share.warnLong'))}</span></p>`
    : '';
  ui.modals.innerHTML = `
    <div class="modal-mask">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h3 id="share-title">${escapeHtml(t('share.title'))}</h3>
        <div class="modal-body">
          <p class="formula" data-testid="share-size">${escapeHtml(t('share.chars', { n: formatThousands(stats.chars) }))}</p>
          <input class="share-link" data-testid="share-link" readonly value="${escapeHtml(encoded.url)}" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" data-action="share-close">${escapeHtml(t('share.close'))}</button>
          <button type="button" class="btn${stats.warn ? '' : ' primary'}" data-action="copy-share">${escapeHtml(t('share.copy'))}</button>
          ${stats.warn ? `<button type="button" class="btn primary" data-action="share-export-json">${escapeHtml(t('action.exportJson'))}</button>` : ''}
        </div>
        ${warn}
      </div>
    </div>`;
  modalResolver = () => {};
  try {
    const copied = await copyText(encoded.url);
    if (copied) toast(t('share.copied'));
  } catch { /* the dialog still holds the link */ }
}

function openLocalOrPicker() {
  const lastId = readLastId(storage);
  const last = lastId ? readPlan(storage, lastId) : null;
  const lastErrors = last ? validatePlan(last).filter((item) => item.severity !== 'warning') : [{ code: 'missing' }];
  if (last && !lastErrors.length) adopt(last, { save: false, arm: true, readOnly: false });
  else {
    state.readOnly = false;
    state.pickerOpen = true;
    syncPicker();
    renderAll();
  }
}

function enterShared(plan) {
  adopt(plan, {
    save: false,
    arm: false,
    readOnly: true,
    tool: 'select',
    multiToast: (plan.floors?.length || 0) > 1,
  });
}

async function onHashChange() {
  const hash = location.hash || '';
  if (!hash.startsWith('#p=')) return;
  const decoded = await decodeShareLink(hash);
  if (!decoded.ok) {
    logIssue(decoded.code || 'LINK_INCOMPLETE');
    toast(t('share.incomplete'), 'warn', null, 4000);
    return;
  }
  enterShared(decoded.plan);
}

async function saveSharedCopy() {
  if (!state.readOnly || !state.store) return;
  const copy = clonePlanFresh(state.store.getPlan());
  let result;
  try { result = writePlan(storage, copy); } catch { result = { ok: false }; }
  if (!result.ok) {
    toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
    return;
  }
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  adopt(copy, { save: false, arm: true, readOnly: false });
  toast(t('share.saved'));
}

async function beginWalkAt(world) {
  if (!state.store || !state.floorId || !world) return;
  state.walkPick = false;
  state.store.dispatch(metaCommand((plan) => {
    if (!plan.markers || typeof plan.markers !== 'object') plan.markers = {};
    plan.markers.walkStart = { floor: state.floorId, x: world.x, y: world.y, yaw: 0 };
  }));
  await enter3d(false);
  if (state.mode !== 'view3d' || !state.view3d) return;
  try { state.view3d.enterWalk(); } catch { /* orbit remains usable */ }
  toast(t('walk.exit'));
  renderHud();
}

function openHelp() {
  const items = ['help.s1', 'help.s2', 'help.s3', 'help.s4', 'help.s5']
    .map((key) => `<li>${escapeHtml(t(key))}</li>`)
    .join('');
  void showModal({
    title: t('help.title'),
    body: `<ul class="help-list">${items}</ul>`,
    confirm: t('common.confirm'),
    cancel: t('share.close'),
  });
}

function iconSvg(name, size = 22) {
  const raw = ICONS[name];
  if (!raw) return '';
  return raw.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
}

function bindDebug() {
  debugRef.getPlan = () => state.store?.getPlan() ?? null;
  debugRef.currentFloorId = () => state.floorId;
  debugRef.renderInfo = () => {
    if (state.view3d && typeof state.view3d.renderInfo === 'function') return state.view3d.renderInfo();
    return { note: '3D not loaded' };
  };
  debugRef.worldToScreen = (x, y) => {
    const wx = typeof x === 'object' ? x.x : x;
    const wy = typeof x === 'object' ? x.y : y;
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + state.camera.x + wx * state.camera.k,
      y: rect.top + state.camera.y + wy * state.camera.k,
    };
  };
  debugRef.setCamera = setCamera;
  debugRef.setTool = (name) => setTool(name);
  debugRef.fit = () => {
    state.camToken += 1;
    fitCamera();
  };
  debugRef.view3d = () => state.view3d || null;
  debugRef.store = null;
}

function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChangeInput);
  document.addEventListener('input', onInput);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', (event) => onPointerUp(event, false));
  window.addEventListener('pointercancel', (event) => onPointerUp(event, true));
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('hashchange', () => { void onHashChange(); });
  window.addEventListener('storage', onStorage);
  svg.addEventListener('wheel', onWheel, { passive: false });
  ui.file.addEventListener('change', () => {
    const file = ui.file.files?.[0];
    ui.file.value = '';
    if (file) void importFile(file);
  });
  ui.top.querySelector('[data-plan-name]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  });
  ui.top.querySelector('[data-plan-name]').addEventListener('change', (event) => {
    if (state.readOnly) {
      event.target.value = state.store?.getPlan()?.meta?.name || '';
      return;
    }
    const name = event.target.value.trim();
    if (!name || !state.store) return;
    if (name === state.store.getPlan().meta.name) return;
    state.store.dispatch(renameCommand(name));
  });
  const observer = new ResizeObserver(() => {
    const next = layoutName();
    const changed = next !== state.layout;
    if (state.refit) fitCamera();
    else renderCanvas();
    if (changed) {
      state.panelKey = '';
      renderChrome();
    } else renderFab();
    try { state.view3d?.resize?.(); } catch { /* 3D resize is best-effort */ }
  });
  observer.observe(ui.canvas);
}

async function boot() {
  state.prefs = readPrefs(storage);
  try {
    state.messages = await loadLocale(state.prefs.lang);
  } catch {
    state.messages = {};
  }
  document.documentElement.lang = state.prefs.lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('app.title');
  renderStatic();
  const hash = location.hash || '';
  if (hash.startsWith('#p=')) {
    const decoded = await decodeShareLink(hash);
    if (decoded.ok) enterShared(decoded.plan);
    else {
      logIssue(decoded.code || 'LINK_INCOMPLETE');
      toast(t('share.incomplete'), 'warn', null, 4000);
      openLocalOrPicker();
    }
  } else {
    openLocalOrPicker();
  }
  await refreshPicker();
  await probe3d();
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (!state.pickerOpen) fitCamera();
      resolve();
    });
  });
  document.documentElement.dataset.app = 'ready';
}

function adopt(plan, opts = {}) {
  state.readOnly = opts.readOnly === true;
  state.walkPick = false;
  state.pickerOpen = false;
  syncPicker();
  state.chain = null;
  state.lengthBuf = '';
  state.selection = null;
  state.lastSyncedSel = undefined;
  state.measure = null;
  state.condemnedId = null;
  state.formError = '';
  if (state.readOnly) state.tool = 'select';
  state.quiet = true;
  if (!state.store) {
    state.store = createEditorStore(plan);
    state.store.subscribe(onStore);
    debugRef.store = state.store;
  } else {
    state.store.replace(structuredClone(plan));
  }
  state.quiet = false;
  const ordered = floorsByElevation(state.store.getPlan());
  state.floorId = ordered[0]?.id ?? null;
  state.armed = opts.arm !== false && !state.readOnly;
  state.saveState = 'saved';
  try { state.view3d?.exitWalk?.(); } catch { /* a new plan leaves walk */ }
  try { state.view3d?.setCurrentFloor?.(state.floorId); } catch { /* 3D may not be mounted */ }
  if (opts.tool) setTool(opts.tool, true);
  renderAll();
  scheduleFit();
  if (opts.save) saveNow();
  if (opts.hint) showHint(opts.hint);
  if (opts.multiToast && (plan.floors?.length || 0) > 1) {
    toast(t('toast.multi', { n: plan.floors.length }));
  }
}

function scheduleFit() {
  const token = state.camToken;
  requestAnimationFrame(() => {
    if (token !== state.camToken) return;
    fitCamera();
  });
}

function setCamera(cam = {}) {
  state.camToken += 1;
  if (cam.pxPerMm != null) state.camera.k = cam.pxPerMm;
  if (cam.k != null) state.camera.k = cam.k;
  if (cam.x != null) state.camera.x = cam.x;
  if (cam.y != null) state.camera.y = cam.y;
  renderCanvas();
  renderStatus();
}

function onStore(_plan, change) {
  if (state.view3d && change) {
    try { state.view3d.update(change); } catch { /* keep 2D usable if the view rejects a change */ }
  }
  if (change && (change.kind === 'furniture' || change.kind === 'full')) state.lastSyncedSel = undefined;
  if (state.quiet) return;
  renderCanvas();
  renderStatus();
  renderName();
  if (!state.store?.isTransacting()) {
    renderChrome();
    scheduleSave();
  } else {
    updateHistoryButtons();
    renderFab();
    syncViewSelection();
  }
}

function ensureFloor() {
  if (!state.store) return null;
  const plan = state.store.getPlan();
  const ordered = floorsByElevation(plan);
  if (!ordered.length) {
    state.floorId = null;
    return null;
  }
  if (!ordered.some((floor) => floor.id === state.floorId)) state.floorId = ordered[0].id;
  return getFloor(plan, state.floorId);
}

function liveDerive(floorId) {
  try {
    return deriveRooms(state.store.getPlan(), floorId, {
      previousDerived: state.store.previousDerived(floorId),
    });
  } catch {
    return { rooms: [], derived: [], unclosed: { endpoints: [], gap: null } };
  }
}

function renderAll() {
  renderStatic();
  renderCanvas();
  renderChrome();
  renderStatus();
  renderName();
}

function renderStatic() {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  const bannerText = ui.banner.querySelector('[data-banner-text]');
  if (!bannerText && ui.banner.childElementCount === 0) {
    ui.banner.innerHTML = `
      <span data-banner-text></span>
      <button type="button" class="btn" data-action="conflict-load"></button>
      <button type="button" class="btn" data-action="conflict-keep"></button>`;
  }
  const text = ui.banner.querySelector('[data-banner-text]');
  if (text) text.textContent = t('conflict.text');
  const load = ui.banner.querySelector('[data-action="conflict-load"]');
  const keep = ui.banner.querySelector('[data-action="conflict-keep"]');
  if (load) load.textContent = t('conflict.load');
  if (keep) keep.textContent = t('conflict.keep');
  paint3dButton();
}

function renderName() {
  const input = ui.top.querySelector('[data-plan-name]');
  if (!input) return;
  const name = state.store?.getPlan()?.meta?.name || '';
  if (document.activeElement !== input) input.value = name;
  input.placeholder = t('plan.untitled');
  input.disabled = !state.store;
}

function syncPicker() {
  ui.picker.hidden = !state.pickerOpen;
  document.body.classList.toggle('is-picker', state.pickerOpen);
}

function renderChrome() {
  syncLayoutClass();
  const key = panelSignature();
  if (key !== state.panelKey) {
    state.panelKey = key;
    ui.side.innerHTML = sideHTML();
    ui.inspector.innerHTML = inspectorHTML();
    if (ui.sheetLib && (state.layout === 'phone' || state.layout === 'tablet')) {
      ui.sheetLib.innerHTML = catalogHTML();
      const walls = state.mode === 'plan' ? wallOptionsHTML() : '';
      ui.sheetProps.innerHTML = `${walls}${inspectorHTML()}`;
    }
    patchLength();
  }
  renderTools();
  renderModes();
  renderFloors();
  updateHistoryButtons();
  applyReadOnlyLocks();
  syncSheet();
  renderFab();
  renderHud();
  syncViewSelection();
}

function panelSignature() {
  const floor = state.store ? ensureFloor() : null;
  const live = state.store && state.floorId ? liveDerive(state.floorId) : null;
  const rooms = (live?.rooms || []).map((room) => `${room.id}:${room.name}:${room.type}:${room.floor}`).join(',');
  const areas = (live?.derived || []).map((face) => `${face.roomId}:${Math.round(face.area || 0)}`).join(',');
  const sel = state.selection ? `${state.selection.kind}:${state.selection.id}` : '';
  let extra = '';
  if (floor && state.selection?.kind === 'wall') {
    const wall = floor.walls.find((item) => item.id === state.selection.id);
    if (wall) extra = `${wall.thickness}:${wall.virtual}:${wall.bearing}:${wall.exterior}:${wall.height}:${wall.demolished}`;
  }
  if (floor && state.selection?.kind === 'opening') {
    const opening = floor.openings.find((item) => item.id === state.selection.id);
    if (opening) extra = `${opening.kind}:${opening.width}:${opening.hinge}:${opening.swing}:${opening.t}`;
  }
  if (floor && state.selection?.kind === 'furniture') {
    const item = floor.furniture.find((entry) => entry.id === state.selection.id);
    if (item) extra = `${item.name}:${item.w}:${item.d}:${item.h}:${item.color}:${Math.round(item.rot || 0)}`;
  }
  const gap = live?.unclosed?.gap == null ? '' : Math.round(live.unclosed.gap);
  return [
    state.mode, state.tool, state.prefs?.lang, state.floorId, sel, extra, rooms, areas, gap,
    state.formError, state.chain ? state.chain.points.length : 0,
    state.prefs?.wallThickness, state.prefs?.wallVirtual, state.prefs?.wallBearing,
    state.prefs?.wallExterior, state.prefs?.furnitureSnap, state.prefs?.doorWidth, state.prefs?.windowWidth,
    state.readOnly ? 1 : 0, state.layout,
  ].join('|');
}

function renderTools() {
  const planTools = ['select', 'wall', 'room', 'door', 'window', 'demolish', 'measure', 'pan'];
  const furnTools = ['select', 'library', 'measure', 'pan'];
  const allow = state.mode === 'furnish' ? furnTools : planTools;
  for (const button of ui.tools.querySelectorAll('[data-tool]')) {
    const name = button.dataset.tool;
    button.hidden = state.mode === 'view3d' ? true : !allow.includes(name);
    button.classList.toggle('is-on', name === state.tool && state.mode !== 'view3d');
    const label = t(name === 'library' ? 'tool.library' : `tool.${name}`);
    const touch = touchHud();
    button.title = !touch && TOOL_KEYS[name] ? `${label} (${TOOL_KEYS[name]})` : label;
    button.setAttribute('aria-label', label);
  }
}

function renderModes() {
  document.body.dataset.mode = state.mode;
  document.body.classList.toggle('is-readonly', !!state.readOnly);
  for (const button of document.querySelectorAll('button[data-mode]')) {
    button.classList.toggle('is-on', button.dataset.mode === state.mode);
    if (button.dataset.mode === 'plan') {
      const label = button.querySelector('[data-i18n]');
      if (label) label.textContent = state.readOnly ? t('mode.view2d') : t('mode.plan');
    }
    if (button.dataset.mode === 'furnish') button.hidden = !!state.readOnly;
  }
  const more = document.querySelector('[data-action="more-menu"]');
  if (more) more.hidden = !!state.readOnly;
  const save = document.querySelector('[data-readonly-tab]');
  if (save) save.hidden = !state.readOnly;
  if (ui.readout) ui.readout.hidden = !state.readOnly || state.pickerOpen;
  paint3dButton();
}

function renderFloors() {
  const plan = state.store?.getPlan();
  const ordered = plan ? floorsByElevation(plan) : [];
  // M1 hides the add-floor (+) control. Multi-floor editing is a later milestone.
  ui.floors.dataset.testid = 'floor-switcher';
  ui.floors.dataset.count = String(ordered.length);
  ui.floors.dataset.current = state.floorId || '';
  if (ordered.length < 2) {
    ui.floors.hidden = true;
    ui.floors.innerHTML = '';
    return;
  }
  ui.floors.hidden = false;
  const visual = [...ordered].reverse();
  ui.floors.innerHTML = visual.map((floor) => {
    const on = floor.id === state.floorId ? 'is-on' : '';
    return `<button type="button" data-floor="${escapeHtml(floor.id)}" class="${on}">${escapeHtml(floor.name || floor.id)}</button>`;
  }).join('');
}

function updateHistoryButtons() {
  const undo = ui.top.querySelector('[data-action="undo"]');
  const redo = ui.top.querySelector('[data-action="redo"]');
  const canUndo = !!(state.store && (state.store.canUndo() || state.store.isTransacting()));
  const canRedo = !!(state.store && state.store.canRedo() && !state.store.isTransacting());
  if (undo) undo.disabled = state.readOnly || !canUndo;
  if (redo) redo.disabled = state.readOnly || !canRedo;
}

function renderStatus() {
  const world = state.hoverWorld;
  const cursor = ui.status.querySelector('[data-cursor]');
  const zoom = ui.status.querySelector('[data-zoom]');
  const snap = ui.status.querySelector('[data-snap]');
  const hint = ui.status.querySelector('[data-tool-hint]');
  const save = ui.status.querySelector('[data-save]');
  if (cursor) {
    cursor.textContent = world
      ? t('status.cursor', { x: formatMm(world.x), y: formatMm(world.y) })
      : '';
  }
  if (zoom) zoom.textContent = t('status.zoom', { n: Math.round(state.camera.k * 1000) });
  if (snap) {
    const on = !state.shift && (state.tool === 'wall' || state.tool === 'measure');
    snap.innerHTML = on
      ? `<span class="chip on">${escapeHtml(t('status.snapOn'))}</span>`
      : `<span class="chip">${escapeHtml(t('status.snapOff'))}</span>`;
  }
  if (hint) hint.textContent = toolHint();
  if (save) {
    const key = state.saveState === 'error' ? 'status.saveError'
      : state.saveState === 'dirty' ? 'status.dirty'
        : state.saveState === 'saving' ? 'status.saving'
          : 'status.saved';
    save.textContent = t(key);
  }
  const px = niceScale(state.camera.k);
  const label = ui.scale.querySelector('[data-scale-label]');
  const line = ui.scale.querySelector('[data-scale-line]');
  if (label) label.textContent = formatMm(px.mm);
  if (line) line.style.width = `${Math.max(8, px.px)}px`;
}

function toolHint() {
  if (state.walkPick) return t('walk.pick');
  if (state.mode === 'furnish' && state.tool === 'library') return t('hint.library');
  const key = {
    wall: 'hint.wall',
    door: 'hint.door',
    window: 'hint.window',
    demolish: 'hint.demolish',
    measure: 'hint.measure',
    room: 'hint.room',
    pan: 'hint.pan',
    select: 'hint.select',
    library: 'hint.library',
  }[state.tool];
  return key ? t(key) : '';
}

function niceScale(k) {
  const safe = k > 0 ? k : 0.05;
  const target = 96;
  const mm = target / safe;
  const pow = 10 ** Math.floor(Math.log10(Math.max(mm, 1)));
  let best = pow;
  for (const n of [1, 2, 5]) {
    const cand = n * pow;
    if (Math.abs(cand * safe - target) < Math.abs(best * safe - target)) best = cand;
  }
  return { mm: best, px: best * safe };
}

function sideHTML() {
  if (state.mode === 'furnish') {
    return `${catalogHTML()}${defaultsHTML()}`;
  }
  let head = '';
  if (state.tool === 'wall') head = wallOptionsHTML();
  else if (state.tool === 'door' || state.tool === 'window') head = `<p class="note">${escapeHtml(toolHint())}</p>`;
  else head = `<p class="note">${escapeHtml(toolHint())}</p>`;
  return `${head}${defaultsHTML()}`;
}

function wallOptionsHTML() {
  const prefs = state.prefs;
  const presets = WALL_THICKNESS.presets.map((value) => {
    const on = prefs.wallThickness === value ? 'is-on' : '';
    return `<button type="button" class="${on}" data-action="pref-thickness" data-value="${value}">${value}</button>`;
  }).join('');
  return `
    <h2 class="panel-title">${escapeHtml(t('tool.wall'))}</h2>
    <div class="field"><label>${escapeHtml(t('wall.type'))}</label>
      <div class="seg wide">
        <button type="button" data-action="pref-virtual" data-value="0" class="${prefs.wallVirtual ? '' : 'is-on'}">${escapeHtml(t('wall.solid'))}</button>
        <button type="button" data-action="pref-virtual" data-value="1" class="${prefs.wallVirtual ? 'is-on' : ''}">${escapeHtml(t('wall.virtual'))}</button>
      </div>
    </div>
    <div class="field"><label>${escapeHtml(t('wall.thickness'))}</label><div class="presets">${presets}</div></div>
    <label class="check"><input type="checkbox" data-pref="wallBearing" ${prefs.wallBearing ? 'checked' : ''} ${prefs.wallVirtual ? 'disabled' : ''}/>${escapeHtml(t('wall.bearing'))}</label>
    <label class="check"><input type="checkbox" data-pref="wallExterior" ${prefs.wallExterior ? 'checked' : ''}/>${escapeHtml(t('wall.exterior'))}</label>
    <div class="field"><label>${escapeHtml(t('wall.length'))}</label><div class="length-readout" data-field="length">${escapeHtml(t('wall.empty'))}</div></div>
    <p class="note">${escapeHtml(t('wall.virtualNote'))}</p>`;
}

function defaultsHTML() {
  const p = state.prefs;
  const num = (pref, label) => `
    <div class="field"><label>${escapeHtml(label)}</label>
      <div class="unit-field">
        <input type="number" data-pref="${pref}" value="${escapeHtml(p[pref])}" />
        <small>mm</small>
      </div>
    </div>`;
  return `
    <section class="defaults">
      <h2 class="panel-title">${escapeHtml(t('defaults.title'))}</h2>
      ${num('wallThickness', t('defaults.wall'))}
      ${num('exteriorThickness', t('defaults.exterior'))}
      ${num('doorWidth', t('defaults.doorW'))}
      ${num('doorHeight', t('defaults.doorH'))}
      ${num('windowWidth', t('defaults.windowW'))}
      ${num('windowHeight', t('defaults.windowH'))}
      ${num('windowSill', t('defaults.sill'))}
      <label class="check"><input type="checkbox" data-pref="furnitureSnap" ${p.furnitureSnap ? 'checked' : ''}/>${escapeHtml(t('defaults.snap'))}</label>
    </section>`;
}

function catalogHTML() {
  const q = '';
  void q;
  const groups = catalogCategories().map((category) => {
    const key = CAT_KEYS[category] || '';
    const items = CATALOG.filter((item) => item.category === category).map((item) => {
      const name = furnName(item);
      return `<button type="button" class="furn-item" data-furn="${escapeHtml(item.type)}" data-name="${escapeHtml(`${item.name} ${item.nameEn}`)}">
        ${legendThumb(item)}
        <span>${escapeHtml(name)}</span>
        <small>${item.w}×${item.d}</small>
      </button>`;
    }).join('');
    return `<div class="cat-label">${escapeHtml(key ? t(key) : category)}</div>${items}`;
  }).join('');
  return `
    <h2 class="panel-title">${escapeHtml(t('tool.library'))}</h2>
    <input class="search" data-search placeholder="${escapeHtml(t('furn.search'))}" />
    ${groups}`;
}

function furnName(item) {
  const key = `furn.type.${item.type}`;
  if (state.messages && Object.prototype.hasOwnProperty.call(state.messages, key)) return t(key);
  return state.prefs?.lang === 'en' ? item.nameEn : item.name;
}

function legendThumb(item) {
  const legend = legendForType(item.type);
  if (!legend) return `<span class="swatch" style="background:${escapeHtml(item.color)}"></span>`;
  return `<span class="furn-mark"><svg viewBox="${escapeHtml(legend.viewBox)}" aria-hidden="true">${legend.inner}</svg></span>`;
}

function inspectorHTML() {
  const live = state.store && state.floorId ? liveDerive(state.floorId) : null;
  if (state.tool === 'wall' && state.chain) return drawingInspector(live);
  if (!state.selection) return emptyInspector(live);
  if (state.selection.kind === 'wall') return wallInspector(live);
  if (state.selection.kind === 'room') return roomInspector(live);
  if (state.selection.kind === 'opening') return openingInspector();
  if (state.selection.kind === 'furniture') return furnitureInspector();
  return emptyInspector(live);
}

function unclosedBlock(live) {
  const gap = live?.unclosed?.gap;
  if (!(gap > 1)) return '';
  return `<p class="warn">${escapeHtml(t('toast.unclosed', { n: formatMm(gap) }))}</p>`;
}

function errorBlock() {
  return state.formError ? `<p class="err">${escapeHtml(state.formError)}</p>` : '';
}

function drawingInspector(live) {
  const n = state.chain?.points?.length || 0;
  return `<h2 class="panel-title">${escapeHtml(t('inspector.drawing'))}</h2>
    <p class="note">${escapeHtml(t('hint.wall'))}</p>
    <p class="num">${n}</p>
    ${unclosedBlock(live)}`;
}

function emptyInspector(live) {
  const rooms = live?.rooms || [];
  const faces = live?.derived || [];
  const areaOf = new Map(faces.map((face) => [face.roomId, face.areaM2 || 0]));
  const total = live ? formatAreaM2(suiteNetM2(live.derived, live.rooms)) : formatAreaM2(0);
  const rows = rooms.map((room) => {
    const on = state.selection?.kind === 'room' && state.selection.id === room.id ? 'is-on' : '';
    return `<button type="button" class="room-row ${on}" data-room="${escapeHtml(room.id)}">
      <span>${escapeHtml(room.name)}</span>
      <span class="num">${escapeHtml(formatAreaM2(areaOf.get(room.id) || 0))} m²</span>
    </button>`;
  }).join('');
  return `<h2 class="panel-title">${escapeHtml(t('net.heading'))}</h2>
    <p class="total">${escapeHtml(t('net.total', { area: total }))}</p>
    ${rows || `<p class="note">${escapeHtml(t('inspector.empty'))}</p>`}
    ${unclosedBlock(live)}`;
}

function wallInspector(live) {
  const floor = ensureFloor();
  const wall = floor?.walls.find((item) => item.id === state.selection.id);
  if (!wall) return emptyInspector(live);
  return `<h2 class="panel-title">${escapeHtml(t('inspector.wall'))}</h2>
    ${errorBlock()}
    <div class="field"><label>${escapeHtml(t('wall.thickness'))}</label>
      <input type="number" data-field="wall-thickness" min="60" max="500" value="${wall.thickness}" />
      <span class="note">${escapeHtml(t('wall.thicknessHint'))}</span>
    </div>
    <div class="field"><label>${escapeHtml(t('wall.type'))}</label>
      <div class="seg wide">
        <button type="button" data-action="wall-virtual" data-value="0" class="${wall.virtual ? '' : 'is-on'}">${escapeHtml(t('wall.solid'))}</button>
        <button type="button" data-action="wall-virtual" data-value="1" class="${wall.virtual ? 'is-on' : ''}">${escapeHtml(t('wall.virtual'))}</button>
      </div>
    </div>
    <label class="check"><input type="checkbox" data-field="wall-bearing" ${wall.bearing ? 'checked' : ''} ${wall.virtual ? 'disabled' : ''}/>${escapeHtml(t('wall.bearing'))}</label>
    <label class="check"><input type="checkbox" data-field="wall-exterior" ${wall.exterior ? 'checked' : ''}/>${escapeHtml(t('wall.exterior'))}</label>
    <div class="field"><label>${escapeHtml(t('wall.height'))}</label>
      <input type="number" data-field="wall-height" value="${wall.height ?? ''}" />
    </div>
    <button type="button" class="btn danger" data-action="demolish">${escapeHtml(t('demolish.confirm'))}</button>
    <button type="button" class="btn" data-action="delete-selection">${escapeHtml(t('inspector.delete'))}</button>
    ${unclosedBlock(live)}`;
}

function roomInspector(live) {
  const floor = ensureFloor();
  const room = floor?.rooms.find((item) => item.id === state.selection.id);
  const face = live?.derived?.find((item) => item.roomId === state.selection.id);
  if (!room) return emptyInspector(live);
  return `<h2 class="panel-title">${escapeHtml(t('inspector.room'))}</h2>
    <div class="field"><label>${escapeHtml(t('room.name'))}</label>
      <input data-field="room-name" value="${escapeHtml(room.name)}" />
    </div>
    <div class="field"><label>${escapeHtml(t('room.type'))}</label>
      <select data-field="room-type">${typeOptions(room.type)}</select>
    </div>
    <div class="field"><label>${escapeHtml(t('room.floor'))}</label>
      <select data-field="room-floor">${materialOptions(room.floor)}</select>
    </div>
    <p class="total">${escapeHtml(t('net.room', { area: formatAreaM2(face?.areaM2 || 0) }))}</p>`;
}

function typeOptions(current) {
  const types = ROOM_TYPES.includes(current) || !current ? [...ROOM_TYPES] : [current, ...ROOM_TYPES];
  return types.map((type) => {
    const label = state.messages[`room.type.${type}`] ? t(`room.type.${type}`) : type;
    return `<option value="${escapeHtml(type)}"${type === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function materialOptions(current) {
  const list = MATERIALS.includes(current) || !current ? [...MATERIALS] : [current, ...MATERIALS];
  return list.map((id) => {
    const label = state.messages[`material.${id}`] ? t(`material.${id}`) : id;
    return `<option value="${escapeHtml(id)}"${id === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function openingInspector() {
  const floor = ensureFloor();
  const opening = floor?.openings.find((item) => item.id === state.selection.id);
  if (!opening) return emptyInspector(state.floorId ? liveDerive(state.floorId) : null);
  const kinds = [['door', 'opening.door'], ['slide', 'opening.slide'], ['window', 'opening.window']];
  if (!kinds.some((item) => item[0] === opening.kind)) kinds.push([opening.kind, '']);
  const kindButtons = kinds.map(([kind, key]) => {
    const label = key ? t(key) : kind;
    return `<button type="button" data-action="opening-kind" data-value="${escapeHtml(kind)}" class="${opening.kind === kind ? 'is-on' : ''}">${escapeHtml(label)}</button>`;
  }).join('');
  const widths = [700, 800, 900].map((value) => `<button type="button" data-action="opening-width" data-value="${value}" class="${opening.width === value ? 'is-on' : ''}">${value}</button>`).join('');
  const swing = opening.kind === 'window' ? '' : `
    <div class="field"><label>${escapeHtml(t('opening.swing'))}</label>
      <div class="seg wide">
        <button type="button" data-action="opening-swing" data-value="in" class="${opening.swing === 'out' ? '' : 'is-on'}">${escapeHtml(t('opening.swingIn'))}</button>
        <button type="button" data-action="opening-swing" data-value="out" class="${opening.swing === 'out' ? 'is-on' : ''}">${escapeHtml(t('opening.swingOut'))}</button>
      </div>
    </div>
    <div class="field"><label>${escapeHtml(t('opening.hinge'))}</label>
      <div class="seg wide">
        <button type="button" data-action="opening-hinge" data-value="left" class="${opening.hinge === 'right' ? '' : 'is-on'}">${escapeHtml(t('opening.left'))}</button>
        <button type="button" data-action="opening-hinge" data-value="right" class="${opening.hinge === 'right' ? 'is-on' : ''}">${escapeHtml(t('opening.right'))}</button>
      </div>
    </div>`;
  return `<h2 class="panel-title">${escapeHtml(t('inspector.opening'))}</h2>
    ${errorBlock()}
    <div class="field"><label>${escapeHtml(t('opening.type'))}</label><div class="seg wide">${kindButtons}</div></div>
    <div class="field"><label>${escapeHtml(t('opening.width'))}</label>
      <div class="presets">${widths}<span class="note">${escapeHtml(t('opening.custom'))}</span></div>
      <input type="number" data-field="opening-width" value="${opening.width}" />
    </div>
    ${swing}
    <div class="field"><label>${escapeHtml(t('opening.height'))}</label>
      <input type="number" data-field="opening-height" value="${opening.height}" />
    </div>
    <div class="field"><label>${escapeHtml(t('opening.sill'))}</label>
      <input type="number" data-field="opening-sill" value="${opening.sill}" />
    </div>
    <button type="button" class="btn" data-action="opening-center">${escapeHtml(t('opening.center'))}</button>
    <button type="button" class="btn" data-action="delete-selection">${escapeHtml(t('inspector.delete'))}</button>`;
}

function furnitureInspector() {
  const floor = ensureFloor();
  const item = floor?.furniture.find((entry) => entry.id === state.selection.id);
  if (!item) return emptyInspector(state.floorId ? liveDerive(state.floorId) : null);
  const num = (field, label, value) => `
    <div class="field"><label>${escapeHtml(label)}</label>
      <input type="number" data-field="${field}" min="50" max="6000" value="${value}" />
    </div>`;
  const partners = overlapPartners(floor.furniture, item.id);
  const warn = partners.length
    ? `<p class="warn">${iconSvg('warning', 16)}<span>${escapeHtml(t('collision.inspector', { name: furnLabel(partners[0]) }))}</span></p>`
    : '';
  return `<h2 class="panel-title">${escapeHtml(t('inspector.furniture'))}</h2>
    ${warn}
    <div class="field"><label>${escapeHtml(t('furn.name'))}</label>
      <input data-field="furn-name" value="${escapeHtml(item.name)}" />
    </div>
    ${num('furn-w', t('furn.w'), item.w)}
    ${num('furn-d', t('furn.d'), item.d)}
    ${num('furn-h', t('furn.h'), item.h ?? 750)}
    <div class="field"><label>${escapeHtml(t('furn.color'))}</label>
      <input type="color" data-field="furn-color" value="${escapeHtml(item.color || '#888888')}" />
    </div>
    <button type="button" class="btn" data-action="duplicate-selection">${escapeHtml(t('furn.duplicate'))}</button>
    <button type="button" class="btn" data-action="delete-selection">${escapeHtml(t('furn.delete'))}</button>`;
}

function renderCanvas() {
  if (!view) return;
  const model = buildModel();
  view.render(model);
  renderFab();
  noteOverlap(model.overlap);
}

function buildModel() {
  const camera = state.camera;
  const floor = ensureFloor();
  const cursor = cursorFor();
  if (!floor || !state.store) {
    return {
      camera, cursor, rooms: [], walls: [], openings: [], furniture: [],
      labels: [], handles: [], guides: state.snap?.guides || [], bubbles: [], lower: null,
      exteriorDims: null, entryMark: null,
    };
  }
  const live = liveDerive(state.floorId);
  const drawn = floorGraphics(floor, live, {
    labels: true,
    selected: state.selection,
    condemnedId: state.condemnedId,
    shakeId: state.shakeId,
    mergeId: state.mergeId,
  });
  if (state.chain && state.snap && state.tool === 'wall') {
    const origin = state.chain.points[state.chain.points.length - 1];
    const style = wallStyle();
    drawn.walls.push({
      id: 'preview-wall',
      a: { x: origin.x, y: origin.y },
      b: { x: state.snap.point.x, y: state.snap.point.y },
      thickness: style.thickness,
      virtual: style.virtual,
      preview: true,
    });
  }
  if (state.openingPreview && (state.tool === 'door' || state.tool === 'window')) {
    const preview = state.openingPreview;
    const wall = floor.walls.find((item) => item.id === preview.wallId);
    drawn.openings.push({
      id: 'preview',
      a: { x: preview.ax, y: preview.ay },
      b: { x: preview.bx, y: preview.by },
      thickness: wall?.thickness || 240,
      preview: true,
      ok: !!preview.ok,
      opening: {
        t: preview.t,
        width: preview.width,
        height: preview.height,
        sill: preview.sill,
        hinge: preview.hinge,
        swing: preview.swing,
        kind: preview.kind,
      },
    });
  }
  const quads = [];
  for (const wall of floor.walls) {
    if (wall.virtual || wall.demolished) continue;
    const a = drawn.nodes.get(wall.a);
    const b = drawn.nodes.get(wall.b);
    if (!a || !b) continue;
    quads.push(wallQuad(a, b, wall.thickness, false));
  }
  const warns = warningIds(floor.furniture || [], quads, live.derived || []);
  let hoverId = '';
  if (state.hoverWorld) {
    const hit = hitTest({
      floor,
      derived: live,
      world: state.hoverWorld,
      pxPerMm: state.camera.k,
      selection: state.selection,
      mode: state.mode === 'furnish' ? 'furnish' : 'plan',
    });
    if (hit?.kind === 'furniture') hoverId = hit.id;
  }
  const furniture = (floor.furniture || []).map((item) => ({
    id: item.id,
    item,
    type: item.type,
    shape: shapeOf(item),
    warn: warns.has(item.id),
    hover: hoverId === item.id,
    selected: state.selection?.kind === 'furniture' && state.selection.id === item.id,
  }));
  const overlap = firstOverlap(floor.furniture || []);
  const bubbles = [];
  if (state.chain && state.snap && state.snap.length != null && state.tool === 'wall') {
    const origin = state.chain.points[state.chain.points.length - 1];
    bubbles.push({
      id: 'length',
      x: (origin.x + state.snap.point.x) / 2,
      y: (origin.y + state.snap.point.y) / 2,
      text: t('bubble.length', { length: formatMm(state.snap.length), angle: formatAngle(state.snap.angle || 0) }),
      tone: 'dark',
    });
  }
  if (state.openingPreview && (state.tool === 'door' || state.tool === 'window')) {
    const preview = state.openingPreview;
    const x = preview.ax + (preview.bx - preview.ax) * (preview.t || 0);
    const y = preview.ay + (preview.by - preview.ay) * (preview.t || 0);
    bubbles.push({
      id: 'opening',
      x,
      y,
      text: preview.ok ? formatMm(preview.width) : explainOpening(preview),
      tone: 'dark',
    });
  }
  const handles = [];
  if (state.selection?.kind === 'wall' && state.tool === 'select') {
    const wall = floor.walls.find((item) => item.id === state.selection.id && !item.demolished);
    if (wall) {
      for (const id of [wall.a, wall.b]) {
        const node = drawn.nodes.get(id);
        if (node) handles.push({ id, x: node.x, y: node.y });
      }
    }
  }
  if (state.selection?.kind === 'furniture' && (state.mode === 'furnish' || state.tool === 'select')) {
    const item = floor.furniture.find((entry) => entry.id === state.selection.id);
    if (item) {
      const handle = rotateHandlePoint(item);
      handles.push({ id: `rot-${item.id}`, x: handle.x, y: handle.y, x2: item.cx, y2: item.cy });
    }
  }
  let dimension = null;
  if (state.selection?.kind === 'wall') {
    const wall = floor.walls.find((item) => item.id === state.selection.id && !item.demolished && !item.virtual);
    const a = wall && drawn.nodes.get(wall.a);
    const b = wall && drawn.nodes.get(wall.b);
    if (a && b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (wall.thickness || 0) / 2 + 180;
      const nx = -dy / len;
      const ny = dx / len;
      dimension = {
        a: { x: a.x + nx * off, y: a.y + ny * off },
        b: { x: b.x + nx * off, y: b.y + ny * off },
        text: formatMm(len),
      };
    }
  }
  let measure = null;
  if (state.measure?.a && state.measure?.b) measure = state.measure;
  else if (state.measure?.a && state.snap && state.tool === 'measure') {
    measure = {
      a: state.measure.a,
      b: state.snap.point,
      text: formatMm(state.snap.length || 0),
    };
  }
  const below = floorBelow(state.store.getPlan(), state.floorId);
  let lower = null;
  if (below) {
    let derived = null;
    try { derived = deriveRooms(state.store.getPlan(), below.id); } catch { derived = null; }
    if (derived) {
      const ghost = floorGraphics(below, derived, { labels: false });
      lower = { rooms: ghost.rooms, walls: ghost.walls, openings: ghost.openings };
    }
  }
  return {
    camera,
    cursor,
    rooms: drawn.rooms,
    walls: drawn.walls,
    openings: drawn.openings,
    furniture,
    labels: layoutLabels(drawn.labels, drawn.rooms, drawn.openings, state.camera.k),
    overlap,
    handles,
    guides: state.snap?.guides || [],
    bubbles,
    gap: gapBox(live.unclosed),
    measure,
    dimension,
    snap: state.snap?.kind === 'endpoint' ? { x: state.snap.point.x, y: state.snap.point.y, kind: 'endpoint' } : null,
    lower,
    exteriorDims: exteriorDimensions(floor),
    entryMark: entryMarkFor(floor),
  };
}

function entryMarkFor(floor) {
  const mark = entryMarker(floor);
  if (!mark) return null;
  return { ...mark, label: t('plan.entry') };
}

function shapeOf(item) {
  return catalogEntry(item.type)?.shape || 'box';
}

function textPx(text, size) {
  let width = 0;
  for (const ch of text || '') width += ch.charCodeAt(0) > 255 ? size : size * 0.6;
  return width;
}

function layoutLabels(labels, rooms, openings, k) {
  return (labels || []).map((label) => {
    const room = (rooms || []).find((item) => item.id === label.id);
    if (!room?.points || room.points.length < 3) return label;
    const swings = [];
    for (const item of openings || []) {
      const opening = item.opening;
      if (!opening || item.preview || opening.kind === 'window' || opening.kind === 'slide') continue;
      const geom = openingGeometry(item.a, item.b, opening);
      const mid = {
        x: geom.hinge.x + geom.normal.x * (opening.width || 0) * 0.55,
        y: geom.hinge.y + geom.normal.y * (opening.width || 0) * 0.55,
      };
      if (!pointInPolygon(mid, room.points)) continue;
      swings.push(swingSectorBBox(geom.hinge, geom.jamb, geom.leaf));
    }
    const placed = placeRoomLabel({
      polygon: room.points,
      at: { x: label.x, y: label.y },
      swings,
      boxW: Math.max(textPx(label.name, 13), textPx(label.area, 12)) + 6,
      boxH: 32,
      nameH: 16,
      k: k || 0.05,
    });
    return { ...label, x: placed.x, y: placed.y, nameOnly: placed.nameOnly };
  });
}

function furnLabel(item) {
  if (!item) return '';
  if (item.name) return item.name;
  const entry = catalogEntry(item.type);
  if (!entry) return '';
  return state.prefs?.lang === 'en' ? entry.nameEn : entry.name;
}

function noteOverlap(pair) {
  if (state.overlapNoted || !pair) return;
  state.overlapNoted = true;
  showHint(t('collision.hint', { a: furnLabel(pair.a), b: furnLabel(pair.b) }), { top: true, icon: 'warning' });
}

function floorGraphics(floor, derived, opts) {
  const nodes = new Map((floor.nodes || []).map((node) => [node.id, node]));
  const rooms = [];
  const labels = [];
  const typeOf = new Map((derived?.rooms || []).map((room) => [room.id, room]));
  for (const face of derived?.derived || []) {
    const points = face.polygon?.length >= 3 ? face.polygon : face.centerline;
    if (!points || points.length < 3) continue;
    const room = typeOf.get(face.roomId);
    rooms.push({
      id: String(face.roomId),
      points,
      fill: roomFillVar(room?.type),
      merge: opts.mergeId === face.roomId,
    });
    if (opts.labels !== false) {
      const at = face.centroid || points[0];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      labels.push({
        id: String(face.roomId),
        x: at.x,
        y: at.y,
        name: room?.name || '',
        area: t('net.room', { area: formatAreaM2(face.areaM2 || 0) }),
        minX, minY, maxX, maxY,
      });
    }
  }
  const walls = (floor.walls || []).flatMap((wall) => {
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) return [];
    return [{
      id: wall.id,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      thickness: wall.thickness,
      virtual: !!wall.virtual,
      bearing: !!wall.bearing,
      demolished: !!wall.demolished,
      selected: opts.selected?.kind === 'wall' && opts.selected.id === wall.id,
      condemned: opts.condemnedId === wall.id,
      shake: opts.shakeId === wall.id,
    }];
  });
  const openings = (floor.openings || []).flatMap((opening) => {
    const wall = (floor.walls || []).find((item) => item.id === opening.wall);
    if (!wall || wall.demolished) return [];
    const a = nodes.get(wall.a);
    const b = nodes.get(wall.b);
    if (!a || !b) return [];
    return [{
      id: opening.id,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      thickness: wall.virtual ? 80 : wall.thickness,
      opening,
    }];
  });
  return { rooms, labels, walls, openings, nodes };
}

function gapBox(unclosed) {
  const gap = unclosed?.gap;
  const ends = unclosed?.endpoints || [];
  if (!(gap > 1) || ends.length < 2) return null;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < ends.length; i += 1) {
    for (let j = i + 1; j < ends.length; j += 1) {
      const d = Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y);
      if (d < bestD) {
        bestD = d;
        best = [ends[i], ends[j]];
      }
    }
  }
  if (!best) return null;
  const pad = 80;
  return {
    x: Math.min(best[0].x, best[1].x) - pad,
    y: Math.min(best[0].y, best[1].y) - pad,
    w: Math.abs(best[1].x - best[0].x) + pad * 2,
    h: Math.abs(best[1].y - best[0].y) + pad * 2,
    text: t('toast.unclosed', { n: formatMm(gap) }),
  };
}

function cursorFor() {
  if (state.walkPick) return 'crosshair';
  if (state.gesture?.kind === 'pan') return 'grabbing';
  if (state.space || state.tool === 'pan') return 'grab';
  if ((state.tool === 'door' || state.tool === 'window') && state.openingPreview && !state.openingPreview.ok) return 'not-allowed';
  if (state.tool === 'wall' || state.tool === 'door' || state.tool === 'window' || state.tool === 'measure' || state.tool === 'demolish') return 'crosshair';
  return 'default';
}

function phoneFitFrame(size) {
  if (layoutName() !== 'phone' || !svg) return null;
  const rect = svg.getBoundingClientRect();
  let left = 16;
  const rail = ui.tools;
  if (rail) {
    const style = getComputedStyle(rail);
    const shown = style.display !== 'none' && style.visibility !== 'hidden' && !rail.hidden;
    if (shown) {
      const box = rail.getBoundingClientRect();
      if (box.width > 8 && box.right > rect.left) left = Math.max(16, box.right - rect.left + 16);
    }
  }
  let sheetH = 0;
  const sheet = ui.sheet;
  if (sheet && getComputedStyle(sheet).display !== 'none') {
    const handle = sheet.querySelector('.sheet-handle')?.getBoundingClientRect().height || 0;
    const tabs = sheet.querySelector('.sheet-tabs')?.getBoundingClientRect().height || 0;
    sheetH = handle + tabs;
  }
  const top = 16;
  // 16 px keeps the tool strip off the walls. The extra right inset leaves
  // the entry label (about 28 px outside the outer face) on screen.
  const right = Math.max(left + 48, size.w - 48);
  const bottom = Math.max(top + 48, size.h - sheetH - 8);
  return { left, top, right, bottom };
}

function fitCamera() {
  const size = view?.size() || { w: 0, h: 0 };
  if (size.w < 20 || size.h < 20) {
    state.refit = true;
    return;
  }
  state.refit = false;
  const floor = ensureFloor();
  const pts = [];
  if (floor) {
    for (const node of floor.nodes || []) pts.push(node);
    for (const item of floor.furniture || []) {
      pts.push({ x: item.cx - item.w / 2, y: item.cy - item.d / 2 });
      pts.push({ x: item.cx + item.w / 2, y: item.cy + item.d / 2 });
    }
  }
  const frame = phoneFitFrame(size);
  if (!pts.length) {
    state.camera.k = 0.05;
    if (frame) {
      state.camera.x = (frame.left + frame.right) / 2;
      state.camera.y = (frame.top + frame.bottom) / 2;
    } else {
      state.camera.x = size.w / 2;
      state.camera.y = size.h / 2;
    }
  } else {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of pts) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    if (frame) {
      const spanW = Math.max(1, maxX - minX);
      const spanH = Math.max(1, maxY - minY);
      const band = dimensionBandPx();
      const faceMm = 120;
      const measure = (extra) => {
        const availW = Math.max(48, frame.right - frame.left - extra);
        const availH = Math.max(48, frame.bottom - frame.top - extra);
        return {
          extra,
          availW,
          availH,
          k: Math.min(availW / spanW, availH / spanH),
        };
      };
      let fit = measure(band);
      fit = measure(band + faceMm * fit.k);
      state.camera.k = Math.max(0.002, Math.min(2, fit.k));
      state.camera.x = frame.left + fit.extra + (fit.availW - (minX + maxX) * state.camera.k) / 2;
      state.camera.y = frame.top + fit.extra + (fit.availH - (minY + maxY) * state.camera.k) / 2;
    } else {
      const pad = 80;
      const k = Math.min((size.w - pad * 2) / Math.max(1, maxX - minX), (size.h - pad * 2) / Math.max(1, maxY - minY));
      state.camera.k = Math.max(0.002, Math.min(2, k));
      state.camera.x = (size.w - (minX + maxX) * state.camera.k) / 2;
      state.camera.y = (size.h - (minY + maxY) * state.camera.k) / 2;
    }
  }
  renderCanvas();
  renderStatus();
}

function setTool(tool, silent) {
  if (tool === 'view3d') {
    void enter3d(false);
    return;
  }
  if (state.readOnly && EDIT_TOOLS.has(tool)) {
    toast(t('share.readonly'));
    return;
  }
  const in3d = state.mode === 'view3d' || state.view3dBusy;
  if (in3d && !silent) void leave3d();
  if (tool === 'library') {
    if (!(in3d && silent)) state.mode = 'furnish';
    state.tool = 'library';
  } else if (tool === 'select' || tool === 'measure' || tool === 'pan') {
    state.tool = tool;
  } else {
    if (!(in3d && silent)) state.mode = 'plan';
    state.tool = tool;
  }
  if (tool !== 'wall') {
    state.chain = null;
    state.lengthBuf = '';
  }
  state.openingPreview = null;
  if (!silent) renderAll();
}

function setMode(mode) {
  if (mode === 'view3d') {
    void enter3d(false);
    return;
  }
  if (state.readOnly && mode === 'furnish') return;
  const leaving = state.mode === 'view3d' || state.view3dBusy;
  if (leaving) void leave3d();
  state.mode = mode;
  if (mode === 'furnish' && !['select', 'library', 'measure', 'pan'].includes(state.tool)) state.tool = 'library';
  if (mode === 'plan' && state.tool === 'library') state.tool = 'select';
  if (mode !== 'plan') {
    state.chain = null;
    state.lengthBuf = '';
  }
  if ((state.layout === 'phone' || state.layout === 'tablet') && mode === 'furnish') {
    state.sheetPage = 'library';
    if (state.sheetSnap < 1) state.sheetSnap = 1;
  }
  renderAll();
}

function wallStyle() {
  return {
    thickness: state.prefs.wallExterior ? state.prefs.exteriorThickness : state.prefs.wallThickness,
    virtual: !!state.prefs.wallVirtual,
    bearing: state.prefs.wallVirtual ? false : !!state.prefs.wallBearing,
    exterior: !!state.prefs.wallExterior,
  };
}

function openingSpec() {
  if (state.tool === 'window') {
    return {
      kind: 'window',
      width: state.prefs.windowWidth,
      height: state.prefs.windowHeight,
      sill: state.prefs.windowSill,
      hinge: 'left',
      swing: 'in',
    };
  }
  return {
    kind: 'door',
    width: state.prefs.doorWidth,
    height: state.prefs.doorHeight,
    sill: 0,
    hinge: 'left',
    swing: state.openingSwing || 'in',
  };
}

function explainOpening(preview) {
  const noun = (preview?.kind === 'window') ? t('opening.noun.window') : t('opening.noun.door');
  if (!preview) return t('opening.reason.generic', { noun });
  if (preview.code === 'OPENING_ON_VIRTUAL') return t('opening.reason.virtual');
  if (preview.code === 'OPENING_TOO_WIDE') {
    return t('opening.reason.wide', {
      noun,
      width: Math.round(preview.width || 0),
      length: Math.round(preview.segmentLength || 0),
      fix: preview.kind === 'window' ? t('opening.fix.window') : t('opening.fix.door'),
    });
  }
  if (preview.code === 'OPENING_CLEARANCE') return t('opening.reason.clearance', { noun });
  if (preview.code === 'OPENING_CROSSES_NODE') return t('opening.reason.cross', { noun });
  return t('opening.reason.generic', { noun });
}

function computeSnap(cursor, shift, lengthMm, origin) {
  const floor = ensureFloor();
  const nodes = [];
  const walls = [];
  if (floor) {
    const byId = new Map((floor.nodes || []).map((node) => [node.id, node]));
    const used = new Set();
    for (const wall of floor.walls || []) {
      if (wall.demolished) continue;
      const a = byId.get(wall.a);
      const b = byId.get(wall.b);
      if (!a || !b) continue;
      walls.push({ id: wall.id, a, b });
      if (!used.has(a.id)) { used.add(a.id); nodes.push(a); }
      if (!used.has(b.id)) { used.add(b.id); nodes.push(b); }
    }
  }
  if (state.chain) {
    state.chain.points.forEach((point, index) => {
      nodes.push({ id: point.nodeId || `chain${index}`, x: point.x, y: point.y });
    });
  }
  const useOrigin = origin === undefined
    ? (state.chain ? state.chain.points[state.chain.points.length - 1] : null)
    : origin;
  return resolveSnap({
    origin: useOrigin,
    cursor,
    nodes,
    walls,
    pxPerMm: state.camera.k,
    shift: !!shift,
    lengthMm,
  });
}

function updateHover(event) {
  if (!svg || state.pickerOpen || !state.store) return;
  const world = view.worldFromClient(event.clientX, event.clientY);
  state.hoverWorld = world;
  state.shift = !!event.shiftKey;
  if (state.tool === 'wall' && state.mode === 'plan') state.snap = computeSnap(world, event.shiftKey, null);
  else if (state.tool === 'measure') {
    const origin = state.measure && !state.measure.b ? state.measure.a : null;
    state.snap = computeSnap(world, event.shiftKey, null, origin);
  } else state.snap = null;
  if ((state.tool === 'door' || state.tool === 'window') && state.mode === 'plan') {
    state.openingPreview = previewOpening(state.store.getPlan(), state.floorId, world, openingSpec(), state.camera.k);
  } else state.openingPreview = null;
  renderCanvas();
  renderStatus();
  patchLength();
}

function patchLength() {
  const el = ui.side?.querySelector('[data-field="length"]');
  if (!el) return;
  if (state.lengthBuf) {
    el.textContent = state.lengthBuf;
    el.classList.add('is-hot');
    return;
  }
  el.classList.remove('is-hot');
  el.textContent = state.chain && state.snap?.length != null ? formatMm(state.snap.length) : t('wall.empty');
}

function placeWall(world, shift) {
  if (state.readOnly) return;
  if (!world || !state.store) return;
  const snap = computeSnap(world, shift, null);
  if (!state.chain) {
    state.chain = {
      points: [{ x: snap.point.x, y: snap.point.y, nodeId: snap.nodeId }],
      steps: 0,
    };
    state.lengthBuf = '';
    renderAll();
    return;
  }
  tryPlace(snap);
}

function placeAtLength(len) {
  if (state.readOnly) return;
  if (!state.chain) return;
  const origin = state.chain.points[state.chain.points.length - 1];
  const cursor = state.hoverWorld || { x: origin.x + 1000, y: origin.y };
  tryPlace(computeSnap(cursor, state.shift, len));
}

function tryPlace(snap) {
  const origin = state.chain.points[state.chain.points.length - 1];
  let target = { x: snap.point.x, y: snap.point.y, nodeId: snap.nodeId };
  const closing = shouldCloseChain(state.chain.points.length, target, state.chain.points[0]);
  if (closing) {
    const start = state.chain.points[0];
    target = { x: start.x, y: start.y, nodeId: start.nodeId };
  }
  if (segmentTooShort(origin, target)) return;
  const size = state.store.historySize();
  state.store.dispatch(wallAddCommand(
    state.floorId,
    { x: origin.x, y: origin.y, nodeId: origin.nodeId || undefined },
    { x: target.x, y: target.y, nodeId: target.nodeId || undefined },
    wallStyle(),
  ));
  if (state.store.historySize() === size) return;
  state.lengthBuf = '';
  if (closing) {
    const live = liveDerive(state.floorId);
    state.chain = null;
    showPill(t('pill.rooms', { n: live.derived.length }));
  } else {
    state.chain.points.push(target);
    state.chain.steps += 1;
    bindChainNodes();
  }
  renderAll();
}

function bindChainNodes() {
  if (!state.chain) return;
  const floor = ensureFloor();
  if (!floor) return;
  for (const point of state.chain.points) {
    const node = (floor.nodes || []).find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= 1.5);
    point.nodeId = node ? node.id : null;
  }
}

function placeOpening() {
  if (state.readOnly) return;
  const preview = state.openingPreview;
  if (!preview?.ok || !state.store) return;
  const spec = openingSpec();
  const opening = {
    id: uniqueId('o'),
    wall: preview.wallId,
    t: preview.t,
    kind: spec.kind,
    width: spec.width,
    height: spec.height,
    sill: spec.sill,
    hinge: 'left',
    swing: spec.kind === 'window' ? 'in' : (state.openingSwing || 'in'),
  };
  const size = state.store.historySize();
  state.store.dispatch(openingAddCommand(state.floorId, opening));
  if (state.store.historySize() === size) {
    toast(explainOpening(preview), 'danger');
    return;
  }
  state.selection = { kind: 'opening', id: opening.id };
  state.formError = '';
  renderAll();
}

function placeMeasure(shift) {
  const origin = state.measure && !state.measure.b ? state.measure.a : null;
  const snap = computeSnap(state.hoverWorld, shift, null, origin);
  const point = { x: snap.point.x, y: snap.point.y };
  if (!state.measure || state.measure.b) state.measure = { a: point };
  else if (!segmentTooShort(state.measure.a, point, 1)) {
    state.measure = {
      a: state.measure.a,
      b: point,
      text: formatMm(Math.hypot(point.x - state.measure.a.x, point.y - state.measure.a.y)),
    };
  }
  renderCanvas();
}

function pick(world) {
  const floor = ensureFloor();
  if (!floor) return null;
  return hitTest({
    floor,
    derived: liveDerive(state.floorId),
    world,
    pxPerMm: state.camera.k,
    selection: state.selection,
    mode: state.mode === 'furnish' ? 'furnish' : 'plan',
    prefer: state.tool === 'room' ? 'room' : undefined,
  });
}

function selectFromHit(hit) {
  if (!hit) {
    state.selection = null;
  } else if (hit.kind === 'node') state.selection = { kind: 'wall', id: hit.wallId };
  else if (hit.kind === 'rotate') state.selection = { kind: 'furniture', id: hit.id };
  else state.selection = { kind: hit.kind, id: hit.id };
  state.formError = '';
  if (state.layout === 'phone' && state.selection && (state.readOnly || state.sheetPage === 'props')) {
    if (state.readOnly) {
      state.sheetPage = 'props';
      if (state.sheetSnap < 1) state.sheetSnap = 1;
    }
  }
  renderChrome();
}

function onPointerDown(event) {
  const handle = event.target.closest?.('[data-sheet-handle]');
  if (handle && event.button === 0) {
    state.sheetDrag = { pointerId: event.pointerId, y: event.clientY, snap: state.sheetSnap };
    return;
  }
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.pointers.size >= 2) {
    cancelGesture();
    return;
  }
  const furn = event.target.closest?.('[data-furn]');
  if (furn && event.button === 0 && !state.pickerOpen && !state.readOnly) {
    event.preventDefault();
    startFurn(furn, event);
    return;
  }
  if (event.button === 1) event.preventDefault();
  if (!event.target.closest?.('.plan-svg') || state.pickerOpen || svg.hidden) return;
  const world = view.worldFromClient(event.clientX, event.clientY);
  state.hoverWorld = world;
  if (event.button === 1 || state.space || state.tool === 'pan') {
    state.gesture = { kind: 'pan', pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    return;
  }
  if (event.button !== 0 || state.mode === 'view3d') return;
  if (state.walkPick) {
    void beginWalkAt(world);
    return;
  }
  if (state.readOnly && state.tool !== 'measure') {
    const hit = pick(world);
    state.gesture = {
      kind: 'select',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      world,
      hit,
      moved: false,
    };
    if (hit && hit.kind !== 'node' && hit.kind !== 'rotate') selectFromHit(hit);
    return;
  }
  if (state.tool === 'wall' && state.mode === 'plan') {
    state.gesture = { kind: 'wall', pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    return;
  }
  if ((state.tool === 'door' || state.tool === 'window') && state.mode === 'plan') {
    state.gesture = { kind: 'door', pointerId: event.pointerId };
    updateHover(event);
    return;
  }
  if (state.tool === 'measure') {
    state.gesture = { kind: 'measure', pointerId: event.pointerId };
    return;
  }
  if (state.tool === 'demolish') {
    state.gesture = { kind: 'demolish', pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    return;
  }
  const hit = pick(world);
  state.gesture = {
    kind: 'select',
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    world,
    hit,
    moved: false,
  };
  if (hit && hit.kind !== 'node' && hit.kind !== 'rotate') selectFromHit(hit);
}

function onPointerMove(event) {
  if (state.sheetDrag && state.sheetDrag.pointerId === event.pointerId) {
    const dy = state.sheetDrag.y - event.clientY;
    const steps = Math.trunc(dy / 48);
    if (steps !== 0) {
      state.sheetSuppressClick = true;
      const next = Math.max(0, Math.min(2, state.sheetDrag.snap + steps));
      if (next !== state.sheetSnap) {
        state.sheetSnap = next;
        syncSheet();
      }
    }
    return;
  }
  if (state.pointers.has(event.pointerId)) {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  if (state.pointers.size >= 2) {
    if (state.mode !== 'view3d' && !svg.hidden) pinch();
    return;
  }
  if (state.furnDrag) {
    moveFurnGhost(event);
    return;
  }
  if (!state.gesture) {
    if (event.target.closest?.('.plan-svg') || state.tool === 'wall' || state.tool === 'door' || state.tool === 'window') {
      updateHover(event);
    }
    return;
  }
  if (state.gesture.kind === 'pan') {
    state.camera.x += event.clientX - state.gesture.x;
    state.camera.y += event.clientY - state.gesture.y;
    state.gesture.x = event.clientX;
    state.gesture.y = event.clientY;
    renderCanvas();
    renderStatus();
    return;
  }
  if (state.gesture.kind === 'select') {
    const dist = Math.hypot(event.clientX - state.gesture.x, event.clientY - state.gesture.y);
    if (!state.gesture.drag && dist < 4) return;
    state.gesture.moved = true;
    const world = view.worldFromClient(event.clientX, event.clientY);
    if (!state.gesture.drag) {
      const drag = beginSelectionDrag(state.gesture.hit, state.gesture.world);
      if (!drag) return;
      state.gesture.drag = drag;
      state.store.begin();
    }
    applySelectionDrag(state.gesture.drag, world, event.shiftKey);
    return;
  }
  if (state.gesture.kind === 'demolish') {
    if (Math.hypot(event.clientX - state.gesture.x, event.clientY - state.gesture.y) > 4) state.gesture.moved = true;
  }
  updateHover(event);
}

function onPointerUp(event, cancel) {
  if (state.sheetDrag && state.sheetDrag.pointerId === event.pointerId) {
    state.sheetDrag = null;
    return;
  }
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.pinch = null;
  if (state.furnDrag && state.furnDrag.pointerId === event.pointerId) {
    const drag = state.furnDrag;
    state.furnDrag = null;
    ui.ghost.hidden = true;
    if (!cancel) finishFurn(drag, event);
    return;
  }
  if (state.pointers.size >= 1) return;
  const gesture = state.gesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  state.gesture = null;
  if (cancel || gesture.kind === 'pan') {
    if (state.store?.isTransacting()) state.store.cancel();
    renderAll();
    return;
  }
  if (gesture.kind === 'select') {
    finishSelect(gesture);
    return;
  }
  updateHover(event);
  if (gesture.kind === 'wall') placeWall(state.hoverWorld, event.shiftKey);
  else if (gesture.kind === 'door') placeOpening();
  else if (gesture.kind === 'measure') placeMeasure(event.shiftKey);
  else if (gesture.kind === 'demolish' && !gesture.moved) demolishAt(state.hoverWorld);
}

function cancelGesture() {
  if (state.store?.isTransacting()) state.store.cancel();
  state.gesture = null;
  state.furnDrag = null;
  ui.ghost.hidden = true;
}

function pinch() {
  const pts = [...state.pointers.values()];
  if (pts.length < 2) return;
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  const midX = (pts[0].x + pts[1].x) / 2;
  const midY = (pts[0].y + pts[1].y) / 2;
  if (state.pinch) {
    zoomAt(midX, midY, dist / state.pinch.dist);
    state.camera.x += midX - state.pinch.midX;
    state.camera.y += midY - state.pinch.midY;
    renderCanvas();
    renderStatus();
  }
  state.pinch = { dist, midX, midY };
}

function zoomAt(clientX, clientY, factor) {
  const rect = svg.getBoundingClientRect();
  const worldX = (clientX - rect.left - state.camera.x) / state.camera.k;
  const worldY = (clientY - rect.top - state.camera.y) / state.camera.k;
  const next = Math.max(0.002, Math.min(4, state.camera.k * factor));
  state.camera.k = next;
  state.camera.x = clientX - rect.left - worldX * next;
  state.camera.y = clientY - rect.top - worldY * next;
}

function onWheel(event) {
  if (state.pickerOpen) return;
  event.preventDefault();
  if (event.ctrlKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
  } else {
    state.camera.x -= event.deltaX;
    state.camera.y -= event.deltaY;
  }
  renderCanvas();
  renderStatus();
}

function beginSelectionDrag(hit, world) {
  if (state.readOnly) return null;
  const floor = ensureFloor();
  if (!hit || !floor) return null;
  if (hit.kind === 'node') {
    const node = floor.nodes.find((item) => item.id === hit.id);
    if (!node) return null;
    return { kind: 'node', ids: [{ id: node.id, x: node.x, y: node.y }], world };
  }
  if (hit.kind === 'wall') {
    const wall = floor.walls.find((item) => item.id === hit.id && !item.demolished);
    if (!wall) return null;
    const a = floor.nodes.find((item) => item.id === wall.a);
    const b = floor.nodes.find((item) => item.id === wall.b);
    if (!a || !b) return null;
    return {
      kind: 'wall',
      ids: [{ id: a.id, x: a.x, y: a.y }, { id: b.id, x: b.x, y: b.y }],
      world,
    };
  }
  if (hit.kind === 'furniture' || hit.kind === 'rotate') {
    const item = floor.furniture.find((entry) => entry.id === hit.id);
    if (!item) return null;
    return { kind: hit.kind === 'rotate' ? 'rotate' : 'furniture', item: { ...item }, world };
  }
  return null;
}

function applySelectionDrag(drag, world, shift) {
  if (drag.kind === 'node' || drag.kind === 'wall') {
    const dx = world.x - drag.world.x;
    const dy = world.y - drag.world.y;
    state.store.dispatch(nodesMoveCommand(state.floorId, drag.ids.map((node) => ({
      id: node.id,
      x: node.x + dx,
      y: node.y + dy,
    }))));
    return;
  }
  if (drag.kind === 'furniture') {
    let cx = drag.item.cx + (world.x - drag.world.x);
    let cy = drag.item.cy + (world.y - drag.world.y);
    let rot = drag.item.rot || 0;
    if (state.prefs.furnitureSnap) {
      const floor = ensureFloor();
      const nodes = new Map((floor?.nodes || []).map((node) => [node.id, node]));
      const snapped = snapFurnitureToWall({ ...drag.item, cx, cy }, floor?.walls || [], nodes);
      if (snapped) {
        cx = snapped.cx;
        cy = snapped.cy;
        rot = snapped.rot;
      }
    }
    state.store.dispatch(furniturePatchCommand(state.floorId, drag.item.id, { cx, cy, rot }));
    return;
  }
  if (drag.kind === 'rotate') {
    let rot = angleDeg(world.x - drag.item.cx, world.y - drag.item.cy) + 90;
    if (!shift) rot = Math.round(rot / 15) * 15;
    rot = ((rot % 360) + 360) % 360;
    state.store.dispatch(furniturePatchCommand(state.floorId, drag.item.id, { rot }));
  }
}

function finishSelect(gesture) {
  if (gesture.drag) {
    if (gesture.drag.kind === 'node' || gesture.drag.kind === 'wall') {
      state.store.dispatch(bakeCommand(state.floorId));
    }
    state.store.commit();
    const floor = ensureFloor();
    if (gesture.drag.kind === 'furniture' || gesture.drag.kind === 'rotate') {
      state.selection = { kind: 'furniture', id: gesture.drag.item.id };
    } else if (gesture.hit) {
      const id = gesture.hit.kind === 'wall' ? gesture.hit.id : gesture.hit.wallId;
      state.selection = floor?.walls.some((wall) => wall.id === id) ? { kind: 'wall', id } : null;
    }
    renderAll();
    return;
  }
  if (!gesture.moved) selectFromHit(gesture.hit);
}

function startFurn(button, event) {
  if (state.readOnly) return;
  const entry = catalogEntry(button.dataset.furn);
  if (!entry || !state.store) return;
  state.furnDrag = { type: entry.type, pointerId: event.pointerId };
  ui.ghost.hidden = false;
  ui.ghost.textContent = state.prefs.lang === 'en' ? entry.nameEn : entry.name;
  moveFurnGhost(event);
}

function moveFurnGhost(event) {
  ui.ghost.style.left = `${event.clientX}px`;
  ui.ghost.style.top = `${event.clientY}px`;
}

function finishFurn(drag, event) {
  if (state.readOnly) return;
  const rect = svg.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside || svg.hidden || !state.store) return;
  const entry = catalogEntry(drag.type);
  if (!entry) return;
  const world = view.worldFromClient(event.clientX, event.clientY);
  const floor = ensureFloor();
  let pose = { cx: world.x, cy: world.y, rot: 0 };
  if (state.prefs.furnitureSnap && floor) {
    const nodes = new Map(floor.nodes.map((node) => [node.id, node]));
    const snapped = snapFurnitureToWall(
      { cx: world.x, cy: world.y, w: entry.w, d: entry.d },
      floor.walls,
      nodes,
    );
    if (snapped) pose = { cx: snapped.cx, cy: snapped.cy, rot: snapped.rot };
  }
  const item = {
    id: uniqueId('furn'),
    type: entry.type,
    name: state.prefs.lang === 'en' ? entry.nameEn : entry.name,
    cx: pose.cx,
    cy: pose.cy,
    z: 0,
    w: entry.w,
    d: entry.d,
    h: entry.h,
    rot: pose.rot || 0,
    color: entry.color,
  };
  state.store.dispatch(furnitureAddCommand(state.floorId, item));
  state.selection = { kind: 'furniture', id: item.id };
  renderAll();
}

function onKeyDown(event) {
  if (event.code === 'Space') {
    if (!typing(event.target) && !walkingNow()) {
      state.space = true;
      event.preventDefault();
    }
    return;
  }
  if (modalResolver) {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(false); }
    else if (event.key === 'Enter' && !ui.modals.querySelector('[data-action="copy-share"]')) {
      event.preventDefault();
      closeModal(true);
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (state.walkPick) {
      state.walkPick = false;
      renderAll();
      return;
    }
    if (walkingNow()) {
      event.stopImmediatePropagation();
      state.view3d.exitWalk();
      renderHud();
      return;
    }
    if (state.chain && !state.readOnly) {
      state.chain = null;
      state.lengthBuf = '';
      renderAll();
      return;
    }
    if (state.measure) {
      state.measure = null;
      renderCanvas();
      return;
    }
    state.selection = null;
    renderAll();
    return;
  }
  if (walkingNow()) return;
  if (event.repeat || typing(event.target)) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = event.ctrlKey || event.metaKey;
  if (state.readOnly) {
    if (key === 't') {
      if (state.mode === 'view3d') setMode('plan');
      else void enter3d(true);
    }
    return;
  }
  if (mod && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && key === 'y') { event.preventDefault(); redo(); return; }
  if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if (mod || event.altKey) return;
  if (/^[0-9]$/.test(event.key) && state.tool === 'wall' && state.mode === 'plan') {
    event.preventDefault();
    if (state.lengthBuf.length < 7) state.lengthBuf += event.key;
    patchLength();
    renderCanvas();
    return;
  }
  if (event.key === 'Enter' && state.tool === 'wall' && state.chain && state.lengthBuf) {
    event.preventDefault();
    const len = Number(state.lengthBuf);
    state.lengthBuf = '';
    if (len >= 50) placeAtLength(len);
    else patchLength();
    return;
  }
  if (event.key === 'Backspace' && state.tool === 'wall' && state.chain) {
    event.preventDefault();
    if (state.lengthBuf) {
      state.lengthBuf = state.lengthBuf.slice(0, -1);
      patchLength();
      return;
    }
    if (state.chain.steps > 0) undo();
    else {
      state.chain = null;
      renderAll();
    }
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (key === 'f') { flipSwing(); return; }
  if (key === 'r') {
    if (state.selection?.kind === 'furniture' || state.mode === 'furnish') {
      if (state.selection?.kind === 'furniture') rotateSelected(15);
      return;
    }
    setTool('room');
    return;
  }
  if (key === 't') {
    if (state.mode === 'view3d') setMode('plan');
    else void enter3d(true);
    return;
  }
  const toolByKey = { v: 'select', w: 'wall', d: 'door', n: 'window', x: 'demolish', m: 'measure', h: 'pan' };
  if (toolByKey[key]) setTool(toolByKey[key]);
}

function onKeyUp(event) {
  if (event.code === 'Space') state.space = false;
  state.shift = event.shiftKey;
}

function undo() {
  if (state.readOnly || !state.store) return;
  state.store.undo();
  if (state.chain && state.chain.steps > 0) {
    state.chain.steps -= 1;
    state.chain.points.pop();
    bindChainNodes();
    if (!state.chain.points.length) state.chain = null;
  }
  state.gesture = null;
  renderAll();
}

function redo() {
  if (state.readOnly || !state.store || state.store.isTransacting()) return;
  state.store.redo();
  state.chain = null;
  state.lengthBuf = '';
  renderAll();
}

function rotateSelected(delta) {
  if (state.readOnly) return;
  const floor = ensureFloor();
  if (state.selection?.kind !== 'furniture' || !floor) return;
  const item = floor.furniture.find((entry) => entry.id === state.selection.id);
  if (!item) return;
  let rot = ((item.rot || 0) + delta) % 360;
  if (rot < 0) rot += 360;
  state.store.dispatch(furniturePatchCommand(state.floorId, item.id, { rot }));
}

function flipSwing() {
  if (state.selection?.kind === 'opening') {
    const floor = ensureFloor();
    const opening = floor?.openings.find((item) => item.id === state.selection.id);
    if (!opening) return;
    patchSelectedOpening({ swing: opening.swing === 'out' ? 'in' : 'out' });
    return;
  }
  state.openingSwing = state.openingSwing === 'out' ? 'in' : 'out';
  if (state.hoverWorld && (state.tool === 'door' || state.tool === 'window')) {
    state.openingPreview = previewOpening(
      state.store.getPlan(),
      state.floorId,
      state.hoverWorld,
      openingSpec(),
      state.camera.k,
    );
    renderCanvas();
  }
}

function deleteSelection() {
  if (state.readOnly) return;
  const sel = state.selection;
  const floor = ensureFloor();
  if (!sel || !floor || !state.store) return;
  if (sel.kind === 'wall') {
    const count = floor.openings.filter((opening) => opening.wall === sel.id).length;
    state.store.dispatch(wallDeleteCommand(state.floorId, sel.id));
    state.selection = null;
    toast(t('toast.deleted', { n: count }));
    return;
  }
  if (sel.kind === 'opening') {
    state.store.dispatch(openingDeleteCommand(state.floorId, sel.id));
    state.selection = null;
    return;
  }
  if (sel.kind === 'furniture') {
    state.store.dispatch(furnitureDeleteCommand(state.floorId, sel.id));
    state.selection = null;
  }
}

function duplicateSelection() {
  if (state.readOnly) return;
  if (state.selection?.kind !== 'furniture' || !state.store) return;
  const floor = ensureFloor();
  const before = new Set((floor?.furniture || []).map((item) => item.id));
  state.store.dispatch(furnitureDuplicateCommand(state.floorId, state.selection.id));
  const created = ensureFloor()?.furniture.find((item) => !before.has(item.id));
  if (created) state.selection = { kind: 'furniture', id: created.id };
  renderAll();
}

function patchSelectedWall(patch) {
  if (state.readOnly || state.selection?.kind !== 'wall' || !state.store) return;
  if (patch.virtual === true || patch.thickness != null) {
    const trial = structuredClone(state.store.getPlan());
    const result = patchWall(trial, state.floorId, state.selection.id, patch);
    if (!result.ok && result.reason === 'openings') {
      state.formError = t('toast.virtualOpenings');
      renderChrome();
      return;
    }
  }
  state.formError = '';
  if (patch.thickness != null && (Number(patch.thickness) < 60 || Number(patch.thickness) > 500)) {
    state.formError = t('wall.thicknessHint');
  }
  state.store.dispatch(wallPatchCommand(state.floorId, state.selection.id, patch));
  renderChrome();
}

function patchSelectedOpening(patch) {
  if (state.readOnly || state.selection?.kind !== 'opening' || !state.store) return;
  const id = state.selection.id;
  const trial = structuredClone(state.store.getPlan());
  const result = updateOpening(trial, state.floorId, id, patch, checkOpeningPlacement);
  if (!result.ok) {
    const floor = ensureFloor();
    const opening = floor?.openings.find((item) => item.id === id);
    const info = openingClearance(state.store.getPlan(), state.floorId, id);
    state.formError = explainOpening({
      code: result.code || result.errors?.[0]?.code,
      kind: patch.kind || opening?.kind,
      width: patch.width ?? opening?.width,
      segmentLength: info?.segmentLength,
    });
    renderChrome();
    return;
  }
  state.formError = '';
  state.store.dispatch(openingPatchCommand(state.floorId, id, patch));
}

function demolishAt(world) {
  if (state.readOnly) return;
  const hit = pick(world);
  let wallId = null;
  const floor = ensureFloor();
  if (hit?.kind === 'wall') wallId = hit.id;
  else if (hit?.kind === 'node') wallId = hit.wallId;
  else if (hit?.kind === 'opening') wallId = floor?.openings.find((item) => item.id === hit.id)?.wall || null;
  if (wallId) void confirmDemolish(wallId);
}

async function confirmDemolish(wallId) {
  if (modalResolver || !state.store) return;
  const preview = previewDemolish(state.store.getPlan(), state.floorId, wallId);
  if (!preview) return;
  if (preview.bearing) {
    state.shakeId = wallId;
    renderCanvas();
    toast(t('demolish.bearing'), 'danger', null, 2500);
    window.setTimeout(() => {
      if (state.shakeId === wallId) {
        state.shakeId = null;
        renderCanvas();
      }
    }, 240);
    return;
  }
  state.condemnedId = wallId;
  renderCanvas();
  const before = polysOf(preview.before);
  const after = polysOf(preview.after);
  const bounds = boundsOf(before.concat(after));
  const openings = preview.openings.length
    ? `<ul>${preview.openings.map((item) => `<li>${escapeHtml(item.kind)} ${Math.round(item.width)} mm</li>`).join('')}</ul>`
    : `<p class="note">${escapeHtml(t('demolish.none'))}</p>`;
  const name = preview.largerRoom?.name || '';
  const ok = await showModal({
    title: t('demolish.title'),
    body: `
      <div class="thumbs">
        <figure><figcaption>${escapeHtml(t('demolish.before'))}</figcaption>${miniSvg(before, bounds)}</figure>
        <figure><figcaption>${escapeHtml(t('demolish.after'))}</figcaption>${miniSvg(after, bounds)}</figure>
      </div>
      <p class="formula">${escapeHtml(t('demolish.formula', {
        a: formatAreaMm2(preview.aArea),
        b: formatAreaMm2(preview.bArea),
        c: formatAreaMm2(preview.wallFootprint),
        d: formatAreaMm2(preview.merged),
      }))}</p>
      <p>${escapeHtml(t('demolish.inherit', { name }))}</p>
      <p class="kicker">${escapeHtml(t('demolish.openings'))}</p>
      ${openings}
      <p class="note">${escapeHtml(t('demolish.note'))}</p>`,
    confirm: t('demolish.confirm'),
    cancel: t('demolish.cancel'),
    danger: true,
  });
  state.condemnedId = null;
  if (!ok) {
    renderCanvas();
    return;
  }
  state.store.dispatch(wallDemolishCommand(state.floorId, wallId));
  state.mergeId = preview.survivorId;
  state.selection = preview.survivorId ? { kind: 'room', id: preview.survivorId } : null;
  renderAll();
  window.setTimeout(() => {
    state.mergeId = null;
    renderCanvas();
  }, 300);
}

function polysOf(result) {
  const types = new Map((result?.rooms || []).map((room) => [room.id, room.type]));
  return (result?.derived || []).map((face) => ({
    points: face.polygon?.length >= 3 ? face.polygon : face.centerline,
    fill: roomFillVar(types.get(face.roomId)),
  })).filter((poly) => poly.points?.length >= 3);
}

function boundsOf(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const point of poly.points || []) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function miniSvg(polys, bounds) {
  const viewBox = thumbView(polys, bounds, { width: 220, height: 140, pad: 10 });
  const body = viewBox.polys.map((poly) => {
    const points = poly.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    return `<polygon points="${points}" fill="${poly.fill}" stroke="var(--line-2)" stroke-width="1"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${viewBox.width} ${viewBox.height}" width="220" height="140">${body}</svg>`;
}

function showModal({ title, body, confirm, cancel, danger }) {
  ui.modals.innerHTML = `
    <div class="modal-mask">
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" class="btn" data-action="modal-cancel">${escapeHtml(cancel || t('common.cancel'))}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-action="modal-ok">${escapeHtml(confirm || t('common.confirm'))}</button>
        </div>
      </div>
    </div>`;
  return new Promise((resolve) => { modalResolver = resolve; });
}

function closeModal(ok) {
  ui.modals.innerHTML = '';
  const resolve = modalResolver;
  modalResolver = null;
  if (resolve) resolve(ok);
}

function onClick(event) {
  if (modalResolver) {
    if (event.target.closest('[data-action="copy-share"]')) { void copyShareField(); return; }
    if (event.target.closest('[data-action="share-export-json"]')) { exportJSON(); return; }
    if (event.target.closest('[data-action="share-close"]')) { closeModal(false); return; }
    if (event.target.closest('[data-action="modal-ok"]')) { closeModal(true); return; }
    if (event.target.closest('[data-action="modal-cancel"]')) { closeModal(false); return; }
    if (event.target.classList?.contains('modal-mask')) { closeModal(false); return; }
    return;
  }
  const search = event.target.closest?.('[data-search]');
  if (search) return;
  const page = event.target.closest?.('[data-sheet-page]')?.dataset.sheetPage;
  if (page) {
    state.sheetPage = page;
    if (state.sheetSnap === 0) state.sheetSnap = 1;
    syncSheet();
    return;
  }
  const mode = event.target.closest?.('button[data-mode]')?.dataset.mode;
  if (mode) { setMode(mode); return; }
  const actionNode = event.target.closest?.('[data-action]');
  if (actionNode) { onAction(actionNode.dataset.action, actionNode, event); return; }
  const tool = event.target.closest?.('[data-tool]')?.dataset.tool;
  if (tool) { setTool(tool); return; }
  const floorId = event.target.closest?.('[data-floor]')?.dataset.floor;
  if (floorId) { selectFloor(floorId); return; }
  const template = event.target.closest?.('[data-template]')?.dataset.template;
  if (template) { void loadTemplate(template); return; }
  if (event.target.closest?.('[data-blank]')) { newBlank(); return; }
  const room = event.target.closest?.('[data-room]')?.dataset.room;
  if (room) {
    state.selection = { kind: 'room', id: room };
    state.formError = '';
    renderAll();
    return;
  }
  if (!event.target.closest?.('.menu')) closeMenus();
}

function onAction(action, node, event) {
  if (action === 'plan-menu' || action === 'file-menu' || action === 'more-menu') {
    const name = action === 'plan-menu' ? 'plan' : action === 'file-menu' ? 'file' : 'more';
    toggleMenu(name);
    event?.stopPropagation();
    return;
  }
  closeMenus();
  if (state.readOnly && READONLY_BLOCK.has(action)) {
    toast(t('share.readonly'));
    return;
  }
  if (action === 'undo') undo();
  else if (action === 'redo') redo();
  else if (action === 'share') void openShareDialog();
  else if (action === 'export-png') void exportPng();
  else if (action === 'export-json') exportJSON();
  else if (action === 'import-json') ui.file.click();
  else if (action === 'lang') void toggleLang();
  else if (action === 'view3d') {
    if (state.mode === 'view3d') setMode('plan');
    else void enter3d(false);
  } else if (action === 'bird') {
    state.walkPick = false;
    if (walkingNow()) state.view3d.exitWalk();
    if (state.mode !== 'view3d') void enter3d(false);
    else renderHud();
  }
  else if (action === 'inspector') ui.inspector.classList.toggle('is-open');
  else if (action === 'help') openHelp();
  else if (action === 'tool-measure') setTool('measure');
  else if (action === 'save-copy') void saveSharedCopy();
  else if (action === 'cutaway') {
    state.cutaway = !state.cutaway;
    try { state.view3d?.setCutaway?.(state.cutaway); } catch { /* shader uniform is best-effort */ }
    renderHud();
  } else if (action === 'walk') {
    if (walkingNow()) {
      state.view3d.exitWalk();
      renderHud();
      return;
    }
    state.walkPick = true;
    toast(t('walk.pick'));
    if (state.mode === 'view3d') setMode('plan');
    else renderAll();
  } else if (action === 'reset-view') {
    try { state.view3d?.resetView?.(); } catch { /* orbit stays where it is */ }
  } else if (action === 'back-2d') setMode('plan');
  else if (action === 'sheet-cycle') {
    if (state.sheetSuppressClick) {
      state.sheetSuppressClick = false;
      return;
    }
    state.sheetSnap = (state.sheetSnap + 1) % 3;
    syncSheet();
  } else if (action === 'sheet-props') {
    state.sheetPage = 'props';
    if (state.sheetSnap < 1) state.sheetSnap = 1;
    syncSheet();
  } else if (action === 'rotate-selection') rotateSelected(state.layout === 'phone' ? 90 : 15);
  else if (action === 'show-picker') void showPicker();
  else if (action === 'open-plan') openStored(node.dataset.id);
  else if (action === 'copy-plan') copyPlan(node.dataset.id);
  else if (action === 'rename-plan') renamePlan(node.dataset.id);
  else if (action === 'delete-plan') void deletePlan(node.dataset.id);
  else if (action === 'open-recent') openRecent();
  else if (action === 'pref-virtual') setPref({ wallVirtual: node.dataset.value === '1' });
  else if (action === 'pref-thickness') setPref({ wallThickness: Number(node.dataset.value) });
  else if (action === 'wall-virtual') patchSelectedWall({ virtual: node.dataset.value === '1' });
  else if (action === 'demolish' && state.selection?.kind === 'wall') void confirmDemolish(state.selection.id);
  else if (action === 'delete-selection') deleteSelection();
  else if (action === 'duplicate-selection') duplicateSelection();
  else if (action === 'opening-width') patchSelectedOpening({ width: Number(node.dataset.value) });
  else if (action === 'opening-kind') patchSelectedOpening({ kind: node.dataset.value });
  else if (action === 'opening-swing') patchSelectedOpening({ swing: node.dataset.value });
  else if (action === 'opening-hinge') patchSelectedOpening({ hinge: node.dataset.value });
  else if (action === 'opening-center') patchSelectedOpening({ t: 0.5 });
  else if (action === 'conflict-load') loadRemote();
  else if (action === 'conflict-keep') { ui.banner.hidden = true; saveNow(); }
}

function onChangeInput(event) {
  const el = event.target;
  if (state.readOnly) return;
  if (el.dataset?.pref) { applyPref(el.dataset.pref, el); return; }
  const field = el.dataset?.field;
  if (!field || !state.store) return;
  if (field === 'wall-thickness') patchSelectedWall({ thickness: Number(el.value) });
  else if (field === 'wall-height') patchSelectedWall({ height: el.value.trim() === '' ? null : Number(el.value) });
  else if (field === 'wall-bearing') patchSelectedWall({ bearing: el.checked });
  else if (field === 'wall-exterior') patchSelectedWall({ exterior: el.checked });
  else if (field === 'room-name') state.store.dispatch(roomPatchCommand(state.floorId, state.selection.id, { name: el.value }));
  else if (field === 'room-type') state.store.dispatch(roomPatchCommand(state.floorId, state.selection.id, { type: el.value }));
  else if (field === 'room-floor') state.store.dispatch(roomPatchCommand(state.floorId, state.selection.id, { floor: el.value }));
  else if (field === 'opening-width') patchSelectedOpening({ width: Number(el.value) });
  else if (field === 'opening-height') patchSelectedOpening({ height: Number(el.value) });
  else if (field === 'opening-sill') patchSelectedOpening({ sill: Number(el.value) });
  else if (field === 'furn-name') state.store.dispatch(furniturePatchCommand(state.floorId, state.selection.id, { name: el.value }));
  else if (field === 'furn-w') state.store.dispatch(furniturePatchCommand(state.floorId, state.selection.id, { w: Number(el.value) }));
  else if (field === 'furn-d') state.store.dispatch(furniturePatchCommand(state.floorId, state.selection.id, { d: Number(el.value) }));
  else if (field === 'furn-h') state.store.dispatch(furniturePatchCommand(state.floorId, state.selection.id, { h: Number(el.value) }));
  else if (field === 'furn-color') state.store.dispatch(furniturePatchCommand(state.floorId, state.selection.id, { color: el.value }));
}

function onInput(event) {
  const search = event.target.closest?.('[data-search]');
  if (!search) return;
  const query = search.value.trim().toLowerCase();
  const root = search.closest('.sheet-page') || search.closest('.sidepanel') || ui.side;
  for (const item of root.querySelectorAll('[data-furn]')) {
    const name = (item.dataset.name || '').toLowerCase();
    item.hidden = !!query && !name.includes(query);
  }
}

function applyPref(name, el) {
  const value = el.type === 'checkbox' ? el.checked : Number(el.value);
  setPref({ [name]: value });
  if (el.type !== 'checkbox' && el.isConnected) el.value = state.prefs[name];
}

function setPref(partial) {
  try {
    state.prefs = writePrefs(storage, { ...state.prefs, ...partial });
  } catch {
    toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
    return;
  }
  state.panelKey = '';
  renderAll();
}

function selectFloor(floorId) {
  state.floorId = floorId;
  state.selection = null;
  state.chain = null;
  state.view3d?.setCurrentFloor?.(floorId);
  renderAll();
  scheduleFit();
}

function toggleMenu(name) {
  const menu = document.querySelector(`[data-menu="${name}"]`);
  if (!menu) return;
  const open = menu.hidden;
  closeMenus();
  if (!open) return;
  if (name === 'plan') fillPlanMenu(menu);
  menu.hidden = false;
}

function closeMenus() {
  for (const menu of document.querySelectorAll('[data-menu]')) menu.hidden = true;
}

function fillPlanMenu(menu) {
  const list = sortPlans(readIndex(storage));
  const current = state.store?.getPlan()?.meta?.id;
  const rows = list.map((item) => `
    <button type="button" class="item" data-action="open-plan" data-id="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.name)}</span>
      <small>${escapeHtml(formatStamp(item.updatedAt))}${item.id === current ? ` · ${escapeHtml(t('plan.current'))}` : ''}</small>
    </button>
    <div class="row-actions">
      <button type="button" data-action="rename-plan" data-id="${escapeHtml(item.id)}">${escapeHtml(t('plan.rename'))}</button>
      <button type="button" data-action="copy-plan" data-id="${escapeHtml(item.id)}">${escapeHtml(t('plan.duplicate'))}</button>
      <button type="button" data-action="delete-plan" data-id="${escapeHtml(item.id)}">${escapeHtml(t('plan.delete'))}</button>
    </div>`).join('');
  menu.innerHTML = `
    <button type="button" class="item" data-action="show-picker"><strong>${escapeHtml(t('plan.new'))}</strong></button>
    ${rows || `<p class="muted">${escapeHtml(t('picker.none'))}</p>`}`;
}

function formatStamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

async function showPicker() {
  if (state.readOnly) return;
  if (state.store && state.armed) saveNow();
  state.pickerOpen = true;
  syncPicker();
  await refreshPicker();
}

async function refreshPicker() {
  let index = { templates: [] };
  try {
    const res = await fetch(new URL('../../templates/index.json', import.meta.url));
    if (res.ok) index = await res.json();
  } catch { /* blank card still works */ }
  const cards = [];
  for (const item of index.templates || []) {
    try {
      const res = await fetch(new URL(`../../templates/${item.file}`, import.meta.url));
      const doc = await res.json();
      cards.push({
        id: item.id,
        name: item.name,
        net: aboutNetM2(planNetM2(doc.plan), item.netAreaM2),
        model: roomThumbModel(doc.plan),
        plan: doc.plan,
      });
    } catch {
      cards.push({
        id: item.id,
        name: item.name,
        net: aboutNetM2(null, item.netAreaM2),
        model: null,
        plan: null,
      });
    }
  }
  state.templates = cards;
  renderPicker();
}

function renderPicker() {
  const cards = state.templates.map((card) => {
    const area = card.net == null ? '' : t('picker.area', { area: card.net });
    return `<button type="button" class="card" data-template="${escapeHtml(card.id)}" data-testid="template-${escapeHtml(card.id)}">
      <div class="thumb">${thumbMarkup(card.model)}</div>
      <strong>${escapeHtml(card.name)}</strong>
      <span>${escapeHtml(area)}</span>
    </button>`;
  }).join('');
  const last = readLastId(storage);
  const recentOk = !!(last && readPlan(storage, last));
  ui.picker.innerHTML = `
    <h2>${escapeHtml(t('picker.title'))}</h2>
    <p class="lead">${escapeHtml(t('picker.lead'))}</p>
    <div class="picker-tabs"><div class="seg">
      <button type="button" class="is-on">${escapeHtml(t('picker.apartment'))}</button>
      <button type="button" disabled title="${escapeHtml(t('picker.houseTip'))}">${escapeHtml(t('picker.house'))}</button>
    </div></div>
    <div class="cards">
      <button type="button" class="card is-default" data-blank data-testid="blank">
        <div class="thumb"><svg width="150" height="110" viewBox="0 0 150 110"><rect x="25" y="15" width="100" height="80" rx="4" fill="none" stroke="var(--line-2)" stroke-width="2" stroke-dasharray="6 5"/><path d="M75 42v26M62 55h26" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/></svg></div>
        <strong>${escapeHtml(t('picker.blank'))}</strong>
        <span>${escapeHtml(t('picker.blankHint'))}</span>
      </button>
      ${cards}
    </div>
    <div class="picker-name"><input data-plan-input placeholder="${escapeHtml(t('picker.name'))}" /></div>
    <div class="picker-links">
      <button type="button" class="btn" data-action="import-json">${escapeHtml(t('picker.import'))}</button>
      <button type="button" class="btn" data-action="open-recent" ${recentOk ? '' : 'disabled'}>${escapeHtml(t('picker.recent'))}</button>
    </div>`;
}

function thumbMarkup(model) {
  if (!model) return '';
  const box = thumbView(model.polys, model, { width: 150, height: 110, pad: 8 });
  const body = box.polys.map((poly) => {
    const points = poly.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    return `<polygon points="${points}" fill="${poly.fill}"/>`;
  }).join('');
  return `<svg width="150" height="110" viewBox="0 0 150 110">${body}</svg>`;
}

function chosenName() {
  return ui.picker.querySelector('[data-plan-input]')?.value?.trim() || '';
}

function newBlank() {
  const name = chosenName();
  adopt(createEmptyPlan(name ? { name } : {}), {
    save: true,
    arm: true,
    tool: 'wall',
    hint: t('hint.firstWall'),
  });
}

async function loadTemplate(id) {
  const card = state.templates.find((item) => item.id === id);
  if (!card?.plan) return;
  const name = chosenName();
  adopt(clonePlanFresh(card.plan, name ? { name } : {}), { save: true, arm: true, tool: 'select' });
}

function openRecent() {
  const id = readLastId(storage);
  if (id) openStored(id);
}

function showIssues(errors, tone = 'danger') {
  const list = (errors || []).filter(Boolean);
  if (!list.length) {
    logIssue('UNKNOWN');
    toast(t('error.generic'), tone);
    return;
  }
  const seen = new Set();
  const parts = [];
  for (const item of list) {
    logIssue(item.code || 'UNKNOWN', item.path || '');
    const key = messageKeyForCode(item.code);
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(t(key));
  }
  toast(parts.join('；') || t('error.generic'), tone);
}

function openStored(id) {
  const plan = readPlan(storage, id);
  if (!plan) return;
  const errors = validatePlan(plan).filter((item) => item.severity !== 'warning');
  if (errors.length) {
    showIssues(errors);
    return;
  }
  adopt(plan, { save: false, arm: true });
}

function copyPlan(id) {
  const current = state.store?.getPlan();
  const source = current?.meta?.id === id ? current : readPlan(storage, id);
  if (!source) return;
  const copy = clonePlanFresh(source, { name: `${source.meta.name} ${t('plan.copySuffix')}` });
  const result = writePlan(storage, copy);
  if (!result.ok) {
    toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
    return;
  }
  adopt(copy, { save: false, arm: true });
}

function renamePlan(id) {
  const current = state.store?.getPlan();
  if (current?.meta?.id === id) {
    const input = ui.top.querySelector('[data-plan-name]');
    input?.focus();
    input?.select();
    return;
  }
  const stored = readPlan(storage, id);
  if (!stored) return;
  const name = window.prompt(t('plan.rename'), stored.meta.name);
  if (!name?.trim()) return;
  const result = renameStored(storage, id, name.trim(), Date.now());
  if (!result.ok) toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
}

async function deletePlan(id) {
  const ok = await showModal({
    title: t('plan.deleteTitle'),
    body: `<p>${escapeHtml(t('plan.deleteBody'))}</p>`,
    confirm: t('plan.delete'),
    danger: true,
  });
  if (!ok) return;
  const wasOpen = state.store?.getPlan()?.meta?.id === id;
  const removed = deletePlanWithUndo(storage, id, { wasOpen });
  const name = removed?.plan?.meta?.name || removed?.indexEntry?.name || '';
  if (wasOpen) {
    const rest = sortPlans(readIndex(storage));
    if (rest.length) {
      const next = readPlan(storage, rest[0].id);
      if (next) adopt(next, { save: false, arm: true });
      else {
        state.armed = false;
        void showPicker();
      }
    } else {
      state.armed = false;
      void showPicker();
    }
  }
  window.clearTimeout(state.deleteUndoTimer);
  state.deleteUndoTimer = window.setTimeout(() => {
    dropDeleted();
    state.deleteUndoTimer = 0;
  }, 10000);
  toast(t('plan.deleted', { name }), '', { label: t('plan.undo'), run: undoDeletePlan }, 10000);
}

function undoDeletePlan() {
  window.clearTimeout(state.deleteUndoTimer);
  state.deleteUndoTimer = 0;
  const saved = restoreDeleted(storage);
  if (!saved?.plan) return;
  if (saved.wasOpen) adopt(saved.plan, { save: false, arm: true, readOnly: false });
  else if (ui.picker && !ui.picker.hidden) renderPicker();
}

async function importFile(file) {
  if (state.readOnly) {
    toast(t('share.readonly'));
    return;
  }
  let text = '';
  try { text = await file.text(); } catch { toast(t('toast.saveFail'), 'danger'); return; }
  const result = importPlanJSON(text);
  if (!result.ok) {
    showIssues(result.errors);
    return;
  }
  adopt(result.plan, { save: true, arm: true, multiToast: true });
}

function exportJSON() {
  if (!state.store) return;
  const plan = state.store.getPlan();
  const blob = new Blob([exportPlanJSON(plan)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${plan.meta?.name || 'plan'}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function scheduleSave() {
  if (state.readOnly || !state.armed || state.pickerOpen || !state.store || state.store.isTransacting()) return;
  state.saveState = 'dirty';
  renderStatus();
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveNow, 500);
}

function saveNow() {
  if (state.readOnly || !state.store || state.pickerOpen || state.store.isTransacting()) return;
  state.saveState = 'saving';
  try {
    state.store.touch(Date.now());
    const result = writePlan(storage, state.store.getPlan());
    if (!result.ok) {
      state.saveState = 'error';
      toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
      renderStatus();
      return;
    }
    state.saveState = 'saved';
    if (result.warn && !state.quotaToasted) {
      state.quotaToasted = true;
      toast(t('toast.quota'), 'warn', { label: t('toast.backup'), run: exportJSON });
    }
  } catch {
    state.saveState = 'error';
    toast(t('toast.saveFail'), 'danger', { label: t('toast.backup'), run: exportJSON });
  }
  renderStatus();
}

function onStorage(event) {
  if (!state.store || state.quiet) return;
  const id = state.store.getPlan()?.meta?.id;
  if (!id || event.key !== planKey(id)) return;
  ui.banner.hidden = false;
}

function loadRemote() {
  const id = state.store?.getPlan()?.meta?.id;
  ui.banner.hidden = true;
  if (!id) return;
  const other = readPlan(storage, id);
  if (!other) return;
  const errors = validatePlan(other).filter((item) => item.severity !== 'warning');
  if (errors.length) {
    showIssues(errors);
    return;
  }
  adopt(other, { save: false, arm: true });
}

async function toggleLang() {
  const lang = state.prefs.lang === 'zh' ? 'en' : 'zh';
  state.prefs = writePrefs(storage, { ...state.prefs, lang });
  try { state.messages = await loadLocale(lang); } catch { /* keep previous copy */ }
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('app.title');
  state.panelKey = '';
  renderAll();
  if (!ui.picker.hidden) renderPicker();
}

async function probe3d() {
  try {
    const mod = await import('../view3d/index.js');
    state.view3dMod = mod;
    if (typeof mod.isWebGLAvailable === 'function') state.webgl = mod.isWebGLAvailable();
  } catch {
    state.view3dMod = null;
  }
  paint3dButton();
}

async function enter3d(fromKey) {
  if (state.view3dBusy) return;
  if (fromKey && state.mode === 'view3d') return;
  if (state.mode === 'view3d' && state.view3d) {
    try { state.view3d.setCurrentFloor?.(state.floorId); } catch { /* highlight only */ }
    syncViewSelection(true);
    renderChrome();
    return;
  }
  if (state.webgl && state.webgl.ok === false) {
    toast(state.webgl.reason || t('view3d.unavailable'));
    return;
  }
  const gen = ++enterGen;
  state.view3dBusy = true;
  paint3dButton();
  const reduced = prefersReduced();
  const host = document.getElementById('view3d-host');
  try {
    let mod = state.view3dMod;
    if (!mod) {
      mod = await import('../view3d/index.js');
      state.view3dMod = mod;
    }
    if (gen !== enterGen) return;
    if (!mod || typeof mod.createView3D !== 'function') {
      toast(t('toast.view3dPending'));
      return;
    }
    if (typeof mod.isWebGLAvailable === 'function') state.webgl = mod.isWebGLAvailable();
    if (state.webgl && state.webgl.ok === false) {
      toast(state.webgl.reason || t('view3d.unavailable'));
      return;
    }
    if (!state.view3d) {
      state.view3d = await mod.createView3D({
        container: host,
        getPlan: () => state.store?.getPlan() ?? { floors: [] },
        floorId: state.floorId,
        reducedMotion: reduced,
        onSelectFurniture: onView3dSelect,
      });
    }
    if (gen !== enterGen) return;
    state.mode = 'view3d';
    state.walkPick = false;
    if (host) host.hidden = false;
    svg.hidden = true;
    renderChrome();
    await state.view3d.enter?.({ animate: !reduced });
    if (gen !== enterGen) return;
    state.view3d.setCurrentFloor?.(state.floorId);
    if (state.cutaway) state.view3d.setCutaway?.(true);
    syncViewSelection(true);
    renderChrome();
  } catch {
    if (gen === enterGen) {
      if (host) host.hidden = true;
      svg.hidden = false;
      if (state.mode === 'view3d') state.mode = 'plan';
      toast(t('toast.view3dPending'));
      renderChrome();
    }
  } finally {
    if (gen === enterGen) {
      state.view3dBusy = false;
      paint3dButton();
    }
  }
}

async function leave3d() {
  const gen = ++enterGen;
  state.view3dBusy = false;
  paint3dButton();
  const reduced = prefersReduced();
  try {
    if (state.view3d) await state.view3d.exit?.({ animate: !reduced });
  } catch { /* 2D remains the editor */ }
  if (gen !== enterGen) return;
  const host = document.getElementById('view3d-host');
  if (host) host.hidden = true;
  if (svg) svg.hidden = false;
  renderCanvas();
}

function exit3d() {
  void leave3d();
}

function toast(text, tone = '', action = null, ms = 2600) {
  const node = document.createElement('div');
  node.className = `toast${tone ? ` ${tone}` : ''}`;
  node.dataset.testid = 'toast';
  const span = document.createElement('span');
  span.textContent = text;
  node.append(span);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => action.run());
    node.append(button);
  }
  ui.toasts.replaceChildren(node);
  window.clearTimeout(state.toastTimer);
  if (ms > 0) {
    state.toastTimer = window.setTimeout(() => {
      if (node.isConnected) node.remove();
    }, ms);
  }
}

function showHint(text, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  ui.hint.hidden = false;
  ui.hint.classList.remove('is-hide');
  ui.hint.classList.toggle('is-top', !!options.top);
  if (options.icon) {
    ui.hint.innerHTML = `<span class="hint-ico">${iconSvg(options.icon, 16)}</span><span></span>`;
    ui.hint.lastElementChild.textContent = text;
  } else {
    ui.hint.textContent = text;
  }
  window.clearTimeout(state.hintTimer);
  state.hintTimer = window.setTimeout(() => {
    ui.hint.classList.add('is-hide');
    window.setTimeout(() => { ui.hint.hidden = true; }, 400);
  }, 3000);
}

function showPill(text) {
  ui.pill.hidden = false;
  ui.pill.classList.remove('is-hide');
  ui.pill.textContent = text;
  window.clearTimeout(state.pillTimer);
  state.pillTimer = window.setTimeout(() => {
    ui.pill.classList.add('is-hide');
    window.setTimeout(() => { ui.pill.hidden = true; }, 400);
  }, 2000);
}
