// @browser-only
/**
 * Rasterize the current floor to a PNG whose long edge is 3200 px.
 * Rooms, walls, openings, furniture, net-area labels, the plan name and a
 * scale bar are drawn with token colours read from the page.
 */

import { formatMm } from '../editor/format.js';
import { openingGeometry } from '../editor/opening-geom.js';
import { wallQuad } from '../editor/wall-shape.js';
import { niceScaleMm, planExportLayout } from '../io/png-fit.js';
import { furnitureSymbol, legendForType } from '../plan2d/furniture-symbols.js';
import { AREA_FONT_MIN, NAME_FONT_MIN } from '../plan2d/label-place.js';

/**
 * @param {object} model
 * @returns {Promise<Blob>}
 */
export function renderPlanPng(model) {
  const colors = readColors();
  const bounds = contentBounds(model);
  const layout = planExportLayout(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);

  ctx.setTransform(
    layout.pxPerMm,
    0,
    0,
    layout.pxPerMm,
    layout.originX - bounds.minX * layout.pxPerMm,
    layout.originY - bounds.minY * layout.pxPerMm,
  );
  drawRooms(ctx, model.rooms || [], colors);
  drawWalls(ctx, model.walls || [], colors, layout.pxPerMm);
  drawOpenings(ctx, model.openings || [], colors, layout.pxPerMm);
  drawFurniture(ctx, model.furniture || [], colors, layout.pxPerMm);
  drawLabels(ctx, model.labels || [], colors, layout.pxPerMm, model.labelPxPerMm);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawTitle(ctx, model.name || '', colors, layout);
  drawScale(ctx, colors, layout);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('png'));
      else resolve(blob);
    }, 'image/png');
  });
}

function readColors() {
  const pick = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    paper: pick('--paper-0', '#f6f2ea'),
    paper1: pick('--paper-1', '#fbf8f3'),
    wall: pick('--wall', '#3a332c'),
    bearing: pick('--wall-bearing', '#1f1b17'),
    ink: pick('--ink-1', '#2b2620'),
    ink2: pick('--ink-2', '#5c5348'),
    ink3: pick('--ink-3', '#71665a'),
  };
}

function resolveFill(fill, colors) {
  const match = /var\((--[^)\s]+)\)/.exec(fill || '');
  if (!match) return fill || colors.paper1;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || colors.paper1;
}

function contentBounds(model) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const room of model.rooms || []) {
    for (const point of room.points || []) add(point.x, point.y);
  }
  for (const wall of model.walls || []) {
    add(wall.a?.x, wall.a?.y);
    add(wall.b?.x, wall.b?.y);
  }
  for (const entry of model.furniture || []) {
    const item = entry.item || entry;
    add(item.cx - item.w / 2, item.cy - item.d / 2);
    add(item.cx + item.w / 2, item.cy + item.d / 2);
  }
  for (const label of model.labels || []) add(label.x, label.y);
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 4000, maxY: 3000 };
  }
  const pad = 400;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function drawRooms(ctx, rooms, colors) {
  for (const room of rooms) {
    const points = room.points || [];
    if (points.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fillStyle = resolveFill(room.fill, colors);
    ctx.fill();
  }
}

function drawWalls(ctx, walls, colors, pxPerMm) {
  for (const wall of walls) {
    if (!wall.a || !wall.b) continue;
    if (wall.virtual) {
      ctx.save();
      ctx.strokeStyle = colors.wall;
      ctx.lineWidth = 1.5 / pxPerMm;
      ctx.setLineDash([8 / pxPerMm, 6 / pxPerMm]);
      ctx.beginPath();
      ctx.moveTo(wall.a.x, wall.a.y);
      ctx.lineTo(wall.b.x, wall.b.y);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const quad = wallQuad(wall.a, wall.b, wall.thickness || 240, true);
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < quad.length; i += 1) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.fillStyle = wall.demolished ? colors.paper : (wall.bearing ? colors.bearing : colors.wall);
    ctx.fill();
    if (wall.demolished) {
      ctx.save();
      ctx.strokeStyle = colors.wall;
      ctx.lineWidth = 2 / pxPerMm;
      ctx.setLineDash([8 / pxPerMm, 6 / pxPerMm]);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawOpenings(ctx, openings, colors, pxPerMm) {
  for (const item of openings) {
    if (!item.opening || !item.a || !item.b) continue;
    const geom = openingGeometry(item.a, item.b, item.opening);
    const thick = item.thickness || 240;
    const halfW = (item.opening.width || 0) / 2;
    const halfT = thick / 2;
    ctx.save();
    ctx.translate(geom.center.x, geom.center.y);
    ctx.rotate(Math.atan2(geom.uy, geom.ux));
    ctx.fillStyle = colors.paper;
    ctx.fillRect(-halfW, -halfT, item.opening.width || 0, thick);
    ctx.restore();
    const kind = item.opening.kind;
    ctx.save();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 1.5 / pxPerMm;
    ctx.lineCap = 'round';
    if (kind === 'window') {
      for (const scale of [-0.28, 0, 0.28]) {
        strokeParallel(ctx, geom, item.opening.width, thick * scale);
      }
    } else if (kind === 'slide') {
      strokeParallel(ctx, geom, item.opening.width, thick * 0.18);
      strokeParallel(ctx, geom, item.opening.width, thick * -0.18);
    } else {
      const placed = !item.preview;
      ctx.lineWidth = (placed ? 2 : 1.5) / pxPerMm;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(geom.hinge.x, geom.hinge.y);
      ctx.lineTo(geom.leaf.x, geom.leaf.y);
      ctx.stroke();
      ctx.strokeStyle = placed ? colors.ink2 : colors.ink3;
      ctx.lineWidth = (placed ? 1.2 : 1.25) / pxPerMm;
      ctx.setLineDash(placed ? [] : [5 / pxPerMm, 4 / pxPerMm]);
      const start = Math.atan2(geom.jamb.y - geom.hinge.y, geom.jamb.x - geom.hinge.x);
      const end = Math.atan2(geom.leaf.y - geom.hinge.y, geom.leaf.x - geom.hinge.x);
      const cross = (geom.jamb.x - geom.hinge.x) * (geom.leaf.y - geom.hinge.y)
        - (geom.jamb.y - geom.hinge.y) * (geom.leaf.x - geom.hinge.x);
      ctx.beginPath();
      ctx.arc(geom.hinge.x, geom.hinge.y, item.opening.width || 0, start, end, cross > 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function strokeParallel(ctx, geom, width, offset) {
  const half = (width || 0) / 2;
  const ox = geom.left.x * offset;
  const oy = geom.left.y * offset;
  ctx.beginPath();
  ctx.moveTo(geom.center.x - geom.ux * half + ox, geom.center.y - geom.uy * half + oy);
  ctx.lineTo(geom.center.x + geom.ux * half + ox, geom.center.y + geom.uy * half + oy);
  ctx.stroke();
}

function drawFurniture(ctx, list, colors, pxPerMm) {
  for (const entry of list) {
    const item = entry.item || entry;
    if (!item) continue;
    const legend = legendForType(item.type);
    if (legend) {
      drawLegend(ctx, legend, item, colors, !!entry.warn);
      continue;
    }
    const parts = furnitureSymbol(entry.shape || 'box', item.w, item.d);
    ctx.save();
    ctx.translate(item.cx, item.cy);
    ctx.rotate(((item.rot || 0) * Math.PI) / 180);
    ctx.fillStyle = item.color || colors.paper1;
    ctx.strokeStyle = entry.warn ? '#b3382a' : colors.ink2;
    ctx.lineWidth = 1.25 / pxPerMm;
    for (const shape of parts) {
      if (shape.type === 'circle') {
        ctx.beginPath();
        ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (shape.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.setLineDash(shape.dash ? [6 / pxPerMm, 4 / pxPerMm] : []);
        ctx.rect(shape.x, shape.y, shape.w, shape.d);
        if (!shape.dash) ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
}

function drawLegend(ctx, legend, item, colors, warn) {
  ctx.save();
  ctx.translate(item.cx, item.cy);
  ctx.rotate(((item.rot || 0) * Math.PI) / 180);
  const sx = (item.w || legend.w) / legend.w;
  const sy = (item.d || legend.d) / legend.d;
  ctx.scale(sx, sy);
  ctx.translate(-legend.w / 2, -legend.d / 2);
  let inner = legend.inner;
  if (warn) inner = inner.replaceAll('var(--paper-1,#fbf8f3)', 'var(--danger-tint)');
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
    'image/svg+xml',
  );
  paintSvgChildren(ctx, doc.documentElement, colors);
  ctx.restore();
  if (warn) {
    ctx.save();
    ctx.translate(item.cx, item.cy);
    ctx.rotate(((item.rot || 0) * Math.PI) / 180);
    ctx.strokeStyle = '#b3382a';
    const t = ctx.getTransform();
    const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) || 1;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(-item.w / 2, -item.d / 2, item.w, item.d);
    ctx.restore();
  }
}

function paintSvgChildren(ctx, parent, colors) {
  for (const node of parent.children) paintSvgNode(ctx, node, colors);
}

function paintSvgNode(ctx, node, colors) {
  const tag = node.localName;
  if (tag === 'g') {
    ctx.save();
    applySvgTransform(ctx, node.getAttribute('transform'));
    paintSvgChildren(ctx, node, colors);
    ctx.restore();
    return;
  }
  const fillAttr = node.getAttribute('fill');
  const strokeAttr = node.getAttribute('stroke');
  ctx.beginPath();
  if (tag === 'rect') {
    const x = svgNum(node, 'x');
    const y = svgNum(node, 'y');
    const w = svgNum(node, 'width');
    const h = svgNum(node, 'height');
    const rx = svgNum(node, 'rx');
    if (rx > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rx);
    else ctx.rect(x, y, w, h);
  } else if (tag === 'line') {
    ctx.moveTo(svgNum(node, 'x1'), svgNum(node, 'y1'));
    ctx.lineTo(svgNum(node, 'x2'), svgNum(node, 'y2'));
  } else if (tag === 'circle') {
    const r = svgNum(node, 'r');
    if (r > 0) ctx.arc(svgNum(node, 'cx'), svgNum(node, 'cy'), r, 0, Math.PI * 2);
  } else if (tag === 'ellipse') {
    const rx = svgNum(node, 'rx');
    const ry = svgNum(node, 'ry');
    if (rx > 0 && ry > 0) ctx.ellipse(svgNum(node, 'cx'), svgNum(node, 'cy'), rx, ry, 0, 0, Math.PI * 2);
  } else {
    return;
  }
  if (fillAttr && fillAttr !== 'none') {
    ctx.fillStyle = resolvePaint(fillAttr, colors);
    ctx.fill();
  }
  if (strokeAttr && strokeAttr !== 'none') {
    ctx.strokeStyle = resolvePaint(strokeAttr, colors);
    const width = parseFloat(node.getAttribute('stroke-width')) || 1.2;
    const t = ctx.getTransform();
    const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d)) || 1;
    ctx.lineWidth = width / scale;
    ctx.stroke();
  }
}

function svgNum(node, name) {
  const value = parseFloat(node.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
}

function resolvePaint(paint, colors) {
  const match = /var\((--[^,)\s]+)(?:,\s*([^)]+))?\)/.exec(paint || '');
  if (!match) return paint || colors.ink2;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || (match[2] || '').trim() || colors.ink2;
}

function applySvgTransform(ctx, transform) {
  if (!transform) return;
  const translate = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(transform);
  const rotate = /rotate\(\s*([-\d.]+)/.exec(transform);
  if (translate) ctx.translate(Number(translate[1]), Number(translate[2]));
  if (rotate) ctx.rotate((Number(rotate[1]) * Math.PI) / 180);
}

function drawLabels(ctx, labels, colors, pxPerMm, screenK) {
  const k = screenK > 0 ? screenK : (pxPerMm > 0 ? pxPerMm : 0.05);
  const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 599px)').matches;
  const namePx = tokenPx(phone ? '--fs-12' : '--fs-13', phone ? 12 : 13);
  const areaPx = tokenPx(phone ? '--fs-10' : '--fs-12', phone ? 10 : 12);
  const uiFont = tokenFont('--font-ui', 'sans-serif');
  const numFont = tokenFont('--font-num', 'monospace');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const label of labels) {
    if (label.hidden) continue;
    const nameSize = label.fontStep ? NAME_FONT_MIN : namePx;
    const areaSize = label.fontStep ? AREA_FONT_MIN : areaPx;
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.fillStyle = colors.ink;
    ctx.font = `${nameSize / k}px ${uiFont}`;
    ctx.fillText(label.name || '', 0, 0);
    if (!label.nameOnly && label.area) {
      ctx.fillStyle = colors.ink2;
      ctx.font = `${areaSize / k}px ${numFont}`;
      const lineDy = (label.lineDy > 0 ? label.lineDy : nameSize * 0.2 + 2 + areaSize * 0.8) / k;
      ctx.fillText(label.area, 0, lineDy);
    }
    ctx.restore();
  }
}

function tokenPx(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function tokenFont(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

function drawTitle(ctx, name, colors, layout) {
  ctx.fillStyle = colors.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = Math.max(16, Math.round(layout.titlePx * 0.42));
  ctx.font = `600 ${size}px sans-serif`;
  ctx.fillText(name, layout.width / 2, layout.titlePx * 0.5);
}

function drawScale(ctx, colors, layout) {
  const bar = niceScaleMm(layout.pxPerMm, Math.min(320, layout.width * 0.22));
  const y = layout.height - layout.scalePx * 0.42;
  const x = layout.width / 2 - bar.px / 2;
  ctx.strokeStyle = colors.ink2;
  ctx.fillStyle = colors.ink2;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + bar.px, y);
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y + 6);
  ctx.moveTo(x + bar.px, y - 6);
  ctx.lineTo(x + bar.px, y + 6);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = `${Math.max(12, Math.round(layout.scalePx * 0.34))}px sans-serif`;
  ctx.fillText(`${formatMm(bar.mm)} mm`, layout.width / 2, y - 8);
}
