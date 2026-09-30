// @browser-only
/**
 * SVG plan view. World units are millimetres, y down.
 * Pointer moves update attributes on the existing nodes. A layer is rebuilt
 * only when an id appears or disappears.
 */

import { openingGeometry } from '../editor/opening-geom.js';
import { pointsAttr, wallQuad } from '../editor/wall-shape.js';
import { furnitureSymbol } from './furniture-symbols.js';

const NS = 'http://www.w3.org/2000/svg';

/** @param {string} name @param {Record<string, string|number|null|undefined>} [attrs] */
function el(name, attrs) {
  const node = document.createElementNS(NS, name);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  return node;
}

/** @param {SVGElement} parent @param {string} id @param {string} tag */
function slot(parent, id, tag) {
  let node = null;
  for (const child of parent.children) {
    if (child.dataset.id === id) {
      node = child;
      break;
    }
  }
  if (node && node.localName !== tag) {
    node.remove();
    node = null;
  }
  if (!node) {
    node = el(tag);
    node.dataset.id = id;
    parent.appendChild(node);
  }
  return node;
}

/** @param {SVGElement} parent @param {Set<string>} keep */
function dropMissing(parent, keep) {
  for (const child of [...parent.children]) {
    if (!keep.has(child.dataset.id || '')) child.remove();
  }
}

function screenOf(camera, point) {
  return {
    x: camera.x + point.x * camera.k,
    y: camera.y + point.y * camera.k,
  };
}

/**
 * @param {SVGSVGElement} svg
 */
export function mountPlanView(svg) {
  const defs = el('defs');
  const minor = el('pattern', { id: 'hs-grid-minor', patternUnits: 'userSpaceOnUse' });
  const minorPath = el('path', { fill: 'none', stroke: 'var(--paper-grid)', 'stroke-width': 1 });
  minor.append(minorPath);
  const major = el('pattern', { id: 'hs-grid-major', patternUnits: 'userSpaceOnUse' });
  const majorPath = el('path', { fill: 'none', stroke: 'var(--line-2)', 'stroke-width': 1 });
  major.append(majorPath);
  defs.append(minor, major);
  const gridMinor = el('rect', { fill: 'url(#hs-grid-minor)' });
  const gridMajor = el('rect', { fill: 'url(#hs-grid-major)' });
  const world = el('g', { 'data-layer': 'world' });
  const hatch = el('pattern', {
    id: 'hs-hatch',
    patternUnits: 'userSpaceOnUse',
    width: 140,
    height: 140,
    patternTransform: 'rotate(45)',
  });
  hatch.append(el('line', {
    x1: 0, y1: 0, x2: 0, y2: 140,
    stroke: 'var(--ink-inverse)',
    'stroke-width': 8,
    'stroke-opacity': 0.45,
  }));
  const worldDefs = el('defs');
  worldDefs.append(hatch);
  const lower = el('g', { 'data-layer': 'lower', opacity: 0.25 });
  const rooms = el('g', { 'data-layer': 'rooms' });
  const walls = el('g', { 'data-layer': 'walls' });
  const openings = el('g', { 'data-layer': 'openings' });
  const furniture = el('g', { 'data-layer': 'furniture' });
  const overlay = el('g', { 'data-layer': 'overlay' });
  world.append(worldDefs, lower, rooms, walls, openings, furniture, overlay);
  const screen = el('g', { 'data-layer': 'screen' });
  svg.replaceChildren(defs, gridMinor, gridMajor, world, screen);

  /** @type {object|null} */
  let last = null;

  function size() {
    return { w: svg.clientWidth, h: svg.clientHeight };
  }

  function worldFromClient(clientX, clientY) {
    const camera = last?.camera || { x: 0, y: 0, k: 0.05 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.k,
      y: (clientY - rect.top - camera.y) / camera.k,
    };
  }

  function clientFromWorld(x, y) {
    const camera = last?.camera || { x: 0, y: 0, k: 0.05 };
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + camera.x + x * camera.k,
      y: rect.top + camera.y + y * camera.k,
    };
  }

  function draw(model) {
    last = model;
    const camera = model.camera;
    svg.style.cursor = model.cursor || 'default';
    const { w, h } = size();
    world.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.k})`);
    paintGrid(camera, w, h);
    paintFloor(lower, model.lower);
    paintRooms(rooms, model.rooms || []);
    paintWalls(walls, model.walls || []);
    paintOpenings(openings, model.openings || []);
    paintFurniture(furniture, model.furniture || []);
    paintOverlay(overlay, model);
    paintScreen(screen, model);
  }

  function paintGrid(camera, w, h) {
    gridMinor.setAttribute('width', w || 0);
    gridMinor.setAttribute('height', h || 0);
    gridMajor.setAttribute('width', w || 0);
    gridMajor.setAttribute('height', h || 0);
    const minorStep = 100 * camera.k;
    const majorStep = 1000 * camera.k;
    tunePattern(minor, minorPath, minorStep, camera);
    tunePattern(major, majorPath, majorStep, camera);
    gridMinor.setAttribute('display', minorStep < 6 ? 'none' : '');
    gridMajor.setAttribute('display', majorStep < 6 ? 'none' : '');
  }

  function tunePattern(pattern, path, step, camera) {
    if (!(step > 0)) return;
    const ox = mod(camera.x, step);
    const oy = mod(camera.y, step);
    pattern.setAttribute('width', step);
    pattern.setAttribute('height', step);
    pattern.setAttribute('x', ox);
    pattern.setAttribute('y', oy);
    path.setAttribute('d', `M ${step} 0 H 0 V ${step}`);
  }

  return {
    render: draw,
    resize() {
      if (last) draw(last);
    },
    worldFromClient,
    clientFromWorld,
    setCursor(cursor) {
      svg.style.cursor = cursor;
    },
    size,
  };
}

function mod(value, step) {
  if (!step) return 0;
  return ((value % step) + step) % step;
}

function layer(parent, name) {
  for (const child of parent.children) {
    if (child.getAttribute('data-layer') === name) return child;
  }
  const node = el('g', { 'data-layer': name });
  parent.append(node);
  return node;
}

function paintFloor(group, floor) {
  if (!floor) {
    group.replaceChildren();
    return;
  }
  paintRooms(layer(group, 'rooms'), floor.rooms || []);
  paintWalls(layer(group, 'walls'), floor.walls || []);
  paintOpenings(layer(group, 'openings'), floor.openings || []);
}

function paintRooms(group, list) {
  const keep = new Set(list.map((room) => room.id));
  dropMissing(group, keep);
  for (const room of list) {
    const g = slot(group, room.id, 'g');
    let poly = g.querySelector('polygon');
    if (!poly) {
      poly = el('polygon', { class: 'room-fill' });
      g.append(poly);
    }
    poly.setAttribute('points', pointsAttr(room.points));
    poly.setAttribute('fill', room.fill || 'var(--room-other)');
    poly.classList.toggle('is-merge', !!room.merge);
  }
}

function paintWalls(group, list) {
  const keep = new Set(list.map((wall) => wall.id));
  dropMissing(group, keep);
  for (const wall of list) {
    const g = slot(group, wall.id, 'g');
    g.classList.toggle('is-shake', !!wall.shake);
    if (wall.virtual) {
      paintVirtual(g, wall);
    } else {
      paintSolid(g, wall);
    }
  }
}

function paintVirtual(g, wall) {
  if (g.dataset.kind !== 'virtual') {
    g.replaceChildren(el('line'));
    g.dataset.kind = 'virtual';
  }
  const line = g.querySelector('line');
  line.setAttribute('x1', wall.a.x);
  line.setAttribute('y1', wall.a.y);
  line.setAttribute('x2', wall.b.x);
  line.setAttribute('y2', wall.b.y);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', wall.condemned || wall.demolished ? 'var(--wall-demolish)' : 'var(--wall)');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-dasharray', '7 5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
}

function paintSolid(g, wall) {
  if (g.dataset.kind !== 'solid') {
    g.replaceChildren(el('polygon'), el('polygon'));
    g.dataset.kind = 'solid';
  }
  const quad = wallQuad(wall.a, wall.b, wall.thickness || 240, true);
  const pts = pointsAttr(quad);
  const [fill, hatchPoly] = g.querySelectorAll('polygon');
  fill.setAttribute('points', pts);
  const outline = wall.demolished || wall.condemned;
  if (outline) {
    fill.setAttribute('fill', 'none');
    fill.setAttribute('stroke', 'var(--wall-demolish)');
    fill.setAttribute('stroke-width', '2');
    fill.setAttribute('stroke-dasharray', '8 6');
    fill.setAttribute('vector-effect', 'non-scaling-stroke');
    hatchPoly.setAttribute('display', 'none');
    return;
  }
  fill.setAttribute('fill', wall.preview ? 'var(--wall-drawing)' : (wall.bearing ? 'var(--wall-bearing)' : 'var(--wall)'));
  fill.setAttribute('stroke', wall.selected ? 'var(--wall-selected)' : 'none');
  fill.setAttribute('stroke-width', wall.selected ? '3' : '0');
  fill.setAttribute('stroke-dasharray', 'none');
  fill.setAttribute('vector-effect', 'non-scaling-stroke');
  if (wall.bearing && !wall.preview) {
    hatchPoly.setAttribute('display', '');
    hatchPoly.setAttribute('points', pts);
    hatchPoly.setAttribute('fill', 'url(#hs-hatch)');
  } else {
    hatchPoly.setAttribute('display', 'none');
  }
}

function paintOpenings(group, list) {
  const keep = new Set(list.map((item) => item.id));
  dropMissing(group, keep);
  for (const item of list) {
    const g = slot(group, item.id, 'g');
    const sig = openingSig(item);
    if (g.dataset.sig !== sig) {
      g.dataset.sig = sig;
      g.replaceChildren(...openingNodes(item));
    }
  }
}

function openingSig(item) {
  const o = item.opening;
  const a = item.a;
  const b = item.b;
  return [
    o.kind, o.t, o.width, o.hinge, o.swing, item.thickness, item.preview ? 1 : 0, item.ok ? 1 : 0,
    Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y),
  ].join('|');
}

function openingNodes(item) {
  const geom = openingGeometry(item.a, item.b, item.opening);
  const thick = item.thickness || 240;
  const ang = Math.atan2(geom.uy, geom.ux) * 180 / Math.PI;
  const illegal = item.preview && !item.ok;
  const stroke = illegal ? 'var(--danger)' : (item.preview ? 'var(--ok)' : 'var(--ink-1)');
  const nodes = [];
  const local = el('g', { transform: `translate(${geom.center.x} ${geom.center.y}) rotate(${ang})` });
  const halfW = item.opening.width / 2;
  const halfT = thick / 2;
  local.append(el('rect', {
    x: -halfW,
    y: -halfT,
    width: item.opening.width,
    height: thick,
    fill: illegal ? 'none' : 'var(--paper-0)',
    stroke: item.preview ? stroke : 'none',
    'stroke-width': item.preview ? 2 : 0,
    'stroke-dasharray': illegal ? '6 4' : 'none',
    'vector-effect': 'non-scaling-stroke',
  }));
  if (illegal) {
    local.append(
      el('line', lineAttrs(-halfW, -halfT, halfW, halfT, 'var(--danger)')),
      el('line', lineAttrs(-halfW, halfT, halfW, -halfT, 'var(--danger)')),
    );
  }
  nodes.push(local);
  if (illegal) return nodes;
  const kind = item.opening.kind;
  if (kind === 'window' || (kind !== 'door' && kind !== 'slide')) {
    for (const scale of [-0.28, 0, 0.28]) {
      nodes.push(parallel(geom, item.opening.width, thick * scale, stroke));
    }
  } else if (kind === 'slide') {
    nodes.push(parallel(geom, item.opening.width, thick * 0.18, stroke));
    nodes.push(parallel(geom, item.opening.width, thick * -0.18, stroke));
  } else {
    nodes.push(el('line', {
      ...lineAttrs(geom.hinge.x, geom.hinge.y, geom.leaf.x, geom.leaf.y, stroke),
    }));
    const r = item.opening.width;
    const v1x = geom.jamb.x - geom.hinge.x;
    const v1y = geom.jamb.y - geom.hinge.y;
    const v2x = geom.leaf.x - geom.hinge.x;
    const v2y = geom.leaf.y - geom.hinge.y;
    const sweep = v1x * v2y - v1y * v2x > 0 ? 1 : 0;
    nodes.push(el('path', {
      d: `M ${geom.jamb.x} ${geom.jamb.y} A ${r} ${r} 0 0 ${sweep} ${geom.leaf.x} ${geom.leaf.y}`,
      fill: 'none',
      stroke: item.preview ? 'var(--ok)' : 'var(--ink-3)',
      'stroke-width': 1.25,
      'stroke-dasharray': '5 4',
      'vector-effect': 'non-scaling-stroke',
    }));
  }
  return nodes;
}

function parallel(geom, width, offset, stroke) {
  const half = width / 2;
  const ox = geom.left.x * offset;
  const oy = geom.left.y * offset;
  return el('line', lineAttrs(
    geom.center.x - geom.ux * half + ox,
    geom.center.y - geom.uy * half + oy,
    geom.center.x + geom.ux * half + ox,
    geom.center.y + geom.uy * half + oy,
    stroke,
  ));
}

function lineAttrs(x1, y1, x2, y2, stroke) {
  return {
    x1, y1, x2, y2,
    stroke,
    'stroke-width': 1.5,
    'vector-effect': 'non-scaling-stroke',
    fill: 'none',
  };
}

function paintFurniture(group, list) {
  const keep = new Set(list.map((item) => item.id));
  dropMissing(group, keep);
  for (const entry of list) {
    const g = slot(group, entry.id, 'g');
    const item = entry.item;
    const sig = `${entry.shape}|${item.w}|${item.d}|${item.color}|${entry.warn ? 1 : 0}|${entry.selected ? 1 : 0}`;
    if (g.dataset.sig !== sig) {
      g.dataset.sig = sig;
      g.replaceChildren(...symbolNodes(entry));
    }
    g.setAttribute('transform', `translate(${item.cx} ${item.cy}) rotate(${item.rot || 0})`);
  }
}

function symbolNodes(entry) {
  const item = entry.item;
  const stroke = entry.warn ? 'var(--danger)' : (entry.selected ? 'var(--wall-selected)' : 'var(--ink-2)');
  const width = entry.warn || entry.selected ? 2.5 : 1.25;
  return furnitureSymbol(entry.shape, item.w, item.d).map((shape) => {
    if (shape.type === 'circle') {
      return el('circle', {
        cx: shape.cx,
        cy: shape.cy,
        r: shape.r,
        fill: item.color,
        stroke,
        'stroke-width': width,
        'vector-effect': 'non-scaling-stroke',
      });
    }
    if (shape.type === 'line') {
      return el('line', {
        x1: shape.x1,
        y1: shape.y1,
        x2: shape.x2,
        y2: shape.y2,
        stroke,
        'stroke-width': width,
        'vector-effect': 'non-scaling-stroke',
      });
    }
    return el('rect', {
      x: shape.x,
      y: shape.y,
      width: shape.w,
      height: shape.d,
      fill: shape.dash ? 'none' : item.color,
      stroke,
      'stroke-width': width,
      'stroke-dasharray': shape.dash ? '6 4' : 'none',
      'vector-effect': 'non-scaling-stroke',
    });
  });
}

function paintOverlay(group, model) {
  group.replaceChildren();
  for (const guide of model.guides || []) {
    group.append(el('line', {
      x1: guide.x1,
      y1: guide.y1,
      x2: guide.x2,
      y2: guide.y2,
      stroke: 'var(--info)',
      'stroke-width': 1,
      'stroke-dasharray': '6 5',
      'vector-effect': 'non-scaling-stroke',
    }));
  }
  if (model.gap) {
    const gap = model.gap;
    group.append(el('rect', {
      x: gap.x,
      y: gap.y,
      width: Math.max(gap.w, 1),
      height: Math.max(gap.h, 1),
      fill: 'none',
      stroke: 'var(--warn)',
      'stroke-width': 1.5,
      'stroke-dasharray': '7 5',
      'vector-effect': 'non-scaling-stroke',
    }));
  }
  if (model.measure?.a && model.measure?.b) {
    group.append(el('line', {
      ...lineAttrs(model.measure.a.x, model.measure.a.y, model.measure.b.x, model.measure.b.y, 'var(--info)'),
    }));
  }
  if (model.dimension) {
    const dim = model.dimension;
    group.append(el('line', {
      ...lineAttrs(dim.a.x, dim.a.y, dim.b.x, dim.b.y, 'var(--dim-line)'),
    }));
  }
}

function paintScreen(group, model) {
  const camera = model.camera;
  const keep = new Set();
  for (const label of model.labels || []) {
    keep.add(`label:${label.id}`);
    const g = slot(group, `label:${label.id}`, 'g');
    g.setAttribute('data-room-label', label.id);
    let name = g.querySelector('.label-name');
    let area = g.querySelector('.label-area');
    if (!name) {
      name = el('text', { class: 'label-name', 'text-anchor': 'middle' });
      area = el('text', { class: 'label-area', 'text-anchor': 'middle' });
      g.replaceChildren(name, area);
    }
    const at = screenOf(camera, label);
    name.setAttribute('x', at.x);
    name.setAttribute('y', at.y);
    name.textContent = label.name;
    area.setAttribute('x', at.x);
    area.setAttribute('y', at.y + 16);
    area.textContent = label.area;
  }
  for (const bubble of model.bubbles || []) {
    keep.add(`bubble:${bubble.id}`);
    const g = slot(group, `bubble:${bubble.id}`, 'g');
    const at = screenOf(camera, bubble);
    paintPill(g, at.x, at.y - 18, bubble.text, bubble.tone || 'dark');
  }
  if (model.gap?.text) {
    keep.add('gap-pill');
    const g = slot(group, 'gap-pill', 'g');
    const mid = screenOf(camera, {
      x: model.gap.x + model.gap.w / 2,
      y: model.gap.y + model.gap.h / 2,
    });
    paintPill(g, mid.x, mid.y, model.gap.text, 'warn');
  }
  if (model.measure?.text && model.measure.a && model.measure.b) {
    keep.add('measure-pill');
    const g = slot(group, 'measure-pill', 'g');
    const mid = screenOf(camera, {
      x: (model.measure.a.x + model.measure.b.x) / 2,
      y: (model.measure.a.y + model.measure.b.y) / 2,
    });
    paintPill(g, mid.x, mid.y - 16, model.measure.text, 'dark');
  }
  if (model.dimension?.text) {
    keep.add('dim-pill');
    const g = slot(group, 'dim-pill', 'g');
    const mid = screenOf(camera, {
      x: (model.dimension.a.x + model.dimension.b.x) / 2,
      y: (model.dimension.a.y + model.dimension.b.y) / 2,
    });
    paintPill(g, mid.x, mid.y - 14, model.dimension.text, 'dark');
  }
  for (const handle of model.handles || []) {
    keep.add(`handle:${handle.id}`);
    const g = slot(group, `handle:${handle.id}`, 'g');
    const at = screenOf(camera, handle);
    if (handle.x2 != null) {
      let stem = g.querySelector('line');
      if (!stem) {
        stem = el('line');
        g.append(stem);
      }
      const from = screenOf(camera, { x: handle.x2, y: handle.y2 });
      stem.setAttribute('x1', from.x);
      stem.setAttribute('y1', from.y);
      stem.setAttribute('x2', at.x);
      stem.setAttribute('y2', at.y);
      stem.setAttribute('stroke', 'var(--wall-selected)');
      stem.setAttribute('stroke-width', '1.25');
    }
    let dot = g.querySelector('circle');
    if (!dot) {
      dot = el('circle');
      g.append(dot);
    }
    dot.setAttribute('cx', at.x);
    dot.setAttribute('cy', at.y);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill', 'var(--paper-1)');
    dot.setAttribute('stroke', 'var(--wall-selected)');
    dot.setAttribute('stroke-width', '2');
  }
  if (model.snap?.kind === 'endpoint') {
    keep.add('snap');
    const g = slot(group, 'snap', 'g');
    const at = screenOf(camera, model.snap);
    let ring = g.querySelector('circle');
    if (!ring) {
      ring = el('circle');
      g.append(
        ring,
        el('line'),
        el('line'),
      );
    }
    ring.setAttribute('cx', at.x);
    ring.setAttribute('cy', at.y);
    ring.setAttribute('r', 8);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'var(--snap)');
    ring.setAttribute('stroke-width', '1.5');
    const [h, v] = g.querySelectorAll('line');
    h.setAttribute('x1', at.x - 12);
    h.setAttribute('x2', at.x + 12);
    h.setAttribute('y1', at.y);
    h.setAttribute('y2', at.y);
    v.setAttribute('x1', at.x);
    v.setAttribute('x2', at.x);
    v.setAttribute('y1', at.y - 12);
    v.setAttribute('y2', at.y + 12);
    for (const line of [h, v]) {
      line.setAttribute('stroke', 'var(--snap)');
      line.setAttribute('stroke-width', '1.25');
    }
  }
  dropMissing(group, keep);
}

function paintPill(group, x, y, text, tone) {
  let rect = group.querySelector('rect');
  let label = group.querySelector('text');
  if (!rect) {
    rect = el('rect');
    label = el('text', { class: 'screen-num', 'text-anchor': 'middle' });
    group.replaceChildren(rect, label);
  }
  label.textContent = text;
  label.setAttribute('fill', 'var(--ink-inverse)');
  let width = 16;
  for (const ch of text) width += ch.charCodeAt(0) > 255 ? 12 : 7.2;
  const height = 26;
  rect.setAttribute('x', x - width / 2);
  rect.setAttribute('y', y - height / 2);
  rect.setAttribute('width', width);
  rect.setAttribute('height', height);
  rect.setAttribute('rx', 13);
  rect.setAttribute('fill', tone === 'warn' ? 'var(--warn)' : 'var(--ink-1)');
  label.setAttribute('x', x);
  label.setAttribute('y', y + 4);
}
