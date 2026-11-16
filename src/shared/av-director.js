/* Lumen autonomous projection director (1.7). Decides WHAT to show and WHEN to change, from the music features
   (av-features.js). It never draws anything and never talks to devices: it returns decisions with a target time,
   and the page schedules them (projector early by its display delay, bulbs early by their own latency).

   createDirector({ personality, settings, seed }) -> director
     update(F, nowMs, ctx) -> decision | null      ctx: { predict(t, 'beat'|'bar'|'phrase') -> ms|null, lead: ms }
       decision = { at, preset, others[], hue, speed, react, bright, fade (s), light: {fx, colors}|null, reason, section }
     state() -> { current, since, next, history, section, energy, personality }
     set({ personality?, settings? }) · override(presetId|null) · reset()

   Personalities are data (PERSONALITIES below): tag preferences, energy limits, scene lengths, fade lengths,
   what a drop does, colour behaviour. Animations are described by CATALOGUE (energy range + character tags), so
   no personality knowledge lives inside the animations themselves. */
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // e: comfortable energy range 0..1 · tags: character · w: weight (heavier shaders are picked a little less)
  const CATALOGUE = {
    galaxy: { e: [0.15, 0.75], tags: ['cosmic', 'organic', 'cool'] }, stars: { e: [0, 0.45], tags: ['cosmic', 'calm', 'particles'] },
    nebula: { e: [0.1, 0.7], tags: ['cosmic', 'fluid', 'organic'] }, aurora: { e: [0, 0.55], tags: ['nature', 'calm', 'fluid', 'cool'] },
    warp: { e: [0.55, 1], tags: ['cosmic', 'speed', 'geometric'] }, fire: { e: [0.3, 0.9], tags: ['nature', 'warm', 'organic'] },
    smoke: { e: [0, 0.5], tags: ['calm', 'fluid', 'organic'] }, clouds: { e: [0, 0.4], tags: ['nature', 'calm'] },
    ocean: { e: [0.05, 0.6], tags: ['nature', 'fluid', 'cool'] }, waves: { e: [0.2, 0.8], tags: ['fluid', 'pulse'] },
    portal: { e: [0.45, 1], tags: ['cosmic', 'geometric', 'pulse'] }, energy: { e: [0.5, 1], tags: ['geometric', 'pulse', 'cool'] },
    lightning: { e: [0.6, 1], tags: ['nature', 'strobe'] }, magic: { e: [0.3, 0.85], tags: ['particles', 'organic'] },
    particles: { e: [0.4, 1], tags: ['particles', 'speed'] }, plasma: { e: [0.3, 0.9], tags: ['psychedelic', 'fluid'] },
    fractal: { e: [0.2, 0.8], tags: ['psychedelic', 'geometric'], w: 0.8 }, kaleido: { e: [0.35, 1], tags: ['psychedelic', 'geometric'] },
    tunnel: { e: [0.55, 1], tags: ['geometric', 'speed', 'pulse'] }, gradient: { e: [0, 0.35], tags: ['calm'] },
    glow: { e: [0, 0.4], tags: ['calm', 'warm'] }, flow: { e: [0.1, 0.7], tags: ['fluid', 'organic', 'psychedelic'], w: 0.85 },
    lava: { e: [0.15, 0.75], tags: ['fluid', 'organic', 'warm', 'psychedelic'] }, ink: { e: [0.2, 0.85], tags: ['fluid', 'organic', 'psychedelic'], w: 0.85 },
    bokeh: { e: [0, 0.5], tags: ['calm', 'particles'], w: 0.85 }, fireflies: { e: [0, 0.5], tags: ['nature', 'calm', 'particles'] },
    rays: { e: [0.05, 0.6], tags: ['nature', 'fluid', 'cool'] }, rain: { e: [0.1, 0.6], tags: ['nature', 'calm'] },
    snow: { e: [0, 0.5], tags: ['nature', 'calm', 'particles'] }, sunset: { e: [0, 0.45], tags: ['nature', 'calm', 'warm'] },
    synth: { e: [0.5, 1], tags: ['geometric', 'speed', 'retro'] }, rings: { e: [0.4, 1], tags: ['geometric', 'pulse'] },
    laser: { e: [0.6, 1], tags: ['laser', 'geometric', 'strobe'] }, disco: { e: [0.55, 1], tags: ['particles', 'pulse', 'party'] },
    hex: { e: [0.45, 1], tags: ['geometric', 'pulse'] },
  };
  // scene lengths in bars; fade in beats; react/bright are multipliers; hue: how colour moves
  const PERSONALITIES = {
    ambient: { name: 'Ambient', tags: { calm: 2.2, nature: 1.6, fluid: 1.4, organic: 1.2, cosmic: 1, warm: 0.8, strobe: 0.05, laser: 0.05, speed: 0.2, pulse: 0.4, geometric: 0.4, party: 0.1 },
      energyCap: 0.55, minBars: 16, maxBars: 40, fadeBeats: 8, react: 0.55, bright: 0.85, sync: 'phrase', drop: 'swell', hue: 'drift', hueRate: 2, speed: 0.75, light: { change: 'wash', drop: 'wash', beat: false } },
    psychedelic: { name: 'Psychedelic', tags: { psychedelic: 2.4, fluid: 1.8, organic: 1.5, particles: 1.1, cosmic: 1.1, geometric: 0.7, calm: 0.5, strobe: 0.3 },
      energyCap: 0.9, minBars: 8, maxBars: 24, fadeBeats: 6, react: 1.1, bright: 1, sync: 'phrase', drop: 'change', hue: 'unusual', hueRate: 9, speed: 1.05, light: { change: 'wash', drop: 'snap', beat: true } },
    electronic: { name: 'Electronic', tags: { geometric: 2.2, pulse: 2, laser: 1.8, speed: 1.4, retro: 1.2, strobe: 1, particles: 0.9, calm: 0.2, nature: 0.3 },
      energyCap: 1, minBars: 4, maxBars: 16, fadeBeats: 1, react: 1.3, bright: 1, sync: 'bar', drop: 'change', hue: 'palette', hueRate: 0, speed: 1.1, light: { change: 'flash', drop: 'explosion', beat: true } },
    cinematic: { name: 'Cinematic', tags: { cosmic: 2, nature: 1.6, fluid: 1.4, organic: 1.2, calm: 1, warm: 1, geometric: 0.6, strobe: 0.3, party: 0.1 },
      energyCap: 0.85, minBars: 16, maxBars: 48, fadeBeats: 12, react: 0.8, bright: 0.95, sync: 'phrase', drop: 'change', hue: 'drift', hueRate: 1, speed: 0.85, light: { change: 'wash', drop: 'explosion', beat: false } },
    party: { name: 'Party', tags: { party: 2, pulse: 2, particles: 1.6, strobe: 1.5, laser: 1.5, speed: 1.4, geometric: 1.2, psychedelic: 1, calm: 0.15 },
      energyCap: 1, minBars: 4, maxBars: 12, fadeBeats: 0.5, react: 1.5, bright: 1.05, sync: 'bar', drop: 'change', hue: 'contrast', hueRate: 0, speed: 1.15, light: { change: 'snap', drop: 'explosion', beat: true } },
  };
  const SECTION_INTENSITY = { silence: 0.3, break: 0.4, quiet: 0.5, groove: 0.75, build: 0.8, peak: 0.95, drop: 1 };
  const PALETTE_HUES = [0, 40, 120, 180, 210, 270, 320];
  const DEFAULTS = { intensity: 0.75, change: 0.5, variety: 0.6, react: 1, colour: 'auto', beatSync: true, lightSync: true, exclude: [] };
  function normSettings(s) {
    s = Object.assign({}, DEFAULTS, s || {});
    const n = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
    return { intensity: n(s.intensity, 0, 1, 0.75), change: n(s.change, 0, 1, 0.5), variety: n(s.variety, 0, 1, 0.6), react: n(s.react, 0, 2, 1),
      colour: ['auto', 'follow', 'drift', 'palette', 'contrast'].includes(s.colour) ? s.colour : 'auto', beatSync: s.beatSync !== false, lightSync: s.lightSync !== false,
      exclude: (Array.isArray(s.exclude) ? s.exclude : []).filter((x) => CATALOGUE[x]).slice(0, 40) };
  }
  function rngOf(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const shared = (a, b) => { const A = CATALOGUE[a].tags, B = CATALOGUE[b].tags; let n = 0; for (const t of A) if (B.includes(t)) n++; return n; };

  function createDirector(o) {
    o = o || {};
    let P = PERSONALITIES[o.personality] || PERSONALITIES.ambient, pKey = PERSONALITIES[o.personality] ? o.personality : 'ambient', S = normSettings(o.settings), R = rngOf(o.seed || 7);
    let current = o.start && CATALOGUE[o.start] ? o.start : null, since = -1e12, pending = null, history = [], sectionNow = 'silence', sectionSince = 0, sceneSection = 'silence';
    let eS = 0, hueBase = R() * 360, hueScene = 0, lastPick = 0, overrideId = null, forced = false;
    const barMs = (F) => (F && F.bpm > 40 ? 4 * 60000 / F.bpm : 2000);
    function score(id, energy, at) {
      const c = CATALOGUE[id]; let w = c.w || 1;
      let tw = 0; for (const t of c.tags) tw += P.tags[t] == null ? 0.5 : P.tags[t]; w *= tw / c.tags.length;
      const e = Math.min(energy, P.energyCap), out = e < c.e[0] ? c.e[0] - e : e > c.e[1] ? e - c.e[1] : 0; w *= Math.exp(-out * out * 30);
      if (current && current !== id) w *= 0.6 + 0.25 * Math.min(2, shared(current, id)); // flows better from similar scenes
      // memory: the more recently an animation was used, the less likely it is to come back (variety stretches it)
      const memory = Math.round(lerp(3, 12, S.variety));
      for (let i = history.length - 1, k = 0; i >= 0 && k < memory; i--, k++) if (history[i].id === id) { w *= lerp(0.02, 0.4, k / memory); break; }
      if (id === current) w *= 0.01;
      void at; return w;
    }
    function pick(energy, at) {
      const ids = Object.keys(CATALOGUE).filter((k) => !S.exclude.includes(k)); if (!ids.length) return current || 'gradient';
      const ws = ids.map((k) => Math.pow(score(k, energy, at), lerp(1.6, 0.8, S.variety)));
      const tot = ws.reduce((a, b) => a + b, 0); let r = R() * tot;
      for (let i = 0; i < ids.length; i++) { r -= ws[i]; if (r <= 0) return ids[i]; }
      return ids[ids.length - 1];
    }
    function others(main) { // animations for the other shapes: same character, not the main one, not recently used
      const ids = Object.keys(CATALOGUE).filter((k) => k !== main && !S.exclude.includes(k));
      ids.sort((a, b) => shared(main, b) - shared(main, a) || (R() - 0.5));
      return ids.slice(0, 4);
    }
    function colourFor(reason, t) {
      const mode = S.colour === 'auto' ? P.hue : S.colour;
      if (mode === 'follow') return 0;
      if (mode === 'drift' || mode === 'unusual') { hueScene = (hueScene + (mode === 'unusual' ? 90 + R() * 120 : 20 + R() * 30)) % 360; return hueScene; }
      if (mode === 'palette') { hueScene = PALETTE_HUES[Math.floor(R() * PALETTE_HUES.length)]; return hueScene; }
      hueScene = (hueScene + (reason === 'drop' ? 180 : 120 + R() * 60)) % 360; void t; return hueScene; // contrast
    }
    // when should a change be SEEN: on the next phrase / bar / beat that is far enough ahead for every output
    function boundary(F, now, ctx, kind) {
      const lead = (ctx && ctx.lead) || 0, earliest = now + lead + 30, pr = ctx && ctx.predict;
      if (!S.beatSync || !pr) return earliest;
      const order = kind === 'phrase' ? ['phrase', 'bar', 'beat'] : kind === 'bar' ? ['bar', 'beat'] : ['beat'];
      for (const k of order) {
        let at = pr(earliest, k); if (at == null) continue;
        const limit = k === 'phrase' ? barMs(F) * 4.2 : k === 'bar' ? barMs(F) * 1.05 : barMs(F);
        if (at - earliest <= limit) return at;
      }
      return earliest;
    }
    function update(F, now, ctx) {
      if (!F) return null;
      if (pending && now >= pending.at) { // the planned change has become visible
        history.push({ id: pending.preset, at: pending.at, reason: pending.reason }); if (history.length > 40) history.shift();
        current = pending.preset; since = pending.at; sceneSection = pending.section; pending = null;
      }
      eS += ((F.silent ? 0 : F.energy) - eS) * 0.08;
      if (F.section !== sectionNow) { sectionNow = F.section; sectionSince = now; }
      // a drop outranks a planned ordinary change that is not on screen yet: replace it
      if (pending && F.drop && P.drop === 'change' && pending.reason !== 'drop' && pending.reason !== 'override' && pending.at - now > 150) pending = null;
      if (pending) return null;
      const bar = barMs(F), age = now - since, k = lerp(1.7, 0.55, S.change);
      const minAge = P.minBars * bar * k, maxAge = P.maxBars * bar * k * (0.8 + 0.4 * R());
      let reason = null, kind = P.sync;
      if (overrideId) { if (current !== overrideId && !forced) { reason = 'override'; kind = 'beat'; } }
      else if (!current) { reason = 'start'; kind = 'beat'; }
      else if (F.silent) reason = null; // hold during silence
      else if (F.drop && P.drop === 'change' && age > bar * 0.5) { reason = 'drop'; kind = 'beat'; }
      else if (sectionNow !== sceneSection && now - sectionSince > 1500 && age > minAge * 0.5 && sectionNow !== 'silence') reason = 'section';
      else if (age > minAge) {
        const c = CATALOGUE[current], e = Math.min(eS * (0.6 + 0.4 * S.intensity) + 0.1, P.energyCap);
        if (e < c.e[0] - 0.12 || e > c.e[1] + 0.12) reason = 'energy';
        else if (age > maxAge) reason = 'time';
        else if (ctx && ctx.evolveReady && age > (minAge + maxAge) / 2) reason = 'evolve'; // the shape's own evolution has run its course
      }
      if (!reason) return null;
      const energy = clamp(eS * (0.6 + 0.4 * S.intensity) + 0.1, 0, 1);
      const at = boundary(F, now, ctx, reason === 'drop' || reason === 'override' || reason === 'start' ? 'beat' : kind);
      const preset = overrideId || pick(energy, at); forced = !!overrideId;
      if (preset === current && reason !== 'start') { since = now; return null; }
      const sec = reason === 'drop' ? 'drop' : sectionNow, inten = clamp((SECTION_INTENSITY[sec] || 0.7) * (0.4 + 0.6 * S.intensity), 0.15, 1);
      const beatS = F.bpm > 40 ? 60 / F.bpm : 0.5;
      const fade = reason === 'drop' ? clamp(P.fadeBeats * beatS * 0.25, 0.15, 1.5) : clamp(P.fadeBeats * beatS, 0.25, 8);
      const L = S.lightSync ? (reason === 'drop' ? P.light.drop : P.light.change) : null;
      pending = { at, preset, others: others(preset), hue: (hueBase + colourFor(reason, at)) % 360, speed: P.speed * lerp(0.85, 1.15, inten), react: P.react * S.react * lerp(0.6, 1, inten),
        bright: P.bright * lerp(0.8, 1, inten), intensity: inten, fade, light: L ? { fx: L } : null, reason, section: sec, decidedAt: now };
      lastPick = now; void lastPick;
      return pending;
    }
    return {
      update,
      state: () => ({ current, since, next: pending, history: history.slice(-12), section: sectionNow, energy: eS, personality: pKey, override: overrideId }),
      set(x) { if (x.personality && PERSONALITIES[x.personality]) { P = PERSONALITIES[x.personality]; pKey = x.personality; } if (x.settings) S = normSettings(x.settings); },
      override(id) { overrideId = id && CATALOGUE[id] ? id : null; forced = false; if (pending && overrideId && pending.preset !== overrideId) pending = null; },
      reset() { current = null; since = -1e12; pending = null; history = []; },
      get settings() { return S; },
    };
  }
  const api = { createDirector, CATALOGUE, PERSONALITIES, DEFAULTS, normSettings, SECTION_INTENSITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumenDirector = api;
})(typeof window !== 'undefined' ? window : globalThis);
