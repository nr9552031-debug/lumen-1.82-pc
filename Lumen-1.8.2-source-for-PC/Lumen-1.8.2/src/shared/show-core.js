'use strict';
// Lightshow core: turns an analysis into an editable list of lighting events (generate), and turns events into the exact
// per-bulb command schedule, with each bulb's latency and command-rate limit taken into account (compile).
// Pure functions: no timers, no network. The player (main process) only executes what compile() produces.
//
// Event: { id, t, dur, lane, type, rgb:[r,g,b], bri:0-100, rgb2?, bri2?, fade?, hz?, devs?:[ids], pri?:1-3 }
//   base types   color | ambient : go to (rgb,bri) over `fade` s, then (if rgb2/bri2) drift to them by t+dur
//   overlay types flash | pulse | strobe | blackout : a short effect on top of the base, which it returns to
//   1.6 optional fields: pulse lo (trough brightness) + curve:'sine'; flash hold:1 (constant colour, no decay); fx (id of
//   the effect clip that produced the event - see show-effects.js). Older shows have none of these and play unchanged.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LumenShow = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const WHITE = [255, 255, 255];
  const rng = (seed) => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  function hsv(rgb) { const [r, g, b] = rgb.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return [h, mx ? d / mx : 0, mx]; }
  function rgbOf([h, s, v]) { h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round); }

  // ---------- palettes and styles ----------
  const PALETTES = {
    Neon: [[255, 0, 200], [0, 230, 255], [130, 60, 255], [255, 230, 0], [0, 255, 120]], Sunset: [[255, 94, 58], [255, 149, 0], [255, 45, 120], [160, 40, 200], [255, 210, 100]],
    Ocean: [[0, 90, 255], [0, 200, 255], [0, 255, 200], [90, 60, 255], [200, 240, 255]], Fire: [[255, 30, 0], [255, 120, 0], [255, 200, 0], [255, 60, 60], [255, 255, 200]],
    Forest: [[0, 200, 60], [120, 255, 0], [0, 150, 110], [255, 220, 60], [200, 255, 200]], Pastel: [[255, 150, 200], [150, 200, 255], [200, 255, 190], [255, 230, 150], [210, 170, 255]],
    Reggae: [[0, 170, 60], [255, 200, 0], [230, 30, 30], [0, 120, 40], [255, 150, 0]], Ice: [[200, 235, 255], [100, 170, 255], [170, 120, 255], [60, 220, 255], [255, 255, 255]],
    Warm: [[255, 140, 40], [255, 190, 110], [255, 90, 30], [255, 220, 160], [200, 60, 20]], 'Purple & Gold': [[150, 40, 255], [255, 190, 30], [0, 200, 200], [255, 60, 150], [70, 60, 200]],
    Cinema: [[10, 40, 160], [255, 150, 40], [0, 140, 170], [120, 20, 40], [230, 240, 255]], Rock: [[255, 30, 30], [255, 255, 255], [255, 140, 0], [40, 90, 255], [255, 0, 100]],
    // high-contrast ("polarizing") palettes: two tight hue groups on opposite sides of the colour wheel, strongest pair first
    // (every pair the director can pick is >=150 deg apart, except Red vs Blue ~130-140 and Opposites, which mixes axes, >=120)
    'Red vs Blue': [[255, 0, 0], [0, 85, 255], [255, 0, 43], [0, 108, 217], [204, 17, 0]],
    'Fire & Ice': [[255, 64, 0], [0, 191, 255], [255, 0, 0], [0, 128, 255], [255, 128, 0]],
    Cyberpunk: [[255, 0, 128], [0, 255, 213], [255, 0, 106], [0, 255, 191], [217, 0, 126]],
    Toxic: [[128, 255, 0], [149, 0, 255], [85, 255, 0], [191, 0, 255], [170, 255, 0]],
    Hazard: [[255, 213, 0], [0, 21, 255], [255, 170, 0], [0, 64, 255], [255, 234, 0]],
    'Blood Moon': [[255, 0, 21], [0, 255, 213], [191, 16, 0], [0, 255, 255], [255, 0, 64]],
    Opposites: [[255, 0, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [0, 0, 255], [255, 255, 0]],
  };
  const POLAR = ['Red vs Blue', 'Fire & Ice', 'Cyberpunk', 'Toxic', 'Hazard', 'Blood Moon', 'Opposites'];
  // beat: which hits drive the beat layer; contrast: how far beats dip below peak; fade: seconds multiplier for transitions;
  // decay: flash length (beats); hard: no soft transitions; echo: dub-style repeats; strobe/black: drop treatment; sparkle: hat sparkles
  const STYLES = {
    party: { name: 'Party', pal: 'Neon', beat: 'every', contrast: 0.7, fade: 1, decay: 0.8, drift: 2, strobe: 1, black: 0.4, sparkle: 0.5, chase: 0.7, echo: 0, hard: 0, cap: 'pulse' },
    edm: { name: 'EDM', pal: 'Neon', beat: 'kick', contrast: 0.95, fade: 0.6, decay: 0.55, drift: 4, strobe: 1, black: 1, sparkle: 0.7, chase: 0.8, echo: 0, hard: 0.6, cap: 'flash' },
    reggae: { name: 'Reggae / Dub', pal: 'Reggae', beat: 'offbeat', contrast: 0.45, fade: 1.8, decay: 1.2, drift: 4, strobe: 0, black: 0, sparkle: 0, chase: 0.1, echo: 1, hard: 0, cap: 'pulse' },
    chill: { name: 'Chill / Ambient', pal: 'Ocean', beat: 'down', contrast: 0.25, fade: 3.5, decay: 2.2, drift: 4, strobe: 0, black: 0, sparkle: 0, chase: 0, echo: 0, hard: 0, cap: 'pulse' },
    rock: { name: 'Rock', pal: 'Rock', beat: 'snare', contrast: 0.9, fade: 0.3, decay: 0.5, drift: 8, strobe: 0.6, black: 0.5, sparkle: 0.2, chase: 0.3, echo: 0, hard: 1, cap: 'flash' },
    hiphop: { name: 'Hip-Hop', pal: 'Purple & Gold', beat: 'kicksnare', contrast: 0.75, fade: 0.9, decay: 0.8, drift: 4, strobe: 0.2, black: 0.3, sparkle: 0.6, chase: 0.3, echo: 0, hard: 0.3, cap: 'pulse' },
    cinematic: { name: 'Cinematic', pal: 'Cinema', beat: 'down', contrast: 0.5, fade: 4.5, decay: 3, drift: 8, strobe: 0, black: 0.8, sparkle: 0, chase: 0, echo: 0, hard: 0, cap: 'pulse', swell: 1 },
    random: { name: 'Random Creative', pal: null, beat: null, contrast: 0.7, fade: 1, decay: 1, drift: 2, strobe: 0.5, black: 0.5, sparkle: 0.5, chase: 0.5, echo: 0, hard: 0.3, cap: 'pulse' },
  };
  // throwRate: how often colour is thrown across the room (0 = never, 1 = constantly; default occasional). dropFx: what drops do.
  // fx: { <effect>: { w: 0..3 weight (0 = never), trig: ['beat','bass','vocal','transition','random'] } } - see show-effects.js
  const DEFAULTS = { style: 'party', intensity: 0.7, complexity: 0.6, brightness: 0.9, speed: 1, randomness: 0.35, sync: 0.8, palette: '', seed: 1, throwRate: 0.15, throwDir: 'auto', throwWho: 'all', dropFx: 'auto', mode: 'auto' };
  const FX_KEYS = ['flash', 'strobe', 'blackout', 'pulse', 'heartbeat', 'explosion', 'snap', 'wash', 'flicker', 'wave', 'throw', 'chase', 'alternate', 'build', 'ambient'], TRIGS = ['beat', 'bass', 'vocal', 'transition', 'random'];
  const normOpts = (o) => { const d = { ...DEFAULTS, ...(o || {}) }; d.intensity = clamp(+d.intensity, 0, 1); d.complexity = clamp(+d.complexity, 0, 1); d.brightness = clamp(+d.brightness, 0.1, 1); d.speed = clamp(+d.speed, 0.25, 4); d.randomness = clamp(+d.randomness, 0, 1); d.sync = clamp(+d.sync, 0, 1); d.seed = (+d.seed || 1) >>> 0; if (!STYLES[d.style]) d.style = 'party';
    d.throwRate = clamp(+d.throwRate, 0, 1); if (!Number.isFinite(d.throwRate)) d.throwRate = DEFAULTS.throwRate;
    if (!['auto', 'lr', 'rl', 'tb', 'bt', 'out', 'in', 'd1', 'd2'].includes(d.throwDir)) d.throwDir = 'auto';
    if (!['all', 'fast', 'fastmed', 'slow'].includes(d.throwWho)) d.throwWho = 'all';
    if (!['auto', 'explosion', 'blackout', 'snap', 'strobe'].includes(d.dropFx)) d.dropFx = 'auto';
    if (!['auto', 'manual'].includes(d.mode)) d.mode = 'auto';
    if (d.fx && typeof d.fx === 'object') { const f = {}; for (const k of FX_KEYS) { const u = d.fx[k]; if (!u || typeof u !== 'object') continue; f[k] = { w: clamp(+u.w, 0, 3) || 0, ...(Array.isArray(u.trig) ? { trig: u.trig.filter((x) => TRIGS.includes(x)) } : {}) }; } d.fx = f; } else delete d.fx;
    return d; };

  // ---------- bulb speed classes ----------
  const RATE = { wiz: 90, cync: 500, hubspace: 2500 };
  const DEFAULT_LATENCY = { wiz: 40, cync: 450, hubspace: 1600 }; // ms from command to visible change. ESTIMATES until measured.
  const speedClass = (interval) => interval <= 150 ? 'fast' : interval <= 700 ? 'medium' : 'slow';
  const intervalOf = (info, prof) => Math.max(40, (prof && prof.interval) || (info && info.interval) || RATE[info && info.brand] || 500);
  const latencyOf = (info, prof) => Math.max(0, ((prof && prof.ms != null ? prof.ms : DEFAULT_LATENCY[info && info.brand]) || 300) + ((prof && prof.offset) || 0));

  // ---------- generation ----------
  // Roles: fast bulbs (WiZ) LEAD - every beat, fill, strobe and spatial move; medium bulbs (Cync) FOLLOW on bars and
  // big hits; slow bulbs (Hubspace) carry AMBIENT colour that changes on phrases, drops and sections only.
  // Colour: a "director" picks strongly contrasting colour PAIRS (red/blue, purple/lime, cyan/orange...); hits
  // alternate between the two, the ambient layer sits on the partner colour, and pairs change on phrases and sections.
  const sat = (c, s = 1) => { const [h, , v] = hsv(c); return rgbOf([h, s, v > 0.2 ? 1 : v]); };
  const hueDist = (a, b) => { const d = Math.abs(hsv(a)[0] - hsv(b)[0]) % 360; return d > 180 ? 360 - d : d; };
  const CONTRAST = [[[255, 0, 0], [0, 80, 255]], [[150, 0, 255], [140, 255, 0]], [[0, 230, 255], [255, 110, 0]], [[255, 0, 180], [0, 255, 70]], [[255, 220, 0], [110, 0, 255]], [[255, 30, 90], [0, 210, 190]]];
  function colourPairs(pal, s) {
    const cols = pal.map((c) => sat(c, s)), out = [];
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) if (hueDist(cols[i], cols[j]) >= 110) out.push([cols[i], cols[j]]);
    if (out.length < 3) for (const c of cols) { const [h] = hsv(c); out.push([c, rgbOf([h + 180, s, 1])]); } // too few contrasts: use complements
    out.sort((a, b) => hueDist(b[0], b[1]) - hueDist(a[0], a[1]));
    return out.slice(0, 8);
  }
  // no room drawn: bulbs are assumed to sit around the edge of the room, in order
  const autoPos = (i, n) => (n < 2 ? { x: 0.5, y: 0.5 } : { x: 0.5 + 0.4 * Math.cos(Math.PI * (1.25 + 2 * i / n)), y: 0.5 + 0.4 * Math.sin(Math.PI * (1.25 + 2 * i / n)) });
  // generate(): kept for compatibility (tests, older callers). The show is now built by the effect director in
  // show-effects.js as base colours + effect clips; this returns them expanded into one flat list of events.
  const Fx = () => (typeof module === 'object' && module.exports ? require('./show-effects') : self.LumenFx);
  function generate(an, optsIn, lanesIn, devInfo, range) {
    const F = Fx(), g = F.generateShow(an, optsIn, lanesIn, devInfo, range);
    const out = F.materialize({ events: g.events, clips: g.clips, lanes: lanesIn }, an, devInfo).events;
    return range ? out.filter((e) => e.t >= range[0] && e.t < range[1]) : out;
  }

  // ---------- evaluating events as a light's colour/brightness (used by the editor's automation view and by compile) ----------
  const isOverlay = (t) => t === 'flash' || t === 'pulse' || t === 'strobe' || t === 'blackout';
  function stateFn(evs) {
    const baseEvs = evs.filter((e) => !isOverlay(e.type)).sort((a, b) => a.t - b.t), over = evs.filter((e) => isOverlay(e.type)).sort((a, b) => a.t - b.t);
    const segs = []; let prev = { rgb: [255, 255, 255], bri: 0 };
    const stateAtSeg = (t) => { for (let i = segs.length - 1; i >= 0; i--) { const s = segs[i]; if (t >= s.t0) return t >= s.t1 || s.t1 <= s.t0 ? s.to : { rgb: lerpRgb(s.from.rgb, s.to.rgb, (t - s.t0) / (s.t1 - s.t0)), bri: lerp(s.from.bri, s.to.bri, (t - s.t0) / (s.t1 - s.t0)) }; } return { rgb: [255, 255, 255], bri: 0 }; };
    for (const e of baseEvs) {
      const from = segs.length ? stateAtSeg(e.t) : prev, to = { rgb: e.rgb || from.rgb, bri: e.bri != null ? e.bri : from.bri }, f = Math.max(0, e.fade || 0);
      segs.push({ t0: e.t, t1: e.t + f, from, to });
      if ((e.rgb2 || e.bri2 != null) && e.dur > f) segs.push({ t0: e.t + f + 1e-6, t1: e.t + e.dur, from: to, to: { rgb: e.rgb2 || to.rgb, bri: e.bri2 != null ? e.bri2 : to.bri } });
    }
    const overVal = (o, t) => {
      const x = (t - o.t) / Math.max(o.dur, 0.001); if (x < 0 || x >= 1) return null; const b = stateAtSeg(t);
      if (o.type === 'blackout') return { rgb: b.rgb, bri: 0 };
      if (o.type === 'strobe') { const per = 1 / (o.hz || 6), ph = ((t - o.t) / per) % 1; return ph < 0.5 ? { rgb: o.rgb, bri: o.bri } : { rgb: b.rgb, bri: 0 }; }
      if (o.type === 'pulse') {
        const up = 0.2, k = o.curve === 'sine' ? Math.sin(Math.PI * x) : x < up ? x / up : 1 - (x - up) / (1 - up);
        if (o.lo != null) return { rgb: o.rgb, bri: lerp(o.lo, o.bri, clamp(k, 0, 1)) }; // pulse between its own trough and peak
        return { rgb: lerpRgb(b.rgb, o.rgb, clamp(k * 1.4, 0, 1)), bri: lerp(b.bri, o.bri, clamp(k, 0, 1)) };
      }
      if (o.hold) return { rgb: o.rgb, bri: o.bri }; // held colour (snaps, chases, alternation), then straight back to the base
      return { rgb: lerpRgb(o.rgb, b.rgb, x * x), bri: lerp(o.bri, b.bri, x) }; // flash: hit, then decay back to the base
    };
    const at = (t) => { for (let i = over.length - 1; i >= 0; i--) { if (over[i].t > t) continue; const v = overVal(over[i], t); if (v) return v; if (over[i].t + over[i].dur < t - 30) break; } return stateAtSeg(t); };
    return { at, baseEvs, over, segs };
  }

  // ---------- compile: events -> per-bulb command schedule ----------
  // devInfo: { id: { brand, name, caps, interval?, online?, enabled? } }   profiles: { id: { ms, offset, interval, enabled } }
  function compile(show, devInfo, profiles, opts = {}) {
    const lanes = show.lanes || [], events = show.events || [], from = opts.from || 0, warnings = [], per = {}, cmds = [];
    const allIds = [...new Set(lanes.flatMap((l) => l.deviceIds))];
    const laneDevs = (lid) => lid === '*' ? allIds : ((lanes.find((l) => l.id === lid) || {}).deviceIds || []);
    const byDev = new Map();
    for (const e of events) { const ids = e.devs && e.devs.length ? e.devs : laneDevs(e.lane); for (const id of ids) { if (!byDev.has(id)) byDev.set(id, []); byDev.get(id).push(e); } }
    for (const id of allIds) {
      const info = devInfo[id], prof = (profiles || {})[id] || {}, name = info ? info.name : id;
      if (!info) { warnings.push(`${id} is no longer connected and was skipped.`); continue; }
      if (prof.enabled === false) { warnings.push(`${name} is switched off for shows.`); continue; }
      if (info.online === false) { warnings.push(`${name} is offline and was skipped.`); continue; }
      const evs = byDev.get(id) || [], interval = intervalOf(info, prof), lat = latencyOf(info, prof), gap = Math.max(interval, 60) / 1000;
      const st = stateFn(evs), stepS = Math.max(0.11, interval * 1.25 / 1000);
      const ticks = []; const tk = (t, pri) => ticks.push({ t: Math.max(0, t), pri });
      for (const s of st.segs) { const f = s.t1 - s.t0; if (f <= 0.001) tk(s.t0, 2); else { const n = clamp(Math.round(f / stepS), 1, 80); for (let k = 0; k <= n; k++) tk(s.t0 + k * f / n, 2); } }
      for (const o of st.over) {
        if (o.type === 'strobe') { const half = 0.5 / (o.hz || 6), n = Math.floor(o.dur / half); for (let k = 0; k <= n; k++) tk(o.t + k * half + 0.0005, o.pri || 2); tk(o.t + o.dur, o.pri || 2); continue; }
        const pk = o.curve === 'sine' ? 0.5 : 0.2;
        tk(o.t, o.pri || 1); if (o.type === 'pulse') tk(o.t + o.dur * pk, o.pri || 1);
        const d = o.dur * (o.type === 'pulse' ? 1 - pk : 1), step = Math.max(stepS, 0.14), n = o.hold ? 0 : clamp(Math.floor(d / step), 0, 12);
        for (let k = 1; k <= n; k++) tk(o.t + (o.type === 'pulse' ? o.dur * pk : 0) + k * d / (n + 1), (o.pri || 1) - 1);
        tk(o.t + o.dur + 0.001, (o.pri || 1) - 1);
      }
      ticks.sort((a, b) => a.t - b.t);
      // rate limiting: never closer than the bulb's minimum command interval; the more important command wins
      const kept = []; let dropped = 0;
      for (const k of ticks) { const last = kept[kept.length - 1]; if (last && k.t - last.t < gap) { if (k.pri >= last.pri) { kept[kept.length - 1] = k; } dropped++; continue; } kept.push(k); }
      // settle pass: if a command was dropped, make sure the bulb still ends up in the right state once it is allowed to move again
      const same = (a, b) => (a.off === b.off) && Math.abs(a.bri - b.bri) < 4 && a.rgb.every((c, i) => Math.abs(c - b.rgb[i]) < 10);
      const final = [], mk = (t) => { const s = st.at(t); return { rgb: s.rgb.map(Math.round), bri: Math.round(s.bri), off: s.bri < 2 }; };
      for (let i = 0; i < kept.length; i++) {
        final.push({ ...kept[i], ...mk(kept[i].t) });
        const nextT = i + 1 < kept.length ? kept[i + 1].t : Infinity, tt = kept[i].t + gap * 1.02;
        if (tt < nextT - gap * 1.01) { const cur = final[final.length - 1], want = mk(tt); if (!same(cur, want)) final.push({ t: tt, pri: 0, ...want }); }
      }
      // drop commands that would not visibly change anything
      let prev = null, n = 0, late = 0;
      for (const c of final) { if (prev && same(prev, c)) continue; prev = c; if (from > 0 && c.t < from + 1e-6) continue; n++; cmds.push({ id, at: +(c.t - lat / 1000).toFixed(4), t: +c.t.toFixed(4), rgb: c.rgb, bri: c.bri, off: c.off, pri: c.pri }); }
      // a bulb must be in the right state when we start somewhere in the middle of the song: send what was in effect
      if (from > 0) { const w = mk(from); cmds.push({ id, at: +(from - lat / 1000).toFixed(4), t: from, rgb: w.rgb, bri: w.bri, off: w.off, pri: 3, catchup: true }); n++; }
      void late;
      per[id] = { name, brand: info.brand, planned: ticks.length, sent: n, dropped, latency: Math.round(lat), interval, speed: speedClass(interval), events: evs.length, source: prof.ms != null ? (prof.source || 'measured') : 'default estimate' };
      if (speedClass(interval) === 'slow') warnings.push(`${name}: this bulb can only take a command every ${(interval / 1000).toFixed(1)} s, so it follows sections and drops, not beats.`);
      else if (ticks.length && dropped / ticks.length > 0.5) warnings.push(`${name}: ${Math.round(100 * dropped / ticks.length)}% of planned changes were skipped to stay within what this bulb can handle.`);
    }
    cmds.sort((a, b) => a.at - b.at || (a.id > b.id ? 1 : -1));
    const minAt = cmds.length ? cmds[0].at : 0, endT = Math.max(0, ...cmds.map((c) => c.t));
    return { cmds, per, warnings, preRoll: Math.max(0, -minAt), endT };
  }

  const autoLanes = (ids, devInfo) => { // no groups/rooms: spread bulbs over up to three alternating lanes, fast bulbs first
    const live = ids.filter((id) => devInfo[id] && devInfo[id].online !== false && devInfo[id].enabled !== false), n = live.length >= 6 ? 3 : live.length >= 2 ? 2 : 1;
    const lanes = Array.from({ length: n }, (_, i) => ({ id: 'lane' + (i + 1), name: 'Lane ' + 'ABC'[i], deviceIds: [] }));
    live.forEach((id, i) => lanes[i % n].deviceIds.push(id)); return lanes.filter((l) => l.deviceIds.length);
  };
  return { autoPos, generate, compile, stateFn, autoLanes, normOpts, PALETTES, POLAR, STYLES, DEFAULTS, RATE, DEFAULT_LATENCY, speedClass, intervalOf, latencyOf, lerpRgb, isOverlay, rng, hsv, rgbOf, colourPairs, CONTRAST, FX_KEYS };
});
