'use strict';
// Requests for the Lightshow workspace. Shows are JSON files in <data>/shows; analyses are cached in <data>/analysis
// keyed by the audio content, so re-importing a song is instant. Latency profiles and presets live in settings.
const fs = require('fs');
const path = require('path');
const Core = require('../shared/show-core');
const Fx = require('../shared/show-effects');
const { ShowPlayer, measureLatency } = require('./showplayer');

const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'webm', 'mp4'];
const MAX_AUDIO = 400 * 1024 * 1024;
const safeId = (id) => String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

function createShowApi({ manager, store, fx, projLights, platform }) {
  const settings = () => store.data.settings;
  const lat = () => (settings().showLatency && typeof settings().showLatency === 'object' ? settings().showLatency : (settings().showLatency = {}));
  const player = manager.showPlayer = new ShowPlayer({ manager, profiles: lat });
  const dir = (sub) => { const d = path.join(store.dir, sub); fs.mkdirSync(d, { recursive: true }); return d; };
  const readAudio = (p) => {
    if (!p || !AUDIO_EXT.includes(path.extname(p).slice(1).toLowerCase())) throw new Error('That is not a supported audio file (MP3, WAV, FLAC, OGG, M4A/AAC, OPUS).');
    const st = fs.statSync(p); if (st.size > MAX_AUDIO) throw new Error('That audio file is too large (over 400 MB).');
    return { path: p, name: path.basename(p), bytes: fs.readFileSync(p) };
  };
  const stopOthers = async () => { if (fx.active) await fx.stop(); if (projLights.active) await projLights.stop(); };
  const presets = () => (Array.isArray(settings().showPresets) ? settings().showPresets : (settings().showPresets = []));
  // saved custom effects: { name, kind: 'effect', fx, p } or a combination { name, kind: 'combo', clips: [{ fx, t (relative), dur, p, lane? }] }
  const myFx = () => (Array.isArray(settings().showFx) ? settings().showFx : (settings().showFx = []));
  const cleanFx = (x) => {
    const name = String((x && x.name) || '').trim().slice(0, 60); if (!name) throw new Error('Give the effect a name');
    const one = (c) => { const p = Fx.normParams(c && c.fx, c && c.p); if (!p) throw new Error('Unknown effect'); return { fx: c.fx, p }; };
    if (x.kind === 'combo') {
      const clips = (Array.isArray(x.clips) ? x.clips : []).slice(0, 64).map((c) => ({ ...one(c), t: Math.max(0, Math.min(600, +c.t || 0)), dur: Math.max(0.05, Math.min(600, +c.dur || 1)), ...(typeof c.lane === 'string' ? { lane: c.lane.slice(0, 80) } : {}) }));
      if (!clips.length) throw new Error('Select some effects to combine first'); return { name, kind: 'combo', clips };
    }
    return { name, kind: 'effect', ...one(x), dur: Math.max(0.05, Math.min(600, +x.dur || 0)) || undefined };
  };

  return {
    'show:pickAudio': async () => { const p = await platform.openAudio(AUDIO_EXT); return p ? readAudio(p) : null; },
    'show:readAudio': (p) => readAudio(p),
    'show:analysisGet': (key) => { try { return JSON.parse(fs.readFileSync(path.join(dir('analysis'), safeId(key) + '.json'), 'utf8')); } catch { return null; } },
    'show:analysisPut': (key, an) => { if (!an || typeof an !== 'object') return false; fs.writeFileSync(path.join(dir('analysis'), safeId(key) + '.json'), JSON.stringify(an)); return true; },
    'show:list': () => fs.readdirSync(dir('shows')).filter((f) => f.endsWith('.json')).map((f) => { try { const s = JSON.parse(fs.readFileSync(path.join(dir('shows'), f), 'utf8')); return { id: s.id, name: s.name, song: s.audio && s.audio.name, duration: s.analysis && s.analysis.duration, style: s.opts && s.opts.style, savedAt: s.savedAt, events: (s.events || []).length }; } catch { return null; } }).filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)),
    'show:save': (show) => {
      if (!show || !Array.isArray(show.events)) throw new Error('Nothing to save');
      const id = safeId(show.id) || ('s' + Date.now().toString(36));
      const out = { ...show, id, savedAt: Date.now() };
      const tmp = path.join(dir('shows'), id + '.json.tmp'); fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, path.join(dir('shows'), id + '.json'));
      return { id, savedAt: out.savedAt };
    },
    'show:load': (id) => JSON.parse(fs.readFileSync(path.join(dir('shows'), safeId(id) + '.json'), 'utf8')),
    'show:delete': (id) => { try { fs.unlinkSync(path.join(dir('shows'), safeId(id) + '.json')); } catch {} return true; },
    'show:presets': () => presets(),
    'show:presetSave': (name, opts) => { const n = String(name || '').trim().slice(0, 60); if (!n) throw new Error('Give the preset a name'); const list = presets().filter((p) => p.name !== n); list.push({ name: n, opts: Core.normOpts(opts) }); settings().showPresets = list; store.save(); return list; },
    'show:presetDelete': (name) => { settings().showPresets = presets().filter((p) => p.name !== name); store.save(); return settings().showPresets; },
    'show:fxList': () => myFx(),
    'show:fxSave': (x) => { const c = cleanFx(x || {}); const list = myFx().filter((q) => q.name !== c.name); list.push(c); settings().showFx = list; store.save(); return list; },
    'show:fxDelete': (name) => { settings().showFx = myFx().filter((q) => q.name !== name); store.save(); return settings().showFx; },
    'show:plan': (show) => { const p = player.compile(show, 0); return { per: p.per, warnings: p.warnings, cmds: p.cmds.length, preRoll: Math.round(p.preRoll * 1000) }; },
    'show:start': async (o) => { await stopOthers(); return player.start(o || {}); },
    'show:pause': () => player.pause(),
    'show:stop': (o) => player.stop(o || {}),
    'show:sync': (pos, wall) => { player.sync(pos, wall); return player.state; },
    'show:status': () => player.status(),
    'latency:get': () => {
      const L = lat();
      return [...manager.devices.values()].map((d) => { const p = L[d.id] || {}, iv = Core.intervalOf({ brand: d.brand }, p); return { id: d.id, name: manager._meta(d.id).name || d.name, brand: d.brand, online: d.online !== false, ms: p.ms != null ? p.ms : null, def: Core.DEFAULT_LATENCY[d.brand] || 300, offset: p.offset || 0, interval: iv, speed: Core.speedClass(iv), enabled: p.enabled !== false, source: p.source || 'default', rtt: p.rtt || null, rel: p.rel != null ? p.rel : null, at: p.at || null }; });
    },
    'latency:set': (id, patch) => {
      if (!manager.devices.has(id)) throw new Error('Unknown light');
      const cur = lat()[id] || {}, n = { ...cur };
      if (patch.offset !== undefined) n.offset = Math.max(-2000, Math.min(2000, Math.round(+patch.offset || 0)));
      if (patch.ms !== undefined) { if (patch.ms === null) { delete n.ms; delete n.source; } else { n.ms = Math.max(0, Math.min(5000, Math.round(+patch.ms || 0))); n.source = 'manual'; } }
      if (patch.enabled !== undefined) n.enabled = !!patch.enabled;
      if (patch.interval !== undefined) { if (patch.interval === null) delete n.interval; else n.interval = Math.max(40, Math.min(10000, Math.round(+patch.interval || 0))); }
      lat()[id] = n; store.save(); return n;
    },
    'latency:measure': async (ids) => {
      if (player.state === 'playing') throw new Error('Stop the show before measuring');
      const list = (Array.isArray(ids) && ids.length ? ids : [...manager.devices.keys()]).filter((id) => manager.devices.has(id) && manager.devices.get(id).online !== false);
      const res = await measureLatency(manager, list);
      for (const [id, r] of Object.entries(res)) { const rel = r.n !== undefined ? r.n / (r.n + (r.errors || 0)) : r.ok ? 1 : 0; lat()[id] = { ...(lat()[id] || {}), ...(r.ok ? { ms: r.ms, rtt: r.rtt, source: 'measured' } : {}), rel: Math.round(rel * 100) / 100, at: Date.now() }; }
      store.save(); return res;
    },
  };
}
module.exports = { createShowApi, AUDIO_EXT };
