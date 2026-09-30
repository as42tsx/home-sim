/**
 * Write docs/template-area-report.md from the encoded templates.
 * Centreline areas are compared with Luna's table. Net areas are recorded
 * and are not forced to match the table.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOpeningPlacement, openingClearance } from '../src/openings/clearance.js';
import { getFloor } from '../src/model/document.js';
import { validatePlan } from '../src/model/validate.js';
import { deriveRooms } from '../src/rooms/derive.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  return (Math.round(n * 10000) / 10000).toFixed(4);
}

function fmtMm(n) {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function reachability(plan, floorId) {
  const result = deriveRooms(plan, floorId);
  const floor = getFloor(plan, floorId);
  const byWall = new Map();
  for (const face of result.derived) {
    for (const wallId of face.wallIds) {
      if (!byWall.has(wallId)) byWall.set(wallId, []);
      byWall.get(wallId).push(face);
    }
  }
  const adj = new Map(result.derived.map((face) => [face.roomId, new Set()]));
  const link = (a, b) => {
    if (!a || !b || a.roomId === b.roomId) return;
    adj.get(a.roomId).add(b.roomId);
    adj.get(b.roomId).add(a.roomId);
  };
  const linkAll = (list) => {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) link(list[i], list[j]);
    }
  };
  for (const wall of result.normalized.walls) {
    if (wall.virtual) linkAll(byWall.get(wall.id) || []);
  }
  for (const opening of result.normalized.openings) {
    if (opening.kind !== 'door' && opening.kind !== 'slide') continue;
    linkAll(byWall.get(opening.wall) || []);
  }
  const entry = (floor.openings || []).find((op) => op.ext?.role === 'entry' || op.ext?.label === '入户门');
  const placed = entry && result.normalized.openings.find((op) => op.id === entry.id);
  const startRooms = placed ? (byWall.get(placed.wall) || []) : [];
  const seen = new Set();
  const queue = [];
  if (startRooms[0]) {
    seen.add(startRooms[0].roomId);
    queue.push(startRooms[0].roomId);
  }
  while (queue.length) {
    const id = queue.shift();
    for (const next of adj.get(id) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const reachable = result.derived.filter((face) => seen.has(face.roomId)).map((face) => face.name);
  const unreachable = result.derived.filter((face) => !seen.has(face.roomId)).map((face) => face.name);
  return { entry: startRooms[0]?.name ?? '（未找到入户门所在房间）', reachable, unreachable };
}

function section(file) {
  const plan = file.plan;
  const floor = getFloor(plan, 'f1');
  const issues = validatePlan(plan).filter((item) => item.severity !== 'warning');
  const result = deriveRooms(plan, 'f1');
  const lines = [];
  lines.push(`## ${file.name}（${file.id}）`);
  lines.push('');
  lines.push(`校验错误 ${issues.length} 条。推导房间数 ${result.derived.length}，表内 ${file.expected.roomCount}。${result.derived.length === file.expected.roomCount ? '房间数一致。' : '房间数不一致。'}`);
  lines.push('');
  lines.push('| 房间 | Luna 面积 | 推导中线面积 | 差值 | 推导内净面积 | 差值 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  let interiorCl = 0;
  for (const row of file.expected.rooms) {
    const face = result.derived.find((item) => item.name === row.name);
    const stored = floor.rooms.find((item) => item.name === row.name);
    if (stored && stored.type !== 'balcony' && face) interiorCl += face.centerlineAreaM2;
    if (!face) {
      lines.push(`| ${row.name} | ${row.areaM2} | 未识别 | — | 未识别 | — |`);
      continue;
    }
    lines.push(`| ${row.name} | ${row.areaM2} | ${fmt(face.centerlineAreaM2)} | ${fmt(face.centerlineAreaM2 - row.areaM2)} | ${fmt(face.areaM2)} | ${fmt(face.areaM2 - row.areaM2)} |`);
  }
  lines.push('');
  lines.push(`不含阳台的推导中线合计 ${fmt(interiorCl)} m²。表记套内 ${file.expected.interiorTotalM2} m²（${file.id === 'apt-3br' ? '表内写明 88.9；各房间宽×深未四舍五入之和为 88.92' : '表内为约数'}）。`);
  lines.push('');
  lines.push('### 门窗端距');
  lines.push('');
  lines.push('自由净距 = 墙段长度 − 两端「非共线、非虚拟墙」的最大半墙厚。间隙为洞口边缘到自由净距端部的距离，负值表示洞口伸进了端部墙厚。');
  lines.push('');
  lines.push('| 门窗 | 种类 | 墙段 mm | 洞宽 | 自由净距 | 起端间隙 | 末端间隙 | 结论 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const opening of floor.openings) {
    const info = openingClearance(plan, 'f1', opening.id);
    const errs = checkOpeningPlacement(plan, 'f1', opening.id);
    const verdict = errs.length ? errs.map((item) => item.code).join(', ') : '通过';
    lines.push(`| ${opening.ext?.label || opening.id} | ${opening.kind} | ${fmtMm(info.segmentLength)} | ${opening.width} | ${fmtMm(info.freeSpan)} | ${fmtMm(info.startGap)} | ${fmtMm(info.endGap)} | ${verdict} |`);
  }
  lines.push('');
  const reach = reachability(plan, 'f1');
  lines.push('### 从入户门可达');
  lines.push('');
  lines.push(`入户所在房间：${reach.entry}。`);
  lines.push('');
  lines.push(`可达：${reach.reachable.join('、') || '（无）'}。`);
  lines.push('');
  lines.push(`不可达：${reach.unreachable.join('、') || '（无）'}。`);
  lines.push('');
  if (result.unclosed.gap != null) {
    lines.push(`未闭合缺口 ${fmtMm(result.unclosed.gap)} mm。`);
    lines.push('');
  }
  return lines.join('\n');
}

const index = JSON.parse(fs.readFileSync(path.join(root, 'templates/index.json'), 'utf8'));
const parts = [];
parts.push('# 模板面积核对');
parts.push('');
parts.push('由 `scripts/template-report.js` 生成。单位：平方米（表内毫米已换算）。「推导中线面积」是墙中线围合的面积；「推导内净面积」是每条边按该墙自身厚度的一半向室内退让后的面积（虚拟分隔线按厚度 0）。差值 = 推导值 − Luna 表值。');
parts.push('');
parts.push('Luna v1.1 同时写了「尺寸都是净尺寸」和「画布上以墙中线为准」。三套矩形互相贴合，三居套内 88.9 m² 与各房间宽×深之和（88.92，四舍五入到一位小数即 88.9）相符。本仓库按开发说明把表中坐标当作墙中线，不改数字去凑内净面积。内净与表值的差是墙厚，不是录入误差。');
parts.push('');
for (const item of index.templates) {
  const file = JSON.parse(fs.readFileSync(path.join(root, 'templates', item.file), 'utf8'));
  parts.push(section(file));
}
parts.push('## 端距违反');
parts.push('');
parts.push('一居室入户门 `apt1-entry`：洞宽 1000 mm，所在墙段是玄关西墙 y 4200–5400，长 1200 mm。起端（y=4200）接 120 mm 内墙，侵入 60 mm；末端（y=5400）接 240 mm 外墙，侵入 120 mm。共线的西向外墙不计入。自由净距 = 1200 − 60 − 120 = 1020 mm。门居中后边缘在 100 mm 与 1100 mm，间隙为 40 mm 与 −20 mm，都小于 100 mm，记为 `OPENING_CLEARANCE`。两居、三居的全部门窗在同一算法下间隙均 ≥ 100 mm。');
parts.push('');
parts.push('## 假设（待产品确认）');
parts.push('');
parts.push('- 表中坐标按墙中线录入。内净面积另列，不要求等于 Luna 的一位小数。');
parts.push('- 两居 y=3900、x 6000–7800，三居 y=4200、x 3600–5100，按「中间不设门」做成 `virtual: true` 的分隔线（待确认）。分隔线在数据里厚度仍为 120（墙厚下限），房间内缩时按 0。');
parts.push('- 一居玄关过道与客餐厅的共用边（x=3300，y 4200–5400）表内没有门，也没有「不设门」这句话，按字面做成 120 mm 实墙。因此从入户只能到玄关过道和卧室，客餐厅、卫生间、厨房、阳台不可达。');
parts.push('- 三居餐厅与客厅之间没有门。厨房只从餐厅进入。从餐厅不可达客厅、公卫、阳台、过道、主卧、次卧、主卫。');
parts.push('- 外墙 240，内墙 120。阳台外侧以及阳台与室内的分界都按外墙 240（待确认）。');
parts.push('- 门（含入户门、推拉门）高 2100、门槛 0；窗高 1500、窗台 900。合页一律 left，开启方向一律 in。表内没有这些数。');
parts.push('- 洞口居中放在点名的那一段墙上，表内没有偏距。');
parts.push('- 端距只扣掉端部非共线、非虚拟墙的最大半墙厚，不把共线延伸的墙厚再扣一次。');
parts.push('- 层高与净高都写 2800（Luna 的层高）。楼板厚 200 另记，没有从 2800 里扣。');
parts.push('- 承重全部为 false。饰面 paint-white。地面：卧室/起居/餐厅/客餐厅 wood，厨卫过道阳台 tile，玄关 stone。');
parts.push('- 楼梯的 `turn`（默认 left）和 `well`（默认 0）是待确认的附加字段，模板里没有楼梯。');
parts.push('');

const out = path.join(root, 'docs/template-area-report.md');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${parts.join('\n')}\n`);
console.log(`wrote ${path.relative(root, out)}`);
