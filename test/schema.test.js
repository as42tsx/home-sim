import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createEmptyPlan } from '../src/model/document.js';
import { validatePlan } from '../src/model/validate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function ajv() {
  const compiler = new Ajv2020({ strict: true, allErrors: true });
  addFormats(compiler);
  const planSchema = read('schema/plan.v2.schema.json');
  const templateSchema = read('schema/template.v2.schema.json');
  compiler.addSchema(planSchema);
  return {
    plan: compiler.compile(planSchema),
    template: compiler.compile(templateSchema),
  };
}

const validators = ajv();

function codes(plan) {
  return validatePlan(plan).filter((item) => item.severity !== 'warning').map((item) => item.code);
}

test('both schemas compile in strict mode and accept the examples', () => {
  for (const rel of ['schema/examples/empty-plan.json', 'schema/examples/single-floor.json', 'fixtures/two-floor-stair.json']) {
    const data = read(rel);
    assert.equal(validators.plan(data), true, JSON.stringify(validators.plan.errors));
    assert.deepEqual(codes(data), []);
  }
  for (const rel of ['templates/apt-1br.json', 'templates/apt-2br.json', 'templates/apt-3br.json']) {
    const data = read(rel);
    assert.equal(validators.template(data), true, JSON.stringify(validators.template.errors));
    assert.deepEqual(codes(data.plan), []);
  }
});

test('createEmptyPlan is one floor and validates', () => {
  const plan = createEmptyPlan({ now: 1, id: 'plan-new', name: '新', floorId: 'f1' });
  assert.equal(plan.floors.length, 1);
  assert.equal(plan.schemaVersion, 2);
  assert.deepEqual(codes(plan), []);
  assert.equal(validators.plan(plan), true, JSON.stringify(validators.plan.errors));
});

test('structural fixtures fail Ajv and validatePlan', () => {
  const expectFail = {
    'missing-version.json': 'UNSUPPORTED_VERSION',
    'version-1.json': 'UNSUPPORTED_VERSION',
    'version-3.json': 'NEWER_VERSION',
    'bad-thickness.json': 'OUT_OF_RANGE',
    'bad-t.json': 'OUT_OF_RANGE',
    'bad-color.json': 'BAD_COLOR',
    'unknown-prop.json': 'UNKNOWN_PROPERTY',
  };
  for (const [file, code] of Object.entries(expectFail)) {
    const data = read(`test/fixtures/invalid/${file}`);
    assert.equal(validators.plan(data), false, file);
    assert.ok(codes(data).includes(code), `${file} codes ${codes(data).join(',')}`);
  }
  const newer = validatePlan(read('test/fixtures/invalid/version-3.json'));
  assert.equal(newer.find((item) => item.code === 'NEWER_VERSION').message, '请使用新版本');
});

test('semantic fixtures pass Ajv and fail validatePlan', () => {
  const expectCode = {
    'dangling-node.json': 'DANGLING_NODE',
    'opening-other-floor.json': 'OPENING_WALL_FLOOR',
    'opening-virtual.json': 'OPENING_ON_VIRTUAL',
    'stair-same-floor.json': 'STAIR_SAME_FLOOR',
    'stair-skip-floor.json': 'STAIR_NOT_ADJACENT',
    'duplicate-id.json': 'DUPLICATE_ID',
  };
  for (const [file, code] of Object.entries(expectCode)) {
    const data = read(`test/fixtures/invalid/${file}`);
    assert.equal(validators.plan(data), true, `${file} ${JSON.stringify(validators.plan.errors)}`);
    assert.ok(codes(data).includes(code), `${file} codes ${codes(data).join(',')}`);
  }
});

test('a floor gap is a warning and still a v2 plan', () => {
  const plan = createEmptyPlan({ now: 1, id: 'gap', name: 'gap', floorId: 'f1' });
  const upper = {
    id: 'f2', name: '2F', elevation: 3000, height: 2900, slab: 200, ceiling: 2800,
    nodes: [], walls: [], openings: [], rooms: [], furniture: [], voids: [],
  };
  plan.floors.push(upper);
  const issues = validatePlan(plan);
  assert.equal(issues.some((item) => item.code === 'FLOOR_GAP' && item.severity === 'warning'), true);
  assert.equal(issues.some((item) => item.severity !== 'warning'), false);
});
