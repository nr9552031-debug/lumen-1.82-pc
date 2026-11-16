'use strict';
// Projection Studio logic tests: project persistence and restore-on-stop after a light is dropped.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PJ = require('../src/shared/proj-core');
const { createApi } = require('../src/main/api');
const { ProjLights } = require('../src/main/projlights');

async function main() {
  // Exercise the same API used by the renderer, including normalization and saved shape settings.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-projection-'));
  const data = { settings: {}, devices: {}, rooms: [], groups: [], scenes: [], layouts: [], schedules: [], projections: [] };
  let saves = 0;
  const store = { dir, data, save: () => { saves++; }, getSecret: () => null };
  const manager = { providers: { wiz: {}, hubspace: {}, cync: {} }, devices: new Map(), _meta: () => ({}), _normalize: (_d, p) => p, _emit: () => {} };
  const fx = { active: false, stop: async () => {} };
  const api = createApi({ manager, store, fx, automation: {}, diag: { redact: String, dump: () => '', log: () => {} }, platform: { version: 'test' } });
  const input = PJ.project({ name: 'Studio persistence', regions: [{ id: 'wall-1', name: 'North wall', preset: 'hex', pts: PJ.shape('polygon'), speed: 1.7, hue: 92, bright: 0.7, opacity: 0.8, blend: 'screen', lights: ['bulb-1'] }] });
  const saved = api['proj:save'](input);
  assert(saved.id, 'new projects receive a persistent id');
  const loaded = api['proj:list']().map(PJ.project)[0];
  assert.strictEqual(loaded.name, 'Studio persistence');
  assert.deepStrictEqual(loaded.regions[0], saved.regions[0]);
  assert.strictEqual(loaded.regions[0].preset, 'hex');
  assert.strictEqual(loaded.regions[0].blend, 'screen');
  assert(saves > 0, 'project save reaches the store');

  // A device that repeatedly rejects projection updates is dropped from live driving, but its
  // first pre-show snapshot must still be used by Stop to restore it.
  let now = 1000;
  const original = { id: 'bulb-1', brand: 'hubspace', name: 'Test bulb', online: true, on: true, brightness: 37, rgb: [12, 34, 56], mode: 'color', caps: { color: true, dim: true } };
  const restores = [];
  const brokenManager = {
    devices: new Map([[original.id, original]]), providers: { hubspace: { setState: async () => { throw new Error('simulated offline'); } } },
    _normalize: (_dev, p) => p, _emit: () => {},
    apply: async (ids, patch) => { restores.push({ ids, patch }); },
  };
  const lights = new ProjLights({ manager: brokenManager, now: () => now, rates: { hubspace: 40 } });
  lights.start({ smooth: 0 });
  for (let i = 0; i < 4; i++) {
    now += 50;
    lights.frame({ [original.id]: { rgb: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]][i], bri: 80 } });
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.strictEqual(lights.status().dropped.length, 1, 'repeated failures stop further commands to that bulb');
  await lights.stop();
  assert.strictEqual(restores.length, 1, 'Stop still attempts to restore a dropped bulb');
  assert.deepStrictEqual(restores[0], { ids: ['bulb-1'], patch: { on: true, brightness: 37, rgb: [12, 34, 56] } });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('projection: project persistence and dropped-bulb restore passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
