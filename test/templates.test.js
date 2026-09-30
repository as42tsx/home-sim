import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { getFloor } from '../src/model/document.js';
import { validatePlan } from '../src/model/validate.js';
import { checkOpeningPlacement } from '../src/openings/clearance.js';
import { deriveAllFloors } from '../src/rooms/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * v1.2 has no clearance violations.
 * checkOpeningPlacement returns an empty list for every opening.
 */
const KNOWN_CLEARANCE_VIOLATIONS = {
  'apt-1br': [],
  'apt-2br': [],
  'apt-3br': [],
};

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(read('schema/plan.v2.schema.json'));
const validateTemplate = ajv.compile(read('schema/template.v2.schema.json'));
const validatePlanSchema = ajv.getSchema('https://as42tsx.github.io/home-sim/schema/plan.v2.schema.json');

for (const id of ['apt-1br', 'apt-2br', 'apt-3br']) {
  test(`${id} matches Luna's room count and centreline areas`, () => {
    const file = read(`templates/${id}.json`);
    assert.equal(validateTemplate(file), true, JSON.stringify(validateTemplate.errors));
    assert.equal(validatePlanSchema(file.plan), true, JSON.stringify(validatePlanSchema.errors));
    const errors = validatePlan(file.plan).filter((item) => item.severity !== 'warning');
    assert.deepEqual(errors, []);

    const derived = deriveAllFloors(file.plan);
    const floorId = file.plan.floors.find((floor) => floor.rooms.length).id;
    const result = derived[floorId];
    assert.equal(result.derived.length, file.expected.roomCount);

    const floor = getFloor(file.plan, floorId);
    let interior = 0;
    for (const row of file.expected.rooms) {
      const face = result.derived.find((item) => item.name === row.name);
      assert.ok(face, `missing derived room ${row.name}`);
      const delta = face.centerlineAreaM2 - row.areaM2;
      assert.ok(
        Math.abs(delta) <= 0.1,
        `${row.name} centreline ${face.centerlineAreaM2} vs Luna ${row.areaM2}`,
      );
      assert.equal(Number.isFinite(face.areaM2), true);
      const stored = floor.rooms.find((item) => item.id === face.roomId);
      if (stored.type !== 'balcony') interior += face.centerlineAreaM2;
    }
    if (id === 'apt-3br') {
      assert.ok(Math.abs(interior - 88.9) <= 0.1, `3BR interior centreline ${interior}`);
    }

    const violating = [];
    for (const opening of floor.openings) {
      const problems = checkOpeningPlacement(file.plan, floorId, opening.id);
      assert.ok(Array.isArray(problems));
      if (problems.length) violating.push(opening.id);
    }
    assert.deepEqual(violating.sort(), [...KNOWN_CLEARANCE_VIOLATIONS[id]].sort());
  });
}
