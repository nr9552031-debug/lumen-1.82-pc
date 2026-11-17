'use strict';
// Every request the page can make, as plain functions. main.js exposes them over IPC; the tests call them directly.
// `platform` is the small set of things only Electron can do (windows, dialogs, clipboard, start with Windows).
const net = require('net');
const { normalize: normalizeFx } = require('./fx');
const Proj = require('../shared/proj-core');
const Core = require('../shared/show-core');
const { ProjLights } = require('./projlights');
const { createShowApi } = require('./showapi');
const { createTechnologyOptimization } = require('./technology-optimization');

function createApi({ manager, store, fx, automation, diag, platform }) {
  const { wiz, hubspace, cync } = manager.providers;
  const settings = () => store.data.settings;
  // bulb timing for projection cues comes from the same per-bulb profiles Lightshow uses (Bulbs tab, Line up the lights)
  const latProf = (id) => (((settings() || {}).showLatency) || {})[id] || {};
  const projLights = manager.projLights = new ProjLights({ manager,
    latencyOf: (id) => { const d = manager.devices.get(id); return d ? Core.latencyOf({ brand: d.brand }, latProf(id)) : 0; },
    intervalOf: (id) => { const d = manager.devices.get(id); return d ? Core.intervalOf({ brand: d.brand }, latProf(id)) : 500; } });
  const projects = () => (Array.isArray(store.data.projections) ? store.data.projections : (store.data.projections = []));
  manager.extra = () => ({ sleep: automation.sleep, fx: { active: fx.active, mode: fx.mode } });
  const forgetBrand = (brand) => { for (const [id, d] of [...manager.devices]) if (d.brand === brand) manager.forgetDevice(id); manager._emit(); };
  const saveFx = (o) => { const cfg = normalizeFx(o); settings().fx = cfg; store.save(); return cfg; };
  const fxState = () => ({ ...fx.status(), saved: settings().fx || null });
  const count = (b) => [...manager.devices.values()].filter((d) => d.brand === b).length;
  const report = () => [
    `Lumen ${platform.version} | ${platform.runtime || ''}`,
    `secure storage available: ${store.secretsPersistent !== false}`,
    `lights: wiz=${count('wiz')} hubspace=${count('hubspace')} cync=${count('cync')}`,
    `accounts: hubspace=${hubspace.connected} cync=${cync.connected} | cync relay=${cync.loggedIn ? 'connected (' + cync.relayMode + ')' : 'not connected'}`,
    `errors: ${diag.redact(JSON.stringify(manager.lastError))}`,
    `effects: ${fx.active ? 'running ' + fx.mode : 'idle'} sent=${JSON.stringify(fx.sent)} dropped=${fx.dropped.length}`,
    `schedules: ${store.data.schedules.length} | layouts: ${store.data.layouts.length} | theme: ${settings().theme || 'aero'}`,
    '--- log (no passwords or tokens are recorded) ---',
    diag.dump() || '(empty)',
  ].join('\n');

  const showApi = createShowApi({ manager, store, fx, projLights, platform });
  const technologyOptimization = createTechnologyOptimization({ store, projectDir: platform.projectDir });
  return {
    ...showApi,
    ...technologyOptimization,
    'td:status': () => platform.touchDesigner.snapshot(),
    'td:config': (patch) => platform.touchDesigner.saveConfig(patch),
    'td:connect': () => platform.touchDesigner.connect(),
    'td:disconnect': () => platform.touchDesigner.disconnect(),
    'td:models': () => platform.touchDesigner.models(),
    'td:run': (prompt, model) => platform.touchDesigner.run(prompt, model),
    'td:approve': (runId, approved, approveRoutine) => platform.touchDesigner.approveTool(runId, approved, approveRoutine),
    'td:stop': () => platform.touchDesigner.stopRun(),
    state: () => manager.snapshot(),
    scan: () => manager.scan(),
    // patch {on:true} alone honours the "switch on at" default, if the user enabled one
    apply: (scope, patch, label) => {
      const d = settings().defaultOn;
      if (d && d.enabled && patch && patch.on === true && Object.keys(patch).length === 1) patch = { on: true, brightness: d.brightness, kelvin: d.kelvin };
      return manager.applyTracked(manager.scopeIds(scope), patch, label);
    },
    applyMap: (map, label) => manager.applyMap(map, label),
    saturation: (scope, sat) => manager.adjustSaturation(manager.scopeIds(scope), Number(sat)),
    undo: () => manager.undo(),
    redo: () => manager.redo(),
    'scene:apply': (id, scope) => manager.applyScene(id, scope),
    'scene:save': (name, icon, scope) => manager.saveSceneFromCurrent(name, icon, scope),
    'scene:delete': (id) => manager.deleteScene(id),
    'scene:update': (id, patch) => manager.updateScene(id, patch),
    'scene:duplicate': (id) => manager.duplicateScene(id),
    'scene:recapture': (id, scope) => manager.recaptureScene(id, scope),
    'device:meta': (id, meta) => manager.setMeta(id, meta),
    'device:forget': (id) => manager.forgetDevice(id),
    'bulk:room': (ids, room) => { for (const id of Array.isArray(ids) ? ids : []) if (manager.devices.has(id)) manager.setMeta(id, { room: room || '' }); },
    'room:add': (n) => manager.addRoom(n),
    'room:rename': (id, n) => manager.renameRoom(id, n),
    'room:delete': (id) => manager.deleteRoom(id),
    'group:save': (g) => manager.saveGroup(g),
    'group:delete': (id) => manager.deleteGroup(id),
    // ---- projection studio ----
    'proj:list': () => projects(),
    'proj:save': (p) => {
      const c = Proj.project(p), list = projects();
      if (!c.id) c.id = 'proj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const i = list.findIndex((x) => x.id === c.id); if (i >= 0) list[i] = c; else list.push(c);
      store.save(); return c;
    },
    'proj:delete': (id) => { store.data.projections = projects().filter((x) => x.id !== id); store.save(); },
    'proj:displays': () => (platform.displays ? platform.displays() : []),
    'proj:open': (o) => { if (!platform.projOpen) throw new Error('Projector output is not available here'); return platform.projOpen(o || {}); },
    'proj:close': () => (platform.projClose ? platform.projClose() : null),
    // Light sync and the audio effects would fight over the same bulbs, so starting one stops the other.
    'proj:lights:start': async (o) => { if (fx.active) await fx.stop(); if (manager.showPlayer && manager.showPlayer.state === 'playing') await manager.showPlayer.stop(); return projLights.start(o); },
    'proj:lights:stop': (o) => projLights.stop(o),
    'proj:lights:frame': (t) => projLights.frame(t),
    'proj:lights:cue': (list) => projLights.cue(list),
    'proj:status': () => ({ lights: projLights.status(), output: platform.projState ? platform.projState() : { open: false } }),
    'layout:save': (l) => manager.saveLayout(l),
    'layout:delete': (id) => manager.deleteLayout(id),
    'layout:apply': (id, arrId) => manager.applyArrangement(id, arrId),
    'schedule:save': (s) => manager.saveSchedule(s),
    'schedule:delete': (id) => manager.deleteSchedule(id),
    'schedule:run': (id) => { const s = store.data.schedules.find((x) => x.id === id); if (!s) throw new Error('Schedule not found'); return automation.run(s); },
    'sleep:set': (minutes, scope) => automation.setSleep(minutes, scope),
    'sleep:cancel': () => automation.cancelSleep(),
    'settings:set': (patch) => {
      const st = manager.setSettings(patch);
      if (patch && patch.cyncAllowUnverifiedTls !== undefined) { cync.o.allowUnverified = !!st.cyncAllowUnverifiedTls; if (!cync.o.allowUnverified) store.setSecret('cync_relay_pin', null); cync._drop(); if (cync.connected) manager.scan(); }
      if (patch && patch.startup) platform.applyStartup(st.startup || {});
      return st;
    },
    'backup:export': async () => platform.saveFile(`lumen-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(manager.exportConfig(), null, 1)),
    'backup:import': async () => {
      const text = await platform.openFile(); if (text === null) return null;
      let o; try { o = JSON.parse(text); } catch { throw new Error('That file is not a Lumen backup'); }
      return manager.importConfig(o);
    },
    'wiz:addIp': async (ip) => {
      ip = String(ip || '').trim();
      if (!net.isIPv4(ip)) throw new Error('Enter the bulb\'s IPv4 address, e.g. 192.168.1.42');
      const d = await wiz.probe(ip);
      if (!d) throw new Error('No WiZ bulb answered at that address');
      const s = settings(); s.wizIps = [...new Set([...(s.wizIps || []), ip])];
      manager._merge(d); store.save(); manager._emit(); return d.name;
    },
    'hubspace:connect': async (email, pw) => {
      const r = await hubspace.login(email, pw);
      settings().hubspaceEmail = String(email || '').trim(); store.save();
      if (!r.needs2fa) manager.scan();
      return r;
    },
    'hubspace:2fa': async (code) => { await hubspace.verifyOtp(code); manager.scan(); },
    'hubspace:disconnect': () => { hubspace.disconnect(); forgetBrand('hubspace'); },
    'cync:connect': async (email, pw) => { const r = await cync.login(email, pw); settings().cyncEmail = String(email || '').trim(); store.save(); if (r.ok) manager.scan(); return r; },
    'cync:2fa': async (code) => { await cync.verify2fa(code); manager.scan(); },
    'cync:disconnect': () => { cync.disconnect(); forgetBrand('cync'); },
    // ---- effects ----
    'fx:status': () => fxState(),
    'fx:start': async (o) => { if (manager.showPlayer && manager.showPlayer.state !== 'idle') await manager.showPlayer.stop(); fx.start(normalizeFx(o)); saveFx(o); return fxState(); },
    // Live changes during a show; with no show running it just remembers the chosen settings.
    'fx:update': (o) => { const cfg = saveFx(o); if (fx.active) fx.update(cfg); return fxState(); },
    'fx:stop': async () => { await fx.stop(); return fxState(); },
    'fx:note': (m) => { diag.log('fx', String(m).slice(0, 240)); },
    diag: () => report(),
    'diag:copy': () => { platform.copy(report()); },
    openExternal: (u) => { if (/^https:\/\//.test(String(u))) platform.openExternal(u); },
    'app:info': () => ({ version: platform.version, runtime: platform.runtime, logFile: diag.file, portable: !!platform.portable }),
    'win:min': () => platform.win('minimize'),
    'win:max': () => platform.win('maximize'),
    'win:close': () => platform.win('close'),
  };
}
// Frames arrive many times a second on a one-way channel, so they are validated here rather than trusted.
const FEAT_KEYS = ['sub', 'lowMid', 'highMid', 'rms', 'centroid', 'flux', 'impulse', 'energy', 'trend', 'build', 'dyn', 'beatPhase', 'barPos', 'bpm'];
function cleanFrame(f) {
  if (!f || typeof f !== 'object') return null;
  const unit = (x) => { x = Number(x); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; };
  // 1.7 music features for the projector window (all optional; older senders simply leave them out)
  const extra = {}; for (const k of FEAT_KEYS) if (f[k] !== undefined) extra[k] = k === 'trend' ? Math.max(-1, Math.min(1, Number(f[k]) || 0)) : k === 'bpm' ? Math.max(0, Math.min(300, Number(f[k]) || 0)) : unit(f[k]);
  if (typeof f.section === 'string') extra.section = f.section.slice(0, 12);
  return { ...extra, bass: unit(f.bass), mid: unit(f.mid), treble: unit(f.treble), level: unit(f.level), beat: !!f.beat, silent: !!f.silent, drop: !!f.drop, beatStrength: unit(f.beatStrength),
    screen: Array.isArray(f.screen) && f.screen.length === 3 ? f.screen.map((c) => Math.min(255, Math.max(0, Math.round(Number(c) || 0)))) : null };
}
module.exports = { createApi, cleanFrame };
