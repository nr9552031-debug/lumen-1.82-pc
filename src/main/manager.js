'use strict';
const { EventEmitter } = require('events');
const { clamp, rgbToKelvin, statePatch, uid, str, num, rgbOk, rgb } = require('./util');
const { PRESETS } = require('./presets');

// A scene entry from a backup file: only on/brightness/colour/white, in range.
const cleanEntry = (e) => { e = e || {}; const o = { on: e.on !== false }; if (e.brightness !== undefined) o.brightness = num(e.brightness, 1, 100, 80); if (rgbOk(e.rgb)) o.rgb = rgb(e.rgb); else if (e.kelvin !== undefined) o.kelvin = num(e.kelvin, 1800, 7000, 2700); return o; };

class Manager extends EventEmitter {
  constructor(store, providers) {
    super();
    this.store = store;
    this.providers = providers; // { wiz, hubspace, cync }
    this.devices = new Map();
    this.scanning = false;
    this.lastError = {};
    this.needsReauth = {};
    this.undoStack = []; this.redoStack = []; // tracked operations (in memory only)
    this.lastScan = null;
    // Cync's relay pushes real bulb state; fold it into the registry as it arrives.
    if (providers.cync) providers.cync.onState = (id, st) => {
      const dev = this.devices.get(id); if (!dev) return;
      Object.assign(dev, st); dev.assumed = false; this._emit();
    };
    // Restore devices from the last session so the UI is populated instantly.
    for (const [id, d] of Object.entries(store.data.devices)) {
      if (d.cache) this.devices.set(id, { ...d.cache, id, online: false });
    }
  }

  _meta(id) { return (this.store.data.devices[id] = this.store.data.devices[id] || {}); }
  snapshot() {
    const d = this.store.data;
    return {
      devices: [...this.devices.values()].map((x) => ({ ...x, caps: this._meta(x.id).caps || x.caps, name: this._meta(x.id).name || x.name, room: this._meta(x.id).room || null, native: undefined })),
      rooms: d.rooms, groups: d.groups,
      scenes: [...PRESETS, ...d.scenes].map((sc) => ({ ...sc, fav: (d.settings.favScenes || []).includes(sc.id) })),
      settings: d.settings, layouts: d.layouts, schedules: d.schedules, lastScan: this.lastScan,
      history: { undo: this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null, redo: this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null },
      accounts: { hubspace: this.providers.hubspace.connected, cync: this.providers.cync.connected },
      scanning: this.scanning, errors: this.lastError, needsReauth: this.needsReauth,
      ...(this.extra ? this.extra() : {}),
    };
  }
  _emit() { this.emit('changed', this.snapshot()); }
  _persistCache(dev) {
    const m = this._meta(dev.id);
    const { id, ...rest } = dev;
    m.cache = { ...rest, native: dev.native };
    this.store.save();
  }
  _merge(dev) {
    const old = this.devices.get(dev.id);
    const merged = old ? { ...old, ...dev } : dev;
    // a scan that could only GUESS what a light can do must not overwrite what an earlier scan actually learned
    if (dev.capsGuess && old && old.caps && !old.capsGuess) { merged.caps = old.caps; merged.capsGuess = false; }
    this.devices.set(dev.id, merged);
    this._persistCache(merged);
  }

  async scan() {
    if (this.scanning) { this._rescan = true; return; } // e.g. an account was connected mid-scan: run again afterwards
    this.scanning = true; this._emit();
    const { wiz, hubspace, cync } = this.providers;
    const jobs = [
      ['wiz', () => wiz.discover(this.store.data.settings.wizIps || [])],
      ['hubspace', () => hubspace.connected ? hubspace.discover() : []],
      ['cync', () => cync.connected ? cync.discover() : []],
    ];
    await Promise.all(jobs.map(async ([brand, fn]) => {
      try {
        const found = await fn();
        require('./diag').log(brand, `scan found ${found.length} light(s)`);
        delete this.lastError[brand]; delete this.needsReauth[brand];
        const seen = new Set();
        for (const d of found) {
          seen.add(d.id); d.lastSeen = Date.now();
          const prev = this.devices.get(d.id);
          // Cync's cloud list carries no state: keep the last known state until the relay reports the real one.
          if (brand === 'cync' && prev) { d.assumed = prev.assumed; d.on = prev.on; d.brightness = prev.brightness; d.mode = prev.mode; d.kelvin = prev.kelvin; d.rgb = prev.rgb; }
          this._merge(d);
        }
        // anything remembered for this brand but not found is shown offline (WiZ bulbs can just be powered off)
        for (const [id, d] of this.devices) if (d.brand === brand && !seen.has(id)) { d.online = false; }
      } catch (e) { require('./diag').log(brand, `scan failed: ${e.message}`); this.lastError[brand] = e.message; if (e.authExpired) this.needsReauth[brand] = true; }
    }));
    this.scanning = false; this.lastScan = Date.now(); this._emit();
    if (this._rescan) { this._rescan = false; return this.scan(); }
  }

  async refreshStates() {
    const tasks = [];
    for (const dev of this.devices.values()) {
      if (dev.brand === 'cync') continue;
      tasks.push((async () => {
        try {
          const st = await this.providers[dev.brand].refresh(dev);
          Object.assign(dev, st);
        } catch (e) { dev.online = false; if (e.authExpired) { this.lastError[dev.brand] = e.message; this.needsReauth[dev.brand] = true; } }
      })());
    }
    await Promise.all(tasks);
    this._emit();
  }

  // Convert a generic patch into something the target light can actually do.
  _normalize(dev, p) {
    const out = { ...p };
    dev = { ...dev, caps: this._meta(dev.id).caps || dev.caps };
    if (out.rgb && !dev.caps.color) { if (dev.caps.temp) out.kelvin = rgbToKelvin(out.rgb); delete out.rgb; }
    if (out.kelvin && !dev.caps.temp) { delete out.kelvin; }
    if (out.kelvin) out.kelvin = clamp(out.kelvin, dev.kelvinRange[0], dev.kelvinRange[1]);
    if (!dev.caps.dim) delete out.brightness;
    return out;
  }
  async apply(ids, patch) {
    const results = await Promise.allSettled(ids.map(async (id) => {
      const dev = this.devices.get(id);
      if (!dev) return;
      const p = this._normalize(dev, patch);
      const before = { on: dev.on, brightness: dev.brightness, rgb: dev.rgb, mode: dev.mode, kelvin: dev.kelvin };
      // optimistic update so the UI feels instant
      if (p.on !== undefined) dev.on = p.on;
      if (p.on !== false) { dev.on = true; }
      if (p.brightness !== undefined) dev.brightness = p.brightness;
      if (p.rgb) { dev.rgb = p.rgb; dev.mode = 'color'; }
      if (p.kelvin) { dev.kelvin = p.kelvin; dev.mode = 'white'; }
      this._emit();
      try {
        const r = await this.providers[dev.brand].setState(dev, p);
        dev.online = true; dev.lastSeen = dev.lastCmd = Date.now(); dev.lastError = null; dev.assumed = !!(r && r.confirmed === false); this._persistCache(dev);
      } catch (e) {
        Object.assign(dev, before); // roll back the optimistic update; the command was not delivered
        dev.lastError = { at: Date.now(), msg: str(e.message, 160) };
        if (e.authExpired) this.lastError[dev.brand] = e.message; else dev.online = false;
        throw e;
      }
    }));
    this._emit();
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { ok: results.length - failed, failed };
  }

  // ---- tracked operations: everything the user does to lights can be undone ----
  _snap(ids) { const o = {}; for (const id of ids) { const d = this.devices.get(id); if (d) o[id] = { on: !!d.on, brightness: d.brightness, mode: d.mode, rgb: d.rgb, kelvin: d.kelvin }; } return o; }
  _push(label, ids) {
    const key = label + '|' + [...ids].sort().join(','), top = this.undoStack[this.undoStack.length - 1];
    if (top && top.key === key && Date.now() - top.at < 3000) { top.at = Date.now(); return; } // one slider drag = one undo step
    this.undoStack.push({ key, label, at: Date.now(), states: this._snap(ids) });
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }
  applyTracked(ids, patch, label) { ids = ids.filter((id) => this.devices.has(id)); this._push(label || 'Change lights', ids); return this.apply(ids, patch); }
  // Different command per light, as one undoable step. map: { deviceId: patch }
  async applyMap(map, label) {
    const ids = Object.keys(map || {}).filter((id) => this.devices.has(id));
    this._push(label || 'Change lights', ids);
    const rs = await Promise.all(ids.map((id) => this.apply([id], map[id])));
    return rs.reduce((a, r) => ({ ok: a.ok + r.ok, failed: a.failed + r.failed }), { ok: 0, failed: 0 });
  }
  async _restoreEntry(from, to) {
    const e = from.pop(); if (!e) throw new Error(from === this.undoStack ? 'Nothing to undo' : 'Nothing to redo');
    const ids = Object.keys(e.states).filter((id) => this.devices.has(id));
    to.push({ key: e.key, label: e.label, at: 0, states: this._snap(ids) });
    await Promise.all(ids.map((id) => this.apply([id], statePatch(e.states[id]))));
    this._emit(); return e.label;
  }
  undo() { return this._restoreEntry(this.undoStack, this.redoStack); }
  redo() { return this._restoreEntry(this.redoStack, this.undoStack); }
  // Keep each light's own hue but change how vivid it is (colour lights that are showing a colour only).
  adjustSaturation(ids, sat) {
    const { rgbToHsv, hsvToRgb } = require('./util'), map = {};
    for (const id of ids) { const d = this.devices.get(id); if (d && d.on && d.mode === 'color' && d.rgb && (this._meta(id).caps || d.caps).color) { const h = rgbToHsv(d.rgb); map[id] = { on: true, rgb: hsvToRgb([h[0], clamp(sat, 0, 1), h[2] || 1]) }; } }
    return this.applyMap(map, 'Saturation');
  }

  scopeIds(scope) {
    const all = [...this.devices.keys()];
    if (scope && scope.type === 'multi') { // union of rooms, groups and single lights (Colour Studio targets)
      const out = new Set(scope.all ? all : []);
      for (const r of scope.rooms || []) for (const id of this.scopeIds({ type: 'room', id: r })) out.add(id);
      for (const g of scope.groups || []) for (const id of this.scopeIds({ type: 'group', id: g })) out.add(id);
      for (const id of scope.ids || []) if (this.devices.has(id)) out.add(id);
      return [...out];
    }
    if (!scope || scope.type === 'all') return all;
    if (scope.type === 'room') return all.filter((id) => this._meta(id).room === scope.id);
    if (scope.type === 'group') { const g = this.store.data.groups.find((x) => x.id === scope.id); return g ? g.deviceIds.filter((i) => this.devices.has(i)) : []; }
    if (scope.type === 'devices') return scope.ids;
    return [];
  }
  applyScene(sceneId, scope) {
    const scene = [...PRESETS, ...this.store.data.scenes].find((s) => s.id === sceneId);
    if (!scene) throw new Error('Scene not found');
    const ids = this.scopeIds(scope);
    this._push(`Scene: ${scene.name}`, scene.entry ? ids : ids.filter((id) => scene.devices[id]));
    if (scene.entry) return this.apply(ids, scene.entry);
    // custom scene: per-device snapshot (only lights that exist & are in scope)
    return Promise.all(ids.filter((id) => scene.devices[id]).map((id) => this.apply([id], scene.devices[id])))
      .then((rs) => rs.reduce((a, r) => ({ ok: a.ok + r.ok, failed: a.failed + r.failed }), { ok: 0, failed: 0 }));
  }
  saveSceneFromCurrent(name, icon, scope) {
    const devices = {};
    for (const id of this.scopeIds(scope)) {
      const d = this.devices.get(id);
      if (!d) continue;
      const e = { on: !!d.on, brightness: d.brightness };
      if (d.mode === 'color' && d.rgb) e.rgb = d.rgb; else if (d.kelvin) e.kelvin = d.kelvin;
      devices[id] = e;
    }
    const scene = { id: uid('scene'), name: str(name).trim() || 'Scene', icon: str(icon, 8) || '✨', builtin: false, devices };
    this.store.data.scenes.push(scene); this.store.save(); this._emit();
    return scene;
  }
  updateScene(id, { name, icon, fav } = {}) {
    const st = this.store.data.settings, sc = this.store.data.scenes.find((x) => x.id === id);
    if (sc && name !== undefined && str(name).trim()) sc.name = str(name).trim();
    if (sc && icon !== undefined) sc.icon = str(icon, 8) || '✨';
    if (fav !== undefined) { const set = new Set(st.favScenes || []); fav ? set.add(id) : set.delete(id); st.favScenes = [...set]; }
    this.store.save(); this._emit();
  }
  duplicateScene(id) {
    const src = [...PRESETS, ...this.store.data.scenes].find((x) => x.id === id);
    if (!src) throw new Error('Scene not found');
    const devices = src.devices ? JSON.parse(JSON.stringify(src.devices)) : Object.fromEntries([...this.devices.keys()].map((d) => [d, { ...src.entry }]));
    const sc = { id: uid('scene'), name: `${src.name} copy`, icon: src.icon, builtin: false, devices };
    this.store.data.scenes.push(sc); this.store.save(); this._emit(); return sc;
  }
  // Overwrite a saved scene with what the lights are doing right now.
  recaptureScene(id, scope) {
    const sc = this.store.data.scenes.find((x) => x.id === id); if (!sc) throw new Error('Only your own scenes can be updated');
    const tmp = this.saveSceneFromCurrent(sc.name, sc.icon, scope); sc.devices = tmp.devices;
    this.store.data.scenes = this.store.data.scenes.filter((x) => x.id !== tmp.id); this.store.save(); this._emit();
  }
  deleteScene(id) { this.store.data.scenes = this.store.data.scenes.filter((s) => s.id !== id); this.store.save(); this._emit(); }

  setMeta(id, { name, room, caps }) {
    const m = this._meta(id);
    if (caps !== undefined) {
      const ok = ['dim', 'color', 'temp'];
      m.caps = caps ? Object.fromEntries(ok.map((k) => [k, !!caps[k]])) : undefined;
      const d = this.devices.get(id); if (d && m.caps) d.caps = m.caps; else if (d && !m.caps && d.cache) delete m.caps;
    }
    if (name !== undefined) m.name = str(name).trim() || undefined;
    if (room !== undefined) m.room = room ? str(room, 120) : undefined;
    this.store.save(); this._emit();
  }
  addRoom(name) { const r = { id: uid('room'), name: str(name).trim() || 'Room' }; this.store.data.rooms.push(r); this.store.save(); this._emit(); return r; }
  renameRoom(id, name) { const r = this.store.data.rooms.find((x) => x.id === id); if (r && str(name).trim()) r.name = str(name).trim(); this.store.save(); this._emit(); }
  deleteRoom(id) {
    this.store.data.rooms = this.store.data.rooms.filter((r) => r.id !== id);
    for (const m of Object.values(this.store.data.devices)) if (m.room === id) delete m.room;
    this.store.save(); this._emit();
  }
  saveGroup(g) {
    const groups = this.store.data.groups;
    // only a name and a list of light ids are accepted from the page
    const ids = [...new Set((Array.isArray(g && g.deviceIds) ? g.deviceIds : []).map((x) => str(x, 120)).filter(Boolean))].slice(0, 300);
    const name = str(g && g.name).trim() || 'Group';
    if (g && g.id) { const x = groups.find((q) => q.id === g.id); if (x) { if (g.name !== undefined) x.name = name; if (g.deviceIds !== undefined) x.deviceIds = ids; } }
    else groups.push({ id: uid('group'), name, deviceIds: ids });
    this.store.save(); this._emit();
  }
  deleteGroup(id) { this.store.data.groups = this.store.data.groups.filter((g) => g.id !== id); this.store.save(); this._emit(); }
  // ---- room visualizer layouts ----
  saveLayout(l) {
    if (!l || typeof l !== 'object') throw new Error('Invalid layout');
    const kinds = ['wall', 'door', 'window', 'sofa', 'bed', 'table', 'desk', 'tv', 'plant', 'rug', 'shelf', 'chair'], fkinds = ['ceiling', 'lamp', 'strip', 'spot', 'wall'];
    const state = (x) => { x = x || {}; const o = { on: x.on !== false, brightness: num(x.brightness, 1, 100, 80) }; if (rgbOk(x.rgb)) o.rgb = rgb(x.rgb); else o.kelvin = num(x.kelvin, 2000, 7000, 2700); return o; };
    const clean = {
      id: str(l.id) || uid('layout'), name: str(l.name).trim() || 'Room', room: l.room ? str(l.room) : null,
      w: num(l.w, 1.5, 30, 5), h: num(l.h, 1.5, 30, 4), ambient: num(l.ambient, 0, 1, 0.25),
      objects: (Array.isArray(l.objects) ? l.objects : []).slice(0, 150).filter((o) => o && kinds.includes(o.type)).map((o) => ({ id: str(o.id) || uid('o'), type: o.type, x: num(o.x, -5, 35, 1), y: num(o.y, -5, 35, 1), w: num(o.w, 0.05, 30, 1), h: num(o.h, 0.05, 30, 1), rot: num(o.rot, -360, 360, 0), label: str(o.label, 40) })),
      fixtures: (Array.isArray(l.fixtures) ? l.fixtures : []).slice(0, 60).filter((f) => f && fkinds.includes(f.type)).map((f) => ({ id: str(f.id) || uid('f'), type: f.type, x: num(f.x, -5, 35, 1), y: num(f.y, -5, 35, 1), rot: num(f.rot, -360, 360, 0), label: str(f.label, 40), deviceId: f.deviceId ? str(f.deviceId, 120) : null, state: state(f.state) })),
    };
    const fids = new Set(clean.fixtures.map((f) => f.id));
    clean.arrangements = (Array.isArray(l.arrangements) ? l.arrangements : []).slice(0, 30).map((a) => ({ id: str(a.id) || uid('arr'), name: str(a.name).trim() || 'Arrangement',
      states: Object.fromEntries(Object.entries(a.states || {}).filter(([k]) => fids.has(k)).map(([k, v]) => [k, state(v)])) }));
    const list = this.store.data.layouts, i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    this.store.save(); this._emit(); return clean;
  }
  deleteLayout(id) { this.store.data.layouts = this.store.data.layouts.filter((l) => l.id !== id); this.store.save(); this._emit(); }
  // Send a staged arrangement (or the layout's current staging) to the real lights assigned to its fixtures.
  applyArrangement(layoutId, arrId) {
    const l = this.store.data.layouts.find((x) => x.id === layoutId); if (!l) throw new Error('Layout not found');
    const arr = arrId ? l.arrangements.find((a) => a.id === arrId) : null; if (arrId && !arr) throw new Error('Arrangement not found');
    const map = {};
    for (const f of l.fixtures) { const st = arr ? arr.states[f.id] : f.state; if (f.deviceId && st && this.devices.has(f.deviceId)) map[f.deviceId] = statePatch({ ...st, mode: st.rgb ? 'color' : 'white' }); }
    if (!Object.keys(map).length) throw new Error('No fixture in this layout is linked to a real light yet');
    return this.applyMap(map, `Arrangement: ${arr ? arr.name : l.name}`);
  }

  // ---- schedules ----
  saveSchedule(sc) {
    if (!sc || !/^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time || '')) throw new Error('Pick a time for the schedule');
    const a = sc.action || {}, types = ['scene', 'on', 'off', 'effect', 'stopEffect', 'arrangement'];
    if (!types.includes(a.type)) throw new Error('Pick what the schedule should do');
    const clean = { id: str(sc.id) || uid('sched'), name: str(sc.name).trim() || 'Schedule', enabled: sc.enabled !== false, time: sc.time,
      days: [...new Set((Array.isArray(sc.days) ? sc.days : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter((d) => d >= 0 && d <= 6))],
      action: { type: a.type, sceneId: a.sceneId ? str(a.sceneId) : undefined, mode: a.mode ? str(a.mode, 20) : undefined, layoutId: a.layoutId ? str(a.layoutId) : undefined, arrId: a.arrId ? str(a.arrId) : undefined,
        scope: a.scope && ['all', 'room', 'group'].includes(a.scope.type) ? { type: a.scope.type, id: a.scope.id ? str(a.scope.id) : undefined } : { type: 'all' } },
      lastRun: sc.lastRun ? str(sc.lastRun, 24) : null };
    if (!clean.days.length) throw new Error('Pick at least one day');
    const list = this.store.data.schedules, i = list.findIndex((x) => x.id === clean.id);
    if (i >= 0) list[i] = clean; else list.push(clean);
    this.store.save(); this._emit(); return clean;
  }
  deleteSchedule(id) { this.store.data.schedules = this.store.data.schedules.filter((x) => x.id !== id); this.store.save(); this._emit(); }

  // ---- settings, backup ----
  setSettings(patch) {
    const st = this.store.data.settings; patch = patch || {};
    if (['aero', 'xp-blue', 'xp-silver', 'xp-olive'].includes(patch.theme)) st.theme = patch.theme;
    if (['tiles', 'details'].includes(patch.viewMode)) st.viewMode = patch.viewMode;
    if (Array.isArray(patch.favColors)) st.favColors = patch.favColors.filter(rgbOk).slice(0, 24).map(rgb);
    if (Array.isArray(patch.favPalettes)) st.favPalettes = patch.favPalettes.slice(0, 16).filter((x) => x && Array.isArray(x.colors)).map((x) => ({ name: str(x.name, 30) || 'Palette', colors: x.colors.filter(rgbOk).slice(0, 8).map(rgb) })).filter((x) => x.colors.length);
    if (patch.startup && typeof patch.startup === 'object') st.startup = { ...(st.startup || {}), ...Object.fromEntries(['launchAtLogin', 'startMinimized', 'closeToTray', 'scanOnStart'].filter((k) => k in patch.startup).map((k) => [k, !!patch.startup[k]])) };
    if (patch.toasts !== undefined) st.toasts = !!patch.toasts;
    if (patch.cyncAllowUnverifiedTls !== undefined) st.cyncAllowUnverifiedTls = !!patch.cyncAllowUnverifiedTls;
    if (patch.showOpts && typeof patch.showOpts === 'object') st.showOpts = require('../shared/show-core').normOpts(patch.showOpts); // lightshow generator settings (incl. effect choices)
    if (patch.defaultOn && typeof patch.defaultOn === 'object') st.defaultOn = { brightness: num(patch.defaultOn.brightness, 1, 100, 80), kelvin: num(patch.defaultOn.kelvin, 2200, 6500, 2700), enabled: !!patch.defaultOn.enabled };
    this.store.save(); this._emit(); return st;
  }
  // Everything worth carrying to another PC. Never includes passwords, tokens or account emails.
  exportConfig() {
    const d = this.store.data, { hubspaceEmail, cyncEmail, ...settings } = d.settings;
    return { app: 'lumen', format: 1, exported: new Date().toISOString(), rooms: d.rooms, groups: d.groups, scenes: d.scenes, layouts: d.layouts, schedules: d.schedules, settings,
      devices: Object.fromEntries(Object.entries(d.devices).map(([id, m]) => [id, { name: m.name, room: m.room, caps: m.caps }]).filter(([, m]) => m.name || m.room || m.caps)) };
  }
  importConfig(o) {
    if (!o || o.app !== 'lumen' || o.format !== 1) throw new Error('That file is not a Lumen backup');
    const d = this.store.data, arr = (x) => (Array.isArray(x) ? x : []);
    d.rooms = arr(o.rooms).filter((r) => r && r.id && r.name).map((r) => ({ id: str(r.id), name: str(r.name) }));
    d.groups = arr(o.groups).filter((g) => g && g.id).map((g) => ({ id: str(g.id), name: str(g.name), deviceIds: arr(g.deviceIds).map((x) => str(x, 120)) }));
    d.scenes = arr(o.scenes).filter((sc) => sc && sc.id && sc.devices && typeof sc.devices === 'object').map((sc) => ({ id: str(sc.id), name: str(sc.name), icon: str(sc.icon, 8) || '✨', builtin: false, devices: Object.fromEntries(Object.entries(sc.devices).slice(0, 300).map(([id, e]) => [str(id, 120), cleanEntry(e)])) }));
    d.layouts = []; for (const l of arr(o.layouts)) { try { this.saveLayout(l); } catch {} }
    d.schedules = []; for (const sc of arr(o.schedules)) { try { this.saveSchedule(sc); } catch {} }
    for (const [id, m] of Object.entries(o.devices || {})) { const t = this._meta(str(id, 120)); if (m.name) t.name = str(m.name); if (m.room) t.room = str(m.room); if (m.caps) t.caps = { dim: !!m.caps.dim, color: !!m.caps.color, temp: !!m.caps.temp }; }
    const s = o.settings || {}; this.setSettings(s);
    if (Array.isArray(s.favScenes)) d.settings.favScenes = s.favScenes.map((x) => str(x));
    if (Array.isArray(s.wizIps)) d.settings.wizIps = [...new Set([...(d.settings.wizIps || []), ...s.wizIps.filter((ip) => require('net').isIPv4(String(ip)))])];
    this.store.save(); this._emit();
    return { rooms: d.rooms.length, groups: d.groups.length, scenes: d.scenes.length, layouts: d.layouts.length, schedules: d.schedules.length };
  }
  forgetDevice(id) { this.devices.delete(id); delete this.store.data.devices[id]; this.store.save(); this._emit(); }
}
module.exports = { Manager };
