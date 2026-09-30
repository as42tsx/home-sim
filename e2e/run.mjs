/**
 * Run every P0 browser script. Not part of `node --test`.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const scripts = [
  'us-01.mjs',
  'us-02.mjs',
  'us-03.mjs',
  'us-04.mjs',
  'us-05.mjs',
  'us-06.mjs',
  'us-07.mjs',
  'us-08.mjs',
  'us-09a.mjs',
  'us-10.mjs',
  'us-11.mjs',
  'us-15.mjs',
  'us-21.mjs',
  'perf.mjs',
];

let failed = 0;
for (const name of scripts) {
  console.log(`\n=== ${name} ===`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, name)], { stdio: 'inherit', env: process.env });
    child.on('exit', (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    failed += 1;
    console.log(`=== ${name} exited ${code} ===`);
  }
}
console.log(failed ? `\nE2E ${failed} script(s) failed` : '\nE2E all scripts passed');
process.exit(failed ? 1 : 0);
