'use strict';
// Projection Studio logic tests: project persistence and restore-on-stop after a light is dropped.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const PJ = require('../src/shared/proj-core');
const PJA = require('../src/shared/proj-audio');
const { createSaveQueue, commitProjectPhoto, runForCurrentProject } = require('../src/shared/proj-save');
const { createApi } = require('../src/main/api');
const { ProjLights } = require('../src/main/projlights');

async function main() {
  // Palette samples are finite, clamped sRGB values; all legacy saved animation IDs resolve.
  assert.strictEqual(PJ.PALETTE_IDS.length, 5, 'the shared visual palette set is available');
  for (const id of PJ.PALETTE_IDS) for (const phase of [-2, 0, 0.25, 0.5, 0.75, 1, 2]) {
    const rgb = PJ.paletteColor(id, phase);
    assert.strictEqual(rgb.length, 3);
    assert(rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${id} palette sample stays in sRGB range`);
    const pixels = PJ.palettePixels(id, 16);
    assert(pixels instanceof Uint8Array && pixels.length === 64, `${id} palette texture has RGBA byte data`);
    for (let i = 3; i < pixels.length; i += 4) assert.strictEqual(pixels[i], 255, `${id} palette texture stays opaque`);
    assert.deepStrictEqual(Array.from(pixels.slice(0, 3)), Array.from(pixels.slice(-4, -1)), `${id} palette wraps without a visible endpoint jump`);
  }
  assert.strictEqual(PJ.palettePixels('aurora', 1).length, 8, 'palette texture generation clamps to the minimum valid width');
  assert.strictEqual(PJ.palettePixels('aurora', 2048).length, 4096, 'palette texture generation caps its allocation');
  assert.deepStrictEqual(PJ.paletteColor('not-a-palette', 0), PJ.paletteColor('aurora', 0), 'unknown palettes migrate to a safe default');
  for (const id of PJ.PRESET_IDS) assert.strictEqual(PJ.presetId(id), id, `${id} keeps resolving for existing layouts`);
  assert.strictEqual(PJ.presetId('unknown-preset'), 'galaxy', 'unknown preset data has a safe fallback');
  assert.strictEqual(PJ.project({}).palette, 'aurora', 'older projects receive the shared palette default');
  assert.strictEqual(PJ.project({ palette: 'ember' }).palette, 'ember', 'saved palette selection round-trips');

  const drive = { sub: 0.3, bass: 0.8, lowMid: 0.2, mid: 0.6, highMid: 0.4, treble: 0.9, onsetStrength: 0.7, beat: true, beatStrength: 0.5, impulse: 0.2, drop: true, trend: -0.4 };
  assert.strictEqual(PJ.audioFeature(drive, 'bass'), 0.8, 'bass remains available to animation profiles');
  assert.strictEqual(PJ.audioFeature(drive, 'body'), 0.4, 'body combines low mids and mids');
  assert.strictEqual(PJ.audioFeature(drive, 'air'), 0.65, 'air combines high mids and treble');
  assert.strictEqual(PJ.audioFeature(drive, 'hit'), 0.7, 'hit responds to onset, beat, and impulse');
  assert.strictEqual(PJ.audioFeature(drive, 'drop'), 1, 'drop is a normalized event pulse');
  assert.strictEqual(PJ.audioFeature({ ...drive, bass: 2 }, 'bass'), 1, 'feature values are clamped');
  assert.strictEqual(PJ.audioFeature({ ...drive, silent: true }, 'hit'), 0, 'silence suppresses transient controls');
  const fullDrive = { sub: 0.7, bass: 0.9, lowMid: 0.8, mid: 0.75, highMid: 0.7, treble: 0.65, rms: 0.8, centroid: 0.6, flux: 0.7, impulse: 0.8, onsetStrength: 0.8, energy: 0.9, trend: 0.5, beat: true, beatStrength: 0.9, drop: true };
  for (const id of PJ.PRESET_IDS) {
    const live = PJ.newControls();
    for (let i = 0; i < 4; i++) PJ.controls(id, fullDrive, 0.12, live, 1);
    assert(live.speedK > 1, `${id} shared profile speeds up from music energy`);
    assert(live.out.every((v, i) => Number.isFinite(v) && v >= (i === 4 ? -1 : 0) && v <= 1), `${id} profile output stays within shader bounds`);
    const quiet = PJ.newControls(); PJ.controls(id, { silent: true }, 0.12, quiet, 1);
    assert.strictEqual(quiet.out[8], 0, `${id} has no hit pulse while silent`);
    assert.strictEqual(quiet.out[11], 0, `${id} has no drop burst while silent`);
  }

  // Debounced writes keep the edited layout attached to its own captured state across quick switches.
  const writes = [], ownerA = { id: '' }, ownerB = { id: 'saved-b' };
  const saveQueue = createSaveQueue(async (p) => { writes.push(p); return { id: p.id || 'new-a' }; }, (owner, saved) => { owner.id = saved.id; }, () => {}, 60000);
  saveQueue.queue(ownerA, { id: '', name: 'First layout', regions: [{ id: 'a' }] });
  saveQueue.queue(ownerA, { id: '', name: 'First layout edited', regions: [{ id: 'a', hue: 170 }] });
  saveQueue.queue(ownerB, { id: 'saved-b', name: 'Second layout', regions: [{ id: 'b' }] });
  await saveQueue.flush();
  assert.strictEqual(writes.length, 2, 'pending writes are coalesced per edited project');
  assert.strictEqual(writes[0].name, 'First layout edited', 'the latest shape changes are captured');
  assert.strictEqual(writes[1].name, 'Second layout', 'switching layouts does not redirect a pending save');
  assert.strictEqual(ownerA.id, 'new-a', 'the new layout id is assigned to its owner');

  const photoOwner = { name: 'Photo source layout' }, otherLayout = { name: 'Selected layout' };
  let photoRepainted = false;
  commitProjectPhoto(photoOwner, 'data:image/jpeg;base64,photo', (owner) => owner === otherLayout, () => { photoRepainted = true; });
  assert.strictEqual(photoOwner.photo, 'data:image/jpeg;base64,photo', 'a delayed photo load updates its originating project');
  assert.strictEqual(photoRepainted, false, 'a delayed photo load does not repaint the newly selected project');
  let scheduledMutation = 0;
  assert.strictEqual(runForCurrentProject(photoOwner, (owner) => owner === otherLayout, () => { scheduledMutation++; }), false, 'a delayed beat change is canceled after switching projects');
  assert.strictEqual(scheduledMutation, 0, 'a stale scheduled animation change cannot mutate a detached shape');

  // Stop must wait for a slow cloud write to settle before applying the pre-show state, otherwise
  // the late show write can land after the restore command and leave the bulb changed.
  const order = [];
  const slowManager = {
    devices: new Map([['bulb-slow', { id: 'bulb-slow', brand: 'hubspace', name: 'Slow bulb', online: true, on: true, brightness: 31, rgb: [7, 8, 9], mode: 'color', caps: { color: true, dim: true } }]]),
    providers: { hubspace: { setState: async () => { await new Promise((resolve) => setTimeout(resolve, 25)); order.push('show-write'); } } },
    _normalize: (_dev, p) => p, _emit: () => {},
    apply: async () => { order.push('restore'); return { ok: 1, failed: 0 }; },
  };
  const slowLights = new ProjLights({ manager: slowManager, now: () => 1000 });
  slowLights.start({ smooth: 0 });
  slowLights.frame({ 'bulb-slow': { rgb: [100, 40, 20], bri: 80 } });
  await Promise.all([slowLights.stop(), slowLights.stop()]);
  assert.deepStrictEqual(order, ['show-write', 'restore'], 'the restore command follows the in-flight show command');

  // A rejected restore stays visible and retryable instead of silently discarding the only snapshot.
  const retryDevice = { id: 'retry', brand: 'wiz', name: 'Retry bulb', online: true, on: true, brightness: 42, rgb: [2, 3, 4], mode: 'color', caps: { color: true, dim: true } };
  let rejectRestore = true, attempts = 0;
  const retryManager = {
    devices: new Map([[retryDevice.id, retryDevice]]), providers: { wiz: { setState: async () => {} } },
    _normalize: (_dev, p) => p, _emit: () => {},
    apply: async () => { attempts++; return rejectRestore ? { ok: 0, failed: 1 } : { ok: 1, failed: 0 }; },
  };
  const retryLights = new ProjLights({ manager: retryManager, now: () => 2000 });
  retryLights.start(); retryLights.frame({ retry: { rgb: [90, 80, 70], bri: 65 } });
  await retryLights.stop();
  assert.strictEqual(retryLights.status().restoreFailed[0].id, 'retry', 'failed restores are reported');
  assert.strictEqual(retryLights.snapshot.has('retry'), true, 'failed restore keeps its original snapshot');
  rejectRestore = false;
  await retryLights.stop();
  assert.strictEqual(attempts, 2, 'a second Stop retries the failed restore');
  assert.strictEqual(retryLights.snapshot.has('retry'), false, 'successful retry clears the snapshot');
  assert.strictEqual(retryLights.status().restoreFailed.length, 0, 'successful retry clears the failure status');

  // Verify every animation in the picker has a matching shader and is placed in exactly one picker group.
  const renderWindow = {
    LumenProj: PJ,
    LumenColor: require('../src/shared/color'),
    LumenEvolve: require('../src/shared/av-evolve'),
    LumenDirector: require('../src/shared/av-director'),
  };
  const renderSource = fs.readFileSync(path.join(__dirname, '../src/shared/proj-render.js'), 'utf8');
  vm.runInNewContext(renderSource, { window: renderWindow, console });
  assert(renderSource.includes('uniform sampler2D PALETTE') && renderSource.includes('P.palettePixels(key, 256)'), 'shared renderer uploads the normalized shared palette for its GLSL shader');
  assert(renderSource.includes('uniform1f(pr.U.SHIFT, st.hue / 360)') && renderSource.includes('fract(rawL+SHIFT+TINT*.08)'), 'shape colour shift continues to move through the selected palette');
  for (const id of ['aurora', 'fire', 'smoke', 'clouds', 'ocean', 'waves', 'flow', 'lava', 'rain', 'snow', 'rays']) {
    const marker = `${id}: \``; const start = renderSource.indexOf(marker) + marker.length, end = renderSource.indexOf('`', start), shader = renderSource.slice(start, end);
    assert(start >= marker.length && end > start, `${id} flow shader source remains present`);
    assert(shader.includes('pal('), `${id} uses the shared palette`);
    assert(/\b(A|SWELL|EMIT|TURB|SHIM)\b/.test(shader), `${id} responds through shared audio controls`);
  }
  for (const id of ['stars', 'particles', 'bokeh', 'fireflies', 'magic']) {
    const marker = `${id}: \``; const start = renderSource.indexOf(marker) + marker.length, end = renderSource.indexOf('`', start), shader = renderSource.slice(start, end);
    assert(start >= marker.length && end > start, `${id} particle shader source remains present`);
    assert(shader.includes('pal(') && /\b(A|SWELL|EMIT|TURB|SHIM)\b/.test(shader), `${id} uses shared palette and audio controls`);
    const bounds = [...shader.matchAll(/for\(int\s+\w+=\d+;\s*\w+<([0-9]+);/g)].map((m) => +m[1]);
    assert(bounds.length > 0 && Math.max(...bounds) <= 16, `${id} uses a bounded small shader loop`);
  }
  for (const id of ['warp', 'portal', 'energy', 'fractal', 'kaleido', 'tunnel', 'synth', 'rings', 'laser', 'disco', 'hex']) {
    const marker = `${id}: \``; const start = renderSource.indexOf(marker) + marker.length, end = renderSource.indexOf('`', start), shader = renderSource.slice(start, end);
    assert(start >= marker.length && end > start, `${id} geometry shader source remains present`);
    assert(shader.includes('pal(') && /\b(A|SWELL|EMIT|TURB|SHIM|HIT)\b/.test(shader), `${id} uses shared palette and audio controls`);
    const bounds = [...shader.matchAll(/for\(int\s+\w+=\d+;\s*\w+<([0-9]+);/g)].map((m) => +m[1]);
    assert(bounds.every((v) => v <= 28), `${id} shader loops remain constant and bounded`);
  }
  assert(renderSource.includes('for(int i=0;i<28;i++)'), 'fractal escape iterations are reduced to a fixed cap of 28');
  for (const id of ['galaxy', 'nebula', 'plasma', 'ink']) {
    const marker = `${id}: \``; const start = renderSource.indexOf(marker) + marker.length, end = renderSource.indexOf('`', start), shader = renderSource.slice(start, end);
    assert(start >= marker.length && end > start, `${id} noise-field shader source remains present`);
    assert(shader.includes('pal(') && /\b(A|SWELL|EMIT|TURB|SHIM)\b/.test(shader), `${id} uses shared palette and audio controls`);
  }
  const editorSource = fs.readFileSync(path.join(__dirname, '../src/renderer/projection.js'), 'utf8');
  assert(editorSource.includes('data-palette') && editorSource.includes('pj.cur.palette = PJ.paletteId(t.value)'), 'Visuals tab persists the selected shared palette');
  const grouped = PJ.GROUPS.flatMap((g) => g[1]);
  assert.strictEqual(grouped.length, PJ.PRESET_IDS.length, 'each animation appears in a picker group');
  assert.strictEqual(new Set(grouped).size, PJ.PRESET_IDS.length, 'picker groups contain no duplicate animations');
  assert(PJ.PRESET_IDS.every((id) => renderWindow.PROJ_FX.includes(id)), 'every picker animation has a renderer shader');

  // All scripts referenced by either page must exist in the packaged source tree.
  for (const page of ['src/renderer/index.html', 'src/renderer/projector.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert(fs.existsSync(path.resolve(path.dirname(path.join(__dirname, '..', page)), src)), `${page} script exists: ${src}`);
  }

  assert.strictEqual(PJA.fallbackSource('darwin', 'system', { noTrack: true }), 'mic', 'macOS system capture falls back when no audio track is supplied');
  assert.strictEqual(PJA.fallbackSource('darwin', 'system', { refused: true }), 'system', 'permission refusal is not silently rerouted');
  assert.strictEqual(PJA.fallbackSource('win32', 'system', { noTrack: true }), 'system', 'Windows source selection is unchanged');
  assert.strictEqual(PJA.fallbackSource('darwin', 'mic', { noTrack: true }), 'mic', 'an explicitly selected microphone stays selected');

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

  const zeroBrightness = { id: 'zero', brand: 'wiz', name: 'Dim bulb', online: true, on: true, brightness: 0, rgb: [10, 20, 30], mode: 'color', caps: { color: true, dim: true } };
  const zeroRestores = [];
  const zeroManager = {
    devices: new Map([[zeroBrightness.id, zeroBrightness]]), providers: { wiz: { fast: () => {} } },
    _normalize: (_dev, p) => p, _emit: () => {},
    apply: async (ids, patch) => { zeroRestores.push({ ids, patch }); return { ok: 1, failed: 0 }; },
  };
  const zeroLights = new ProjLights({ manager: zeroManager, now: () => 3000 });
  zeroLights.start(); zeroLights.frame({ zero: { rgb: [200, 100, 50], bri: 75 } });
  zeroBrightness.rgb[0] = 240; // the snapshot must not alias mutable device colour state
  await zeroLights.stop();
  assert.deepStrictEqual(zeroRestores[0].patch, { on: true, brightness: 0, rgb: [10, 20, 30] }, 'restore retains zero brightness and an independent original RGB snapshot');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('projection: project persistence and dropped-bulb restore passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
