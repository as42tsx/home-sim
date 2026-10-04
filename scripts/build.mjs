import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  target: 'es2020',
  outdir: 'dist',
  entryNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  legalComments: 'eof',
  metafile: true,
  plugins: [{
    name: 'three',
    setup(build) {
      build.onResolve({ filter: /^three$/ }, () => ({
        path: path.join(root, 'vendor/three/three.module.js'),
      }));
      build.onResolve({ filter: /^three\/addons\// }, (args) => ({
        path: path.join(root, 'vendor/three/addons', args.path.slice('three/addons/'.length)),
      }));
    },
  }],
});

const entry = Object.entries(result.metafile.outputs).find(([, meta]) => meta.entryPoint === 'src/app.js');
if (!entry) {
  console.error('build failed: src/app.js entry missing from metafile');
  process.exit(1);
}
const [entryOut, entryMeta] = entry;
const entryFile = path.basename(entryOut);

const initial = new Set();
const stack = [entryOut];
while (stack.length) {
  const file = stack.pop();
  if (!file || initial.has(file)) continue;
  initial.add(file);
  const output = result.metafile.outputs[file];
  if (!output) continue;
  for (const imported of output.imports || []) {
    if (imported.kind === 'import-statement') stack.push(imported.path);
  }
}
const leaked = [];
for (const file of initial) {
  const output = result.metafile.outputs[file];
  for (const input of Object.keys(output?.inputs || {})) {
    if (/view3d|vendor\/three\/|\/slab\/|\/stairs\//.test(input)) leaked.push(`${file} <= ${input}`);
  }
}
if (leaked.length) {
  console.error('3D modules leaked into the first-screen graph:');
  for (const line of leaked) console.error(`  ${line}`);
  process.exit(1);
}

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\n[ \t]*<script type="importmap">[\s\S]*?<\/script>/, '');
if (html.includes('importmap') || !html.includes('src="src/app.js"')) {
  console.error('build failed: index.html module script was not rewritten');
  process.exit(1);
}
html = html.replace('src="src/app.js"', `src="./${entryFile}"`);
fs.writeFileSync(path.join(dist, 'index.html'), html);

const lines = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .map(([file, meta]) => {
    const bytes = meta.bytes;
    const role = initial.has(file) ? 'first' : 'lazy';
    return `${role}\t${bytes}\t${path.basename(file)}`;
  });
console.log(`entry ${entryFile}`);
for (const line of lines.sort()) console.log(line);
