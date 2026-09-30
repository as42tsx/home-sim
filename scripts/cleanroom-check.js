/**
 * Fail if any tracked text file contains an identifier from the unlicensed
 * reference project. This script is the only place those strings may appear.
 * vendor/ is excluded (third-party sources). The scan uses git's own file
 * list so untracked-but-not-ignored files are included before the first commit.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = [
  'WALLS',
  'ROOMS',
  'WINS',
  'DOORS',
  'SLIDES',
  'LIB',
  'huxing-design-v1',
  'snapMove',
  'pushOut',
  'buildFurniture',
  'furnSVG',
  'toggleWall',
  'renderFurn',
  'buildArch',
  'buildFurn',
  'overviewPanel',
  'roomPanel',
];

const pattern = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`);

const listed = execSync('git ls-files --cached --others --exclude-standard', {
  cwd: root,
  encoding: 'utf8',
});

const skip = (rel) => rel === 'scripts/cleanroom-check.js'
  || rel.startsWith('vendor/')
  || rel.startsWith('node_modules/')
  || rel.startsWith('.git/');

let hits = 0;
for (const rel of listed.split('\n')) {
  if (!rel || skip(rel)) continue;
  const abs = path.join(root, rel);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue;
  const text = buf.toString('utf8');
  if (!pattern.test(text)) continue;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;
    hits += 1;
    console.error(`${rel}:${index + 1}: forbidden identifier`);
  });
}

if (hits > 0) {
  console.error(`clean-room check failed (${hits} hit${hits === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('clean-room check ok');
