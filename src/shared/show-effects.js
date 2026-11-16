'use strict';
// Lightshow effect engine + show director.
//
// An effect CLIP is what the user (or the generator) places on the timeline:
//   { id, fx, t, dur, lane, devs?, p: { ...parameters }, user? }
// expand() turns a clip into the primitive events the compiler and player already understand (color / ambient base
// changes; flash / pulse / strobe / blackout overlays), ONE BULB AT A TIME, so every effect is shaped by what that bulb
// can really do: fast bulbs (WiZ) get the full effect; medium (Cync) and slow (Hubspace) bulbs get a reduced version
// that fits their command rate (fewer repeats, longer holds, a single hit) or sit the effect out. The reduction is
// reported per clip (notes) so the editor can tell the user what each bulb will actually do.
//
// generateShow() is the "director": it reads the music analysis section by section and phrase by phrase and picks
// effects that fit (quiet/vocal parts get ambient, wash, slow pulses; energetic parts get flashes, snaps, chases,
// alternation; build-ups build; drops explode, black out or snap), avoids repeating itself, and only throws colour
// across the room when the user's throw setting asks for it.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./show-core')); else root.LumenFx = factory(root.LumenShow); })(typeof self !== 'undefined' ? self : this, function (Core) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const WHITE = [255, 255, 255];
  const toWhite = (c, k) => Core.lerpRgb(c, WHITE, k);
  const dim = (c, k) => c.map((v) => v * k);
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const comp = (c) => { const [h, s, v] = Core.hsv(c); return Core.rgbOf([h + 180, Math.max(0.6, s), Math.max(0.6, v)]); };

  // ---------- parameter catalogue (drives the editor UI and validation) ----------
  const DIRS = { lr: 'Left → right', rl: 'Right → left', tb: 'Back → front (top of plan first)', bt: 'Front → back', out: 'Centre outward', in: 'Edges inward', d1: 'Corner to corner ↘', d2: 'Corner to corner ↙', auto: 'Vary' };
  const ON = { beat: 'Every beat', down: 'Bar downbeats', offbeat: 'Off-beats', kick: 'Bass / kick hits', snare: 'Snare hits', hat: 'Hi-hats', step: 'Fixed rate (step)', random: 'Random' };
  const PARAM = {
    on: { label: 'Trigger', kind: 'select', opts: ON, tip: 'What makes the effect fire' },
    step: { label: 'Step (beats)', kind: 'num', min: 0.125, max: 16, step: 0.125, tip: 'Time between repeats, in beats' },
    prob: { label: 'Probability', kind: 'pct', min: 0, max: 1, step: 0.05, tip: 'Chance each trigger fires (lower = sparser, less predictable)' },
    reps: { label: 'Repetitions', kind: 'num', min: 0, max: 128, step: 1, tip: '0 = repeat for the whole clip' },
    bri: { label: 'Brightness', kind: 'num', min: 0, max: 100, step: 1, tip: 'Peak brightness (%)' },
    depth: { label: 'Depth', kind: 'pct', min: 0, max: 1, step: 0.05, tip: 'How far brightness falls between peaks' },
    decay: { label: 'Decay (beats)', kind: 'num', min: 0.1, max: 16, step: 0.1, tip: 'How long the hit takes to fade back' },
    hz: { label: 'Flashes / s', kind: 'num', min: 1, max: 12, step: 0.5, tip: 'Strobe speed (limited per bulb)' },
    fadeIn: { label: 'Fade in (s)', kind: 'num', min: 0, max: 8, step: 0.05 },
    fadeOut: { label: 'Fade out (s)', kind: 'num', min: 0, max: 8, step: 0.05 },
    rand: { label: 'Randomness', kind: 'pct', min: 0, max: 1, step: 0.05, tip: 'Irregular timing, colour and brightness' },
    dir: { label: 'Direction', kind: 'select', opts: DIRS },
    span: { label: 'Travel (beats)', kind: 'num', min: 0, max: 16, step: 0.25, tip: 'Time to cross the room' },
    width: { label: 'Pulse length (beats)', kind: 'num', min: 0.1, max: 8, step: 0.1 },
    alt: { label: 'Alternate colours', kind: 'bool' },
    split: { label: 'Split the room', kind: 'bool', tip: 'Left and right take different colours' },
    by: { label: 'Groups', kind: 'select', opts: { side: 'Left / right', index: 'Every other bulb', lane: 'By lane' } },
    mode: { label: 'Alternate', kind: 'select', opts: { color: 'Colours', bright: 'Bright / dim' } },
    ret: { label: 'Return', kind: 'select', opts: { flash: 'Burst back', snap: 'Snap back', fade: 'Fade back' } },
    white: { label: 'Whiteness', kind: 'pct', min: 0, max: 1, step: 0.05 },
    bounce: { label: 'Bounce back', kind: 'bool' },
    dimOthers: { label: 'Others go dark', kind: 'bool' },
    fade: { label: 'Blend', kind: 'pct', min: 0, max: 1, step: 0.05, tip: 'Share of each step spent blending' },
    flow: { label: 'Flow across room', kind: 'pct', min: 0, max: 1, step: 0.05 },
    speed: { label: 'Changes / s', kind: 'num', min: 0.5, max: 12, step: 0.5 },
    end: { label: 'End with', kind: 'select', opts: { blackout: 'Blackout before the drop', none: 'Nothing' } },
    breathe: { label: 'Breathing', kind: 'pct', min: 0, max: 1, step: 0.05 },
    dyn: { label: 'Follow loudness', kind: 'pct', min: 0, max: 1, step: 0.05, tip: 'Harder hits are brighter, softer ones dimmer' },
    accel: { label: 'Accelerate', kind: 'bool', tip: 'Pulses speed up toward the end' },
    who: { label: 'Bulbs', kind: 'select', opts: { all: 'All (slow bulbs adapt)', fast: 'Fast bulbs only', fastmed: 'Fast + medium', slow: 'Slow bulbs only' } },
  };
  const COMMON = ['who', 'bri', 'fadeIn', 'fadeOut'];
  // cat: hit | rhythm | spatial | atmos | transition.  trig: where the director may use it (user can change).
  const EFFECTS = {
    flash: { name: 'Flash', cat: 'hit', desc: 'Sharp bursts that decay back; can alternate colours.', trig: ['beat', 'bass', 'transition', 'random'],
      def: { on: 'beat', step: 1, prob: 1, reps: 0, decay: 0.6, alt: true, rand: 0.15, white: 0, dyn: 0.5 }, params: ['on', 'step', 'prob', 'reps', 'decay', 'alt', 'white', 'dyn', 'rand'] },
    strobe: { name: 'Strobe', cat: 'hit', desc: 'Rapid on/off flashing at a set speed.', trig: ['transition'],
      def: { hz: 8, white: 1 }, params: ['hz', 'white'] },
    blackout: { name: 'Blackout', cat: 'transition', desc: 'Everything goes completely dark, then comes back hard.', trig: ['transition'],
      def: { ret: 'flash', decay: 1.5 }, params: ['ret', 'decay'] },
    pulse: { name: 'Pulse', cat: 'rhythm', desc: 'Smooth rise-and-fall breathing on a rhythm.', trig: ['beat', 'bass', 'vocal'],
      def: { on: 'beat', step: 1, prob: 1, reps: 0, depth: 0.7, width: 0.9, alt: false, rand: 0.1, dyn: 0.4 }, params: ['on', 'step', 'prob', 'reps', 'depth', 'width', 'alt', 'dyn', 'rand'] },
    heartbeat: { name: 'Heartbeat', cat: 'rhythm', desc: 'Two quick pulses, then a pause: lub-dub.', trig: ['beat', 'bass', 'vocal'],
      def: { on: 'step', step: 2, depth: 0.85, decay: 0.3 }, params: ['on', 'step', 'depth', 'decay'] },
    explosion: { name: 'Explosion', cat: 'hit', desc: 'A blinding burst from the centre of the room that slowly decays.', trig: ['transition', 'bass'],
      def: { decay: 3, white: 0.8, split: false, span: 0.6 }, params: ['decay', 'white', 'span', 'split'] },
    snap: { name: 'Colour snap', cat: 'rhythm', desc: 'Instant jumps between strongly contrasting colours.', trig: ['beat', 'transition'],
      def: { on: 'beat', step: 2, prob: 1, split: false, rand: 0, dyn: 0.4 }, params: ['on', 'step', 'prob', 'split', 'dyn', 'rand'] },
    wash: { name: 'Colour wash', cat: 'atmos', desc: 'Colours flow smoothly from one to the next.', trig: ['vocal', 'transition'],
      def: { step: 8, fade: 0.85, flow: 0.4 }, params: ['step', 'fade', 'flow', 'dir'] },
    flicker: { name: 'Flicker', cat: 'atmos', desc: 'Irregular, candle- or fault-like brightness and colour variation.', trig: ['random'],
      def: { speed: 7, depth: 0.6, rand: 0.7 }, params: ['speed', 'depth', 'rand'] },
    wave: { name: 'Wave', cat: 'spatial', desc: 'A swell of light rolls across the bulbs and leaves them as they were.', trig: ['beat', 'vocal', 'transition'],
      def: { on: 'step', step: 4, span: 1.5, width: 1, dir: 'lr', bounce: true, alt: true }, params: ['on', 'step', 'span', 'width', 'dir', 'bounce', 'alt'] },
    throw: { name: 'Room throw', cat: 'spatial', desc: 'A colour is thrown from one side of the room to the other and stays there.', trig: ['transition'],
      def: { step: 8, reps: 1, span: 2, dir: 'lr' }, params: ['dir', 'span', 'step', 'reps'] },
    chase: { name: 'Chase', cat: 'spatial', desc: 'Bulbs light one after another in order.', trig: ['beat', 'transition'],
      def: { step: 0.5, dir: 'lr', bounce: false, dimOthers: false, reps: 0 }, params: ['step', 'dir', 'bounce', 'dimOthers', 'reps'] },
    alternate: { name: 'Alternating', cat: 'rhythm', desc: 'Two groups swap colours or brightness against each other.', trig: ['beat', 'bass'],
      def: { on: 'beat', step: 1, by: 'side', mode: 'color', depth: 0.85, prob: 1, dyn: 0.4 }, params: ['on', 'step', 'by', 'mode', 'depth', 'prob', 'dyn'] },
    build: { name: 'Build / drop', cat: 'transition', desc: 'Rising brightness and accelerating pulses toward white, cut before the drop.', trig: ['transition'],
      def: { white: 0.6, end: 'blackout', accel: true }, params: ['white', 'accel', 'end'] },
    ambient: { name: 'Ambient', cat: 'atmos', desc: 'Slow, dim, drifting colour with gentle breathing.', trig: ['vocal'],
      def: { step: 8, breathe: 0.3, rand: 0.5, bri: 40 }, params: ['step', 'breathe', 'rand'] },
  };
  const NAMES = Object.keys(EFFECTS);
  for (const k of NAMES) { const e = EFFECTS[k]; e.def = { who: 'all', bri: 100, fadeIn: 0, fadeOut: 0, ...e.def }; e.params = [...e.params, ...COMMON]; }

  function normParams(fx, p) { // fill defaults and clamp everything to the catalogue's ranges
    const E = EFFECTS[fx]; if (!E) return null; const out = { ...E.def };
    for (const [k, v] of Object.entries(p || {})) {
      if (k === 'colors') { if (Array.isArray(v)) out.colors = v.filter((c) => Array.isArray(c) && c.length === 3).slice(0, 6).map((c) => c.map((x) => Math.round(clamp(+x || 0, 0, 255)))); continue; }
      if (k === 'seed') { out.seed = (+v || 0) >>> 0; continue; }
      if (k === 'keepDown' || k === 'keep') { out[k] = !!v; continue; }
      const S = PARAM[k]; if (!S) continue;
      if (S.kind === 'select') { if (Object.prototype.hasOwnProperty.call(S.opts, v)) out[k] = v; }
      else if (S.kind === 'bool') out[k] = !!v;
      else { const n = +v; if (Number.isFinite(n)) out[k] = clamp(n, S.min, S.max); }
    }
    if (!out.colors || !out.colors.length) out.colors = fx === 'strobe' || fx === 'explosion' ? [WHITE.slice(), [0, 120, 255]] : [[255, 0, 160], [0, 220, 255]];
    return out;
  }
  const newClip = (fx, t, dur, extra = {}) => ({ id: extra.id || 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), fx, t: +(+t).toFixed(3), dur: +Math.max(0.05, +dur).toFixed(3), lane: extra.lane || '*', ...(extra.devs ? { devs: extra.devs } : {}), p: normParams(fx, extra.p), ...(extra.user ? { user: true } : {}) });

  // ---------- context: the bulbs, where they are, how fast they are, and the music ----------
  function makeCtx({ an, lanes, devInfo, events }) {
    lanes = lanes || []; devInfo = devInfo || {};
    const seen = new Set(), bulbs = [];
    for (const L of lanes) for (const id of L.deviceIds || []) {
      if (seen.has(id)) continue; seen.add(id); const inf = devInfo[id]; if (!inf || inf.enabled === false || inf.online === false) continue;
      const prof = inf.profile || {}, interval = Core.intervalOf(inf, prof); let speed = Core.speedClass(interval);
      if (prof.rel != null && prof.rel < 0.75) speed = speed === 'fast' ? 'medium' : 'slow'; // unreliable: treat as one class slower
      const ivS = interval / 1000 * (speed === 'fast' ? 1 : prof.rel != null && prof.rel < 0.75 ? 2 : 1);
      bulbs.push({ id, lane: L.id, speed, ivS, gap: Math.max(ivS, 0.05) * 1.05, color: !inf.caps || inf.caps.color !== false, pos: inf.pos });
    }
    bulbs.forEach((b, i) => { const p = b.pos || Core.autoPos(i, bulbs.length); b.x = p.x; b.y = p.y; });
    const beats = an && an.beats && an.beats.length > 1 ? an.beats : null, nb = beats ? beats.length : 0;
    const iv = beats ? (beats[nb - 1] - beats[0]) / (nb - 1) : an && an.bpm ? 60 / an.bpm : 0.5;
    const phase = (an && an.downPhase) || 0;
    const baseSt = {}, baseAt = (id, t) => { if (!baseSt[id]) baseSt[id] = Core.stateFn((events || []).filter((e) => !e.fx && !Core.isOverlay(e.type) && (e.devs && e.devs.length ? e.devs.includes(id) : e.lane === '*' || (lanes.find((l) => l.id === e.lane) || { deviceIds: [] }).deviceIds.includes(id)))); return baseSt[id].at(t); };
    return { an, lanes, bulbs, iv, beats, phase, end: an && an.duration ? an.duration : Infinity, baseAt, bInBar: (i) => ((i - phase) % 4 + 4) % 4 };
  }

  // where each bulb sits along a direction, 0..1
  function project(dir, list) { // positions are 0..1 across the room, so 'out' / 'in' are measured from the room's centre
    const mx = 0.5, my = 0.5;
    const V = { lr: [1, 0], rl: [-1, 0], tb: [0, 1], bt: [0, -1], d1: [1, 1], d2: [-1, 1] }[dir];
    const v = (b) => (V ? b.x * V[0] + b.y * V[1] : Math.hypot(b.x - mx, b.y - my) * (dir === 'in' ? -1 : 1));
    const vs = list.map(v), lo = Math.min(...vs), sp = Math.max(...vs) - lo;
    return (b) => (sp > 1e-6 ? (v(b) - lo) / sp : 0);
  }
  const thin = (ts, gap) => { const out = []; for (const t of ts) if (!out.length || t - out[out.length - 1] >= gap - 1e-6) out.push(t); return out; };

  // when a rhythmic clip fires: beats / downbeats / kicks ... inside the clip, every `step`, thinned by probability
  function triggers(c, ctx, R) {
    const p = c.p, t0 = c.t, t1 = c.t + c.dur, iv = ctx.iv, on = p.on || 'step', inR = (t) => t >= t0 - 0.02 && t < t1 - 0.02;
    let ts = [], strong = new Set(); const str = new Map();
    const every = Math.max(1, Math.round(p.step || 1));
    if (ctx.beats && (on === 'beat' || on === 'down' || on === 'offbeat')) {
      let n = 0; ctx.beats.forEach((t, i) => { if (!inR(t)) return; const b = ctx.bInBar(i); if (b === 0) strong.add(t); if (on === 'beat' || (on === 'down' && b === 0) || (on === 'offbeat' && (b === 1 || b === 3))) { if (n++ % every === 0) { ts.push(t); str.set(t, b === 0 ? 1 : b === 2 ? 0.8 : 0.62); } } });
    } else if (ctx.an && (on === 'kick' || on === 'snare' || on === 'hat')) {
      const list = ctx.an[on === 'kick' ? 'kicks' : on === 'snare' ? 'snares' : 'hats'] || [];
      ts = list.filter(([t, s]) => inR(t) && s >= 0.35).map(([t, s]) => { str.set(t, clamp(s, 0.3, 1)); return t; });
      if (ts.length < (c.dur / iv) * 0.15 && ctx.beats) ts = ctx.beats.filter(inR); // too few detected hits: fall back to the beat grid
      ts = thin(ts, 0.09);
    } else { const st = Math.max(0.05, (p.step || 1) * iv); for (let t = t0; t < t1 - 1e-6; t += st) ts.push(t); }
    const prob = on === 'random' ? Math.min(p.prob, 0.6) : p.prob;
    if (prob < 1) ts = ts.filter((t) => (p.keepDown && strong.has(t)) || R() < prob);
    if (p.rand > 0 && on === 'random') ts = ts.map((t) => t + (R() - 0.5) * p.rand * iv * 0.5);
    if (p.reps > 0) ts = ts.slice(0, p.reps);
    // loudness of each trigger (1 = downbeat / hardest hit); unknown (fixed-rate) triggers count as full
    if (!str.size && ctx.an && ctx.an.curve && ctx.an.curve.e) { const ce = ctx.an.curve, mx = Math.max(1e-6, ...ce.e); for (const t of ts) str.set(t, clamp(0.45 + 0.55 * ce.e[clamp(Math.floor(t / ce.dt), 0, ce.e.length - 1)] / mx, 0, 1)); }
    const outT = ts.filter((t) => t >= t0 - 0.03 && t < t1); outT.s = str; return outT;
  }

  // ---------- expansion ----------
  function expand(c, ctx) {
    const E = EFFECTS[c.fx]; if (!E) return { events: [], note: {} };
    const p = c.p = normParams(c.fx, c.p), R = Core.rng(hash(c.id) ^ (p.seed || 0)), iv = ctx.iv, B = (x) => x * iv, out = [], note = {};
    const t0 = c.t, t1 = Math.min(c.t + c.dur, ctx.end);
    const laneIds = c.lane && c.lane !== '*' ? new Set((ctx.lanes.find((l) => l.id === c.lane) || { deviceIds: [] }).deviceIds) : null;
    const who = { all: () => true, fast: (b) => b.speed === 'fast', fastmed: (b) => b.speed !== 'slow', slow: (b) => b.speed === 'slow' }[p.who] || (() => true);
    const T = ctx.bulbs.filter((b) => (!laneIds || laneIds.has(b.id)) && (!c.devs || !c.devs.length || c.devs.includes(b.id)) && who(b));
    if (!T.length || t1 <= t0) return { events: [], note: { all: 'no bulbs' } };
    const cols = p.colors, nC = cols.length, col = (k) => cols[((k % nC) + nC) % nC];
    const bri = p.bri, cx = T.reduce((q, b) => q + b.x, 0) / T.length;
    let n = 0;
    const ev = (b, type, t, dur, rgb, br, extra) => { if (t >= ctx.end || t + dur <= 0 || t < t0 - 0.001 - 4 * iv || (t > t1 + 0.001 && !(extra && extra.after))) return; if (extra && extra.after) { extra = { ...extra }; delete extra.after; } const tt = +Math.max(0, t).toFixed(3); if (tt >= ctx.end) return; out.push({ id: `${c.id}.${n++}`, t: tt, dur: +Math.max(0.04, dur).toFixed(3), lane: b.lane, devs: [b.id], type, rgb: rgb.map((v) => Math.round(clamp(v, 0, 255))), bri: Math.round(clamp(br, 0, 100)), pri: 2, fx: c.id, ...(extra || {}) }); };
    const mark = (b, m) => { const k = b.speed; note[k] = note[k] && note[k] !== m ? 'partly ' + m : m; };
    const restore = (b, at, f = 0.3) => { f = Math.min(f, Math.max(0.05, (at - t0) / 2)); at = Math.max(t0, at - f - 0.06); // finish returning by the clip's end
      const s = ctx.baseAt(b.id, at); ev(b, 'ambient', at, 0.05, s.rgb, s.bri, { fade: f, pri: 2 }); };
    // hold: a constant colour for `dur`, then back to whatever is underneath
    const hold = (b, t, dur, rgb, br, pri) => ev(b, 'flash', t, dur, rgb, br, { hold: 1, pri: pri || 2 });
    const side = (b) => (b.x <= cx ? 0 : 1);
    const dynOf = (ts) => (t) => { const v = ts.s && ts.s.has(t) ? ts.s.get(t) : 1; return 1 - (p.dyn || 0) * (1 - v); };
    const dirOf = (k) => (p.dir === 'auto' || !p.dir ? ['lr', 'rl', 'tb', 'out', 'd1', 'bt', 'in', 'd2'][(hash(c.id) + k) % 8] : p.dir);
    const fx = c.fx;

    if (fx === 'flash') {
      const ts = triggers(c, ctx, R), d = B(p.decay), dy = dynOf(ts);
      for (const b of T) {
        const need = b.speed === 'fast' ? 0 : b.gap * 2.05, use = need ? thin(ts, need) : ts;
        use.forEach((t) => { const k = ts.indexOf(t), r = p.rand * R(); let rgb = p.alt ? col(k + (r > 0.85 ? 1 : 0)) : col(0); if (p.white) rgb = toWhite(rgb, p.white);
          ev(b, 'flash', t, Math.max(d * (0.85 + 0.3 * dy(t)), b.speed === 'fast' ? 0.06 : b.gap * 1.05), rgb, bri * dy(t) * (1 - 0.35 * p.rand * R()), { pri: dy(t) > 0.95 ? 3 : 2 }); });
        mark(b, use.length === ts.length ? 'full' : use.length ? 'fewer flashes' : 'skipped');
      }
    } else if (fx === 'strobe') {
      const rgb = toWhite(col(0), p.white);
      for (const b of T) {
        if (b.speed === 'slow') { if (t1 - t0 >= b.gap) { hold(b, t0, Math.min(t1 - t0, b.gap * 1.05), rgb, bri, 3); mark(b, 'one hit'); } else mark(b, 'skipped'); continue; }
        const hz = Math.min(p.hz, 1 / (2 * b.gap)); if (hz < 0.6) { mark(b, 'skipped'); continue; }
        ev(b, 'strobe', t0, t1 - t0, rgb, bri, { hz: +hz.toFixed(2), pri: 2 }); mark(b, hz < p.hz - 0.01 ? `slowed to ${hz.toFixed(1)}/s` : 'full');
      }
    } else if (fx === 'blackout') {
      const d = t1 - t0;
      for (const b of T) {
        if (d < b.gap) { mark(b, 'skipped (too short for this bulb)'); continue; }
        ev(b, 'blackout', t0, d, [0, 0, 0], 0, { pri: 3 });
        if (p.ret === 'flash') ev(b, 'flash', t1, Math.max(B(p.decay), b.speed === 'fast' ? 0.1 : b.gap * 1.05), toWhite(col(0), 0.3), bri, { pri: 3, after: 1 });
        else if (p.ret === 'snap') ev(b, 'flash', t1, Math.max(B(p.decay), b.gap * 1.05), col(0), bri, { hold: 1, pri: 3, after: 1 });
        mark(b, 'full');
      }
    } else if (fx === 'pulse') {
      const ts = triggers(c, ctx, R), dy = dynOf(ts), lenOf = (i, arr) => (i + 1 < arr.length ? arr[i + 1] - arr[i] : B(p.step)) * p.width;
      for (const b of T) {
        if (b.speed === 'slow') { const use = thin(ts, b.gap * 2.2); use.forEach((t, i) => hold(b, t, b.gap * 1.05, col(p.alt ? i : 0), bri)); mark(b, use.length ? 'slow swells' : 'skipped'); continue; }
        const use = b.speed === 'fast' ? ts : thin(ts, b.gap * 2.05);
        use.forEach((t, i) => { const k = ts.indexOf(t); ev(b, 'pulse', t, Math.max(lenOf(i, use), b.speed === 'fast' ? 0.12 : b.gap * 2), col(p.alt ? k : 0), bri * dy(t) * (1 - 0.3 * p.rand * R()), { lo: Math.round(bri * (1 - p.depth)), curve: 'sine', pri: 2 }); });
        mark(b, use.length === ts.length ? 'full' : use.length ? 'fewer pulses' : 'skipped');
      }
    } else if (fx === 'heartbeat') {
      const ts = triggers(c, ctx, R), gap2 = B(0.36), w = B(p.decay), lo = bri * (1 - p.depth);
      for (const b of T) {
        if (b.speed === 'slow') { const use = thin(ts, b.gap * 2.2); use.forEach((t) => hold(b, t, b.gap * 1.05, col(0), bri)); mark(b, use.length ? 'one beat per cycle' : 'skipped'); continue; }
        const dbl = gap2 >= b.gap && b.speed === 'fast', use = thin(ts, dbl ? 0 : b.gap * 2.05);
        for (const t of use) {
          if (dbl) { ev(b, 'pulse', t, Math.min(w, gap2 * 0.95), col(0), bri, { lo, curve: 'sine', pri: 2 }); ev(b, 'pulse', t + gap2, w, col(0), bri * 0.72, { lo, curve: 'sine', pri: 2 }); }
          else ev(b, 'pulse', t, Math.max(w * 2, b.gap * 2), col(0), bri, { lo, curve: 'sine', pri: 2 });
        }
        mark(b, dbl ? 'full' : 'single beat');
      }
    } else if (fx === 'explosion') {
      const pr = project('out', T), A = col(0), Bc = nC > 1 ? col(1) : comp(A);
      for (const b of T) {
        const delay = b.speed === 'fast' ? pr(b) * B(p.span) * 0.5 : 0, sd = side(b);
        ev(b, 'flash', t0 + delay, Math.max(B(p.decay), b.speed === 'fast' ? 0.2 : b.gap * 1.05), toWhite(sd ? Bc : A, p.white), bri, { pri: 3 });
        if (p.split) ev(b, 'color', t0 + delay + 0.02, Math.max(0.1, t1 - t0), b.speed === 'slow' ? (sd ? A : Bc) : (sd ? Bc : A), bri * (b.speed === 'fast' ? 0.85 : 0.95), { fade: 0.05, pri: 3 });
        mark(b, 'full');
      }
    } else if (fx === 'snap') {
      const ts = triggers(c, ctx, R), dy = dynOf(ts);
      for (const b of T) {
        const use = thin(ts, b.gap * 1.02), sd = p.split ? side(b) : 0;
        use.forEach((t, i) => { const k = ts.indexOf(t), nx = i + 1 < use.length ? use[i + 1] : t1, ci = p.rand && R() < p.rand * 0.4 ? Math.floor(R() * nC) : k + sd;
          hold(b, t, Math.max(0.05, nx - t), b.color ? col(ci) : col(0), (b.color ? bri : bri * (ci % 2 ? 0.35 : 1)) * dy(t), 2); });
        mark(b, use.length === ts.length ? 'full' : use.length ? 'fewer changes' : 'skipped');
      }
    } else if (fx === 'wash') {
      const pr = project(dirOf(0), T);
      for (const b of T) {
        const st = Math.max(B(p.step), b.gap * 1.6), off = p.flow * pr(b) * st; let k = 0;
        for (let t = t0 + off; t < t1 - 0.05; t += st, k++) ev(b, 'ambient', t, Math.min(st, t1 - t), col(k), bri, { fade: Math.max(0.05, st * p.fade), pri: 1 });
        restore(b, t1, Math.min(2, st * p.fade)); mark(b, st > B(p.step) + 1e-6 ? 'slower' : 'full');
      }
    } else if (fx === 'flicker') {
      for (const b of T) {
        if (b.speed === 'slow') { mark(b, 'skipped (too slow to flicker)'); continue; }
        const mean = Math.max(1 / p.speed, b.gap * 1.1); let t = t0, k = 0;
        while (t < t1 - 0.03) { const step = Math.max(b.gap * 1.02, mean * (1 + p.rand * (R() * 2 - 1) * 0.85)), base = col(k % nC === 0 || R() < 0.7 ? 0 : 1);
          const [h, s, v] = Core.hsv(base), rgb = Core.rgbOf([h + (R() - 0.5) * 40 * p.rand, s, v]);
          hold(b, t, Math.min(step, t1 - t), rgb, bri * (1 - p.depth * R() * (0.4 + 0.6 * p.rand)), 1); t += step; k++; }
        mark(b, mean > 1 / p.speed + 1e-6 ? 'slower flicker' : 'full');
      }
    } else if (fx === 'wave') {
      const ts = triggers(c, ctx, R), w = B(p.width);
      ts.forEach((T0, k) => {
        const rev = p.bounce && k % 2, pr = project(rev ? { lr: 'rl', rl: 'lr', tb: 'bt', bt: 'tb', out: 'in', in: 'out', d1: 'd1', d2: 'd2' }[dirOf(0)] || dirOf(0) : dirOf(0), T);
        for (const b of T) {
          const t = T0 + pr(b) * B(p.span), rgb = col(p.alt ? k : 0);
          if (b.speed === 'fast') ev(b, 'pulse', t, w, rgb, bri, { curve: 'sine', pri: 2 });
          else if (b.speed === 'medium') ev(b, 'pulse', t, Math.max(w, b.gap * 2), rgb, bri, { curve: 'sine', pri: 2 });
          else hold(b, t, Math.max(w, b.gap * 1.05), rgb, bri, 2);
        }
      });
      // slow/medium bulbs: drop waves that come too quickly for them (they keep their place in the travel order)
      for (const b of T) if (b.speed !== 'fast') { const mine = out.filter((e) => e.devs[0] === b.id), keep = new Set(thin(mine.map((e) => e.t), b.gap * (b.speed === 'slow' ? 2.2 : 2.05))); const before = mine.length; for (const e of mine) if (!keep.has(e.t)) out.splice(out.indexOf(e), 1); mark(b, keep.size === before ? 'full' : keep.size ? 'fewer waves' : 'skipped'); } else mark(b, 'full');
    } else if (fx === 'throw') {
      const st = B(p.step), reps = p.reps > 0 ? p.reps : Math.max(1, Math.floor((t1 - t0) / st));
      for (let k = 0; k < reps; k++) {
        const T0 = t0 + k * st; if (T0 >= t1 - 0.05) break;
        const pr = project(dirOf(k), T), rgb = col(k);
        for (const b of T) {
          if (k > 0 && st < b.gap * 1.25 && k % Math.ceil(b.gap * 1.25 / st)) continue; // throws come faster than this bulb can follow: it joins every n-th
          ev(b, 'ambient', T0 + pr(b) * B(p.span), Math.max(0.1, t1 - T0), rgb, bri, { fade: b.speed === 'fast' ? 0.15 : 0.3, pri: 2 });
        }
      }
      for (const b of T) { restore(b, t1, 0.4); mark(b, 'full'); }
    } else if (fx === 'chase') {
      const pr = project(dirOf(0), T), order = [...T].sort((a, b) => pr(a) - pr(b) || a.x - b.x), slot = B(p.step), N = order.length, round = slot * N;
      const rounds = p.reps > 0 ? p.reps : Math.max(1, Math.floor((t1 - t0) / round + 1e-6));
      for (const b of order) {
        const can = b.speed === 'fast' || round >= b.gap * 2.05; if (!can) { mark(b, 'skipped (chase too fast for this bulb)'); continue; }
        if (p.dimOthers && (b.speed === 'fast' || slot * (N - 1) >= b.gap)) ev(b, 'blackout', t0, Math.min(t1, t0 + rounds * round) - t0, [0, 0, 0], 0, { pri: 1 });
        mark(b, slot >= b.gap ? 'full' : 'longer steps');
      }
      for (let r = 0; r < rounds; r++) {
        const seq = p.bounce && r % 2 ? [...order].reverse() : order;
        seq.forEach((b, i) => { const t = t0 + r * round + i * slot; if (t >= t1) return; if (!(b.speed === 'fast' || round >= b.gap * 2.05)) return;
          hold(b, t, Math.max(slot * 0.95, b.speed === 'fast' ? 0.05 : b.gap * 1.02), col(r), bri, 2); });
      }
    } else if (fx === 'alternate') {
      const ts = triggers(c, ctx, R), dy = dynOf(ts), laneIdx = new Map(ctx.lanes.map((l, i) => [l.id, i]));
      const grp = (b, i) => (p.by === 'index' ? i % 2 : p.by === 'lane' ? (laneIdx.get(b.lane) || 0) % 2 : side(b));
      T.forEach((b, i) => {
        const g = grp(b, i), use = thin(ts, b.gap * 1.02);
        use.forEach((t, j) => { const k = ts.indexOf(t), nx = j + 1 < use.length ? use[j + 1] : t1, on = (k + g) % 2 === 0;
          if (p.mode === 'bright') hold(b, t, Math.max(0.05, nx - t), col(0), (on ? bri : bri * (1 - p.depth)) * dy(t), 2);
          else hold(b, t, Math.max(0.05, nx - t), col(on ? 0 : 1), bri * dy(t), 2); });
        mark(b, use.length === ts.length ? 'full' : use.length ? 'fewer swaps' : 'skipped');
      });
    } else if (fx === 'build') {
      const total = t1 - t0, A = col(0), Bc = nC > 1 ? col(1) : comp(A), fast = T.filter((b) => b.speed === 'fast');
      for (const b of T) { ev(b, 'color', t0, total, dim(Bc, 0.8), bri * 0.25, { fade: Math.max(0.05, b.gap), pri: 2 }); ev(b, 'ambient', t0 + Math.max(0.06, b.gap * 1.1), total, toWhite(A, p.white), bri, { fade: total * 0.9, pri: 2 }); }
      const bn = ctx.beats ? ctx.beats.filter((t) => t >= t0 - 0.01 && t < t1 - iv * 0.4) : (() => { const a = []; for (let t = t0; t < t1 - iv * 0.4; t += iv) a.push(t); return a; })();
      bn.forEach((tb, k) => { const fr = k / Math.max(1, bn.length), div = !p.accel ? (k % 2 ? 0 : 1) : fr < 0.5 ? 1 : fr < 0.8 ? 2 : 4;
        for (let j = 0; j < div; j++) { const t = tb + j * iv / div; if (t >= t1 - iv * (p.end === 'blackout' ? 0.55 : 0.4)) break; const c2 = toWhite((k * div + j) % 2 ? A : Bc, 0.15 + 0.6 * fr);
          if (fast.length > 1 && fr > 0.5 && p.accel) { const bl = fast[(k * div + j) % fast.length]; ev(bl, 'pulse', t, iv / div * 0.9, c2, bri * (0.4 + 0.6 * fr), { pri: 3 }); }
          else for (const bl of fast) ev(bl, 'pulse', t, iv / div * 0.85, c2, bri * (0.35 + 0.65 * fr), { pri: 3 }); }
        if (k % 4 === 0) for (const b of T) if (b.speed === 'medium' && iv * 4 >= b.gap) ev(b, 'pulse', tb, iv * 2, toWhite(A, fr * 0.6), bri * (0.4 + 0.6 * fr), { pri: 2 });
      });
      if (p.end === 'blackout') for (const b of T) if (b.speed !== 'slow' && iv * 0.5 >= b.gap * 0.45) ev(b, 'blackout', t1 - iv * 0.5, iv * 0.48, [0, 0, 0], 0, { pri: 3 });
      if (!p.keep) for (const b of T) restore(b, t1, 0.05);
      for (const b of T) mark(b, b.speed === 'fast' ? 'full' : b.speed === 'medium' ? 'bar pulses + fade' : 'fade up only');
    } else if (fx === 'ambient') {
      T.forEach((b, i) => {
        const st = Math.max(B(p.step), b.gap * 2.2); let k = Math.floor(R() * nC) + i;
        for (let t = t0 + (i % 3) * st * 0.2; t < t1 - 0.05; t += st) { k += R() < p.rand ? 2 : 1; const rgb = col(k), br = bri * (1 - 0.3 * p.rand * R());
          ev(b, 'ambient', t, Math.min(st, t1 - t), rgb, br, { fade: st * 0.9, pri: 1 });
          if (b.speed === 'fast' && p.breathe > 0) for (let q = t + st * 0.25; q < Math.min(t + st, t1) - 0.1; q += st / 2) ev(b, 'pulse', q, st / 2, rgb, Math.min(100, br * (1 + p.breathe * 0.6)), { lo: Math.round(br * (1 - p.breathe * 0.5)), curve: 'sine', pri: 1 }); }
        restore(b, t1, Math.min(3, st * 0.6)); mark(b, b.speed === 'fast' ? 'full' : 'drift only');
      });
    }
    // envelope: fade the clip in and out by scaling brightness near its edges
    if (p.fadeIn > 0 || p.fadeOut > 0) for (const e of out) { if (e.type === 'blackout') continue; const a = p.fadeIn > 0 ? clamp((e.t - t0) / p.fadeIn, 0.05, 1) : 1, z = p.fadeOut > 0 ? clamp((t1 - e.t) / p.fadeOut, 0.05, 1) : 1; e.bri = Math.round(e.bri * Math.min(a, z)); if (e.lo != null) e.lo = Math.round(e.lo * Math.min(a, z)); }
    return { events: out, note };
  }

  // show = { events, clips, lanes } -> events with every clip's expansion in place of its old one
  function materialize(show, an, devInfo) {
    const own = (show.events || []).filter((e) => !e.fx), clips = show.clips || [];
    if (!clips.length) return { events: own, notes: {} };
    const ctx = makeCtx({ an, lanes: show.lanes, devInfo, events: own }), notes = {}, out = own.slice();
    for (const c of clips) { const r = expand(c, ctx); notes[c.id] = r.note; for (const e of r.events) out.push(e); }
    out.sort((a, b) => a.t - b.t || (a.type > b.type ? 1 : a.type < b.type ? -1 : a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
    return { events: out, notes };
  }

  // ---------- director ----------
  const FX_DEFAULT = Object.fromEntries(NAMES.map((k) => [k, { w: 1, trig: EFFECTS[k].trig.slice() }]));
  // how much each section mood likes each effect (rhythm layer)
  const MOOD = {
    quiet: { ambient: 3, wash: 2, pulse: 1, wave: 0.8, heartbeat: 0.4 },
    vocal: { pulse: 2, wash: 1.4, wave: 1.4, heartbeat: 1, ambient: 1, alternate: 0.5 },
    mid: { pulse: 1.8, flash: 1.5, alternate: 1.5, chase: 1, wave: 1.1, heartbeat: 1, snap: 0.7, flicker: 0.3 },
    high: { flash: 2, snap: 1.6, alternate: 1.5, chase: 1.2, pulse: 0.9, wave: 0.8, heartbeat: 0.6, flicker: 0.35 },
  };
  const STYLE_MUL = {
    party: {}, edm: { strobe: 1.6, chase: 1.4, explosion: 1.5, snap: 1.3, flash: 1.2 }, rock: { snap: 1.6, flash: 1.4, strobe: 1.2, wave: 0.6 },
    reggae: { pulse: 1.6, heartbeat: 1.4, wash: 1.4, snap: 0.5, chase: 0.6, flicker: 0.4 }, hiphop: { heartbeat: 1.6, alternate: 1.5, pulse: 1.2 },
    chill: { flash: 0.15, snap: 0.15, strobe: 0, flicker: 0.3, alternate: 0.3, chase: 0.3, explosion: 0.3, blackout: 0.2, ambient: 2, wash: 2, pulse: 1.4, wave: 1.5 },
    cinematic: { flash: 0.2, snap: 0.3, strobe: 0, flicker: 0.4, alternate: 0.3, chase: 0.3, ambient: 1.8, wash: 2, wave: 1.4, blackout: 1.5, explosion: 1.2 },
    random: {},
  };
  const RHYTHM_ON = { beat: 1, bass: 1, random: 1, vocal: 1 };

  function generateShow(an, optsIn, lanesIn, devInfo, range) {
    const o = Core.normOpts(optsIn), R = Core.rng(o.seed * 7919 + (o.variant || 0)), styleKey = o.style, S0 = Core.STYLES[styleKey];
    const dur = an.duration, beats = an.beats, nb = beats.length, iv = nb > 1 ? (beats[nb - 1] - beats[0]) / (nb - 1) : 0.5, phase = an.downPhase || 0, bar = iv * 4;
    const events = [], clips = []; let ctr = 0, cc = 0; const uid = () => 'g' + (ctr++).toString(36) + Math.floor(R() * 46656).toString(36);
    const inRange = (t) => !range || (t >= range[0] && t < range[1]);
    const ctx = makeCtx({ an, lanes: lanesIn, devInfo, events: [] }), all = ctx.bulbs;
    if (!all.length) return { events: [], clips: [] };
    const has = { fast: all.some((b) => b.speed === 'fast'), medium: all.some((b) => b.speed === 'medium'), slow: all.some((b) => b.speed === 'slow') };
    const fxw = (k) => { if (!EFFECTS[k]) return 1; const u = (o.fx && o.fx[k]) || FX_DEFAULT[k]; return u.w == null ? 1 : clamp(+u.w, 0, 3); };
    const allows = (k, tr) => { if (!EFFECTS[k]) return true; const u = (o.fx && o.fx[k]) || FX_DEFAULT[k]; return (u.trig || EFFECTS[k].trig).includes(tr); };
    const clip = (fx, t, d, p, extra) => { if (!inRange(t) || t >= dur || t < 0 || fxw(fx) <= 0) return null; if (range) d = Math.min(d, range[1] - t); d = Math.min(d, dur - t); if (d < 0.05) return null;
      const c = { id: 'gx' + (cc++).toString(36) + Math.floor(R() * 46656).toString(36), fx, t: +t.toFixed(3), dur: +d.toFixed(3), lane: '*', p: normParams(fx, p), ...(extra || {}) }; clips.push(c); return c; };
    const base = (sub, t, d, rgb, bri, fade) => { if (!inRange(t) || t >= dur) return; events.push({ id: uid(), t: +t.toFixed(3), dur: +Math.max(0.04, d).toFixed(3), lane: sub.lane, ...(sub.devs ? { devs: sub.devs } : {}), type: 'color', rgb: rgb.map((v) => Math.round(clamp(v, 0, 255))), bri: Math.round(clamp(bri, 0, 100)), pri: 2, fade: +fade.toFixed(3) }); };
    // base-colour layers: one per lane and speed class (as before), so lanes keep their own colour
    const subs = []; for (const L of lanesIn) { const by = {}; for (const b of all) if (b.lane === L.id) (by[b.speed] = by[b.speed] || []).push(b.id); const ks = Object.keys(by); for (const k of ks) subs.push({ lane: L.id, devs: ks.length > 1 ? by[k] : undefined, speed: k, li: subs.length, gap: Math.max(...by[k].map((id) => all.find((b) => b.id === id).gap)) }); }
    // ---- colour director (contrasting pairs that change with phrases and sections) ----
    const soft = styleKey === 'chill' || styleKey === 'cinematic', pal = Core.PALETTES[o.palette || S0.pal] || null;
    let pairs = Core.colourPairs(pal || Core.CONTRAST.flat(), soft ? 0.85 : 1); if (!pal) pairs = Core.CONTRAST.map(([a, b]) => [a, b]);
    const P = pairs.length, sections = an.sections && an.sections.length ? an.sections : [{ t0: 0, t1: dur, label: 'verse', group: 0, energy: 0.6 }];
    const gStart = {}; let gNext = Math.floor(R() * P); for (const s of sections) if (gStart[s.group] === undefined) { gStart[s.group] = gNext; gNext = (gNext + 1 + Math.floor(R() * Math.max(1, P - 1))) % P; }
    const beatIdx = (t) => { let lo = 0, hi = nb - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (beats[m] < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(beats[lo - 1] - t) < Math.abs(beats[lo] - t) ? lo - 1 : lo; };
    const phraseNo = (t) => Math.floor((beatIdx(t) - phase) / 16);
    const pairFor = (sec, t) => { const k = Math.max(0, phraseNo(t) - phraseNo(sec.t0)); let pr = pairs[(gStart[sec.group] + k * (o.randomness > 0.6 ? 2 : 1)) % P]; if (k % 2 && o.randomness > 0.3) pr = [pr[1], pr[0]]; return pr; };
    const palCols = (pal || pairs.flat()).slice(0, 5);
    const hiBri = o.brightness * 100;
    const owned = (t) => (an.drops || []).some((d) => Math.abs(d.t - t) < iv * 0.6) || (an.builds || []).some((b) => t >= b.t0 - 0.02 && t < b.t1);
    const mul = (k, si) => { if (styleKey === 'random') return 0.3 + Core.rng(o.seed * 131 + si * 17 + hash(k))() * 1.7; const m = STYLE_MUL[styleKey] || {}; return m[k] == null ? 1 : m[k]; };
    // ---- throws: opt-in, rare by default, never back to back ----
    const throwRate = o.throwRate, throwGap = lerp(40, 4, throwRate) * bar; let lastThrow = -1e9, throwK = Math.floor(R() * 8);
    const throwDirs = ['lr', 'rl', 'tb', 'out', 'd1', 'bt', 'in', 'd2'];
    const tryThrow = (t, len, sec, mood) => {
      if (throwRate <= 0 || fxw('throw') <= 0 || !allows('throw', 'transition') || t - lastThrow < throwGap || all.length < 2) return false;
      if (R() > throwRate * (mood === 'quiet' ? 0.5 : 1) * Math.min(1, fxw('throw'))) return false;
      lastThrow = t; const [A, B] = pairFor(sec, t), heavy = throwRate >= 0.75;
      clip('throw', t, len, { dir: o.throwDir === 'auto' || !o.throwDir ? throwDirs[throwK++ % 8] : o.throwDir, span: clamp(4 / o.speed, 1, 6), step: heavy ? 8 : 64, reps: heavy ? 0 : 1, colors: [A, B], bri: hiBri * (mood === 'quiet' ? 0.5 : 0.85), who: o.throwWho || 'all' });
      return true;
    };
    // ---- weighted choice with memory: recently used effects are much less likely ----
    const recent = [];
    const pick = (pool, si, extraBan) => {
      const cand = Object.entries(pool).map(([k, w]) => [k, w * mul(k, si) * fxw(k) * (recent.slice(-2).includes(k) ? 0.12 : recent.slice(-4).includes(k) ? 0.5 : 1) * (extraBan && extraBan.has(k) ? 0.05 : 1)]).filter(([, w]) => w > 0.001);
      if (!cand.length) return null; const tot = cand.reduce((q, [, w]) => q + w, 0); let r = R() * tot * (1 - o.randomness * 0.3) + R() * tot * o.randomness * 0.3;
      for (const [k, w] of cand) { r -= w; if (r <= 0) return k; } return cand[cand.length - 1][0];
    };
    const groupUsed = {}; // effects used the last time each section group (verse A, chorus B...) appeared: the next time is different
    const dropFx = ['explosion', 'blackout', 'snap', 'strobe']; let dropK = 0;

    sections.forEach((sec, si) => {
      if (range && (sec.t1 <= range[0] || sec.t0 >= range[1])) return;
      const e = clamp(sec.energy, 0, 1), quietL = sec.label === 'breakdown' || sec.label === 'intro' || sec.label === 'outro', len = sec.t1 - sec.t0;
      const intensity = 0.35 + 0.65 * (o.intensity * e + (1 - o.intensity) * 0.6);
      let mood = quietL || e < 0.32 ? 'quiet' : sec.vocal && e < 0.75 ? 'vocal' : e >= 0.62 || sec.label === 'drop' || sec.label === 'chorus' ? 'high' : 'mid';
      if (soft && mood !== 'quiet') mood = 'vocal'; // chill / cinematic: energetic parts get fuller, not harder
      const [A0, B0] = pairFor(sec, sec.t0);
      // base colours (the lead rests on a dark partner colour; ambient bulbs glow in it)
      for (const sub of subs) {
        const col = sub.speed === 'medium' ? (sub.li % 2 ? A0 : B0) : B0;
        const bri = hiBri * (quietL ? 0.12 + 0.2 * e : sub.speed === 'fast' ? 0.18 + 0.22 * intensity : 0.4 + 0.45 * intensity);
        const f = sub.speed === 'slow' ? clamp(S0.fade * bar, 0.2, Math.min(len * 0.4, 6)) : S0.hard > 0.7 && !quietL ? 0.05 : clamp(S0.fade * bar * 0.4, 0.1, len * 0.4);
        base(sub, sec.t0, len, quietL ? dim(col, 0.7) : col, bri, f);
      }
      // section transition accent (not at the very start, not where a drop already makes the entrance)
      const used = new Set(), ban = new Set([...(groupUsed['g' + sec.group] || []), ...(groupUsed['l' + sec.label] || [])]); // what this kind of section did last time
      if (si > 0 && !owned(sec.t0) && allowsAny('transition') && R() < (mood === 'high' ? 0.55 : mood === 'mid' ? 0.35 : 0.15) * (0.6 + 0.4 * o.complexity)) {
        const k = pick({ blackout: mood === 'quiet' ? 0.3 : 1, snap: 1, explosion: mood === 'high' ? 1.2 : 0.4, wash: mood === 'quiet' ? 1.5 : 0.3 }, si, ban);
        if (k && allows(k, 'transition')) accent(k, sec, mood, intensity); if (k) used.add(k);
      }
      // phrases: 4 bars each; each gets a rhythm effect for the faster bulbs and (if any) a slow-bulb layer
      const pStarts = []; for (let i = 0; i < nb; i++) if (beats[i] >= sec.t0 - 0.02 && beats[i] < sec.t1 - iv && ((i - phase) % 16 + 16) % 16 === 0) pStarts.push(beats[i]);
      if (!pStarts.length || pStarts[0] - sec.t0 > iv * 2) pStarts.unshift(sec.t0);
      const phraseLen = mood === 'quiet' ? 2 : 1; let lastRhythm = null;
      for (let q = 0; q < pStarts.length; q += phraseLen) {
        const t = pStarts[q], tEnd = q + phraseLen < pStarts.length ? pStarts[q + phraseLen] : sec.t1;
        // skip what builds and drops own
        let a = t, z = tEnd; for (const bu of an.builds || []) { if (bu.t0 <= a && bu.t1 > a) a = bu.t1; if (bu.t0 > a && bu.t0 < z) z = bu.t0; }
        for (const d of an.drops || []) if (d.t >= a - iv * 0.5 && d.t < a + iv * 1.5) a = d.t + iv * 1.5; // the drop's own hit owns its first beats
        if (z - a < iv * 2) continue;
        // rhythm layer
        const pool = { ...MOOD[mood] }; for (const k of Object.keys(pool)) { const ok = mood === 'quiet' || mood === 'vocal' ? allows(k, 'vocal') || allows(k, 'beat') : EFFECTS[k].trig.some((tr) => RHYTHM_ON[tr] && allows(k, tr)) || allows(k, 'beat'); if (!ok) delete pool[k]; }
        if (lastRhythm) pool[lastRhythm] = (pool[lastRhythm] || 0) * 0.1;
        const k = pick(pool, si, ban);
        if (k) { rhythm(k, a, z - a, sec, mood, intensity, has.slow ? 'fastmed' : 'all'); recent.push(k); used.add(k); lastRhythm = k; }
        // slow bulbs: their own, slower layer (stationary unless a throw is chosen)
        if (has.slow) {
          const thrown = q > 0 && tryThrow(a, Math.min(z - a, bar * 4), sec, mood);
          if (!thrown) { const sk = pick(mood === 'quiet' ? { wash: 1.5, ambient: 1.2, hold: 1 } : mood === 'vocal' ? { wash: 1.5, hold: 1, pulse: 0.6 } : { hold: 1, snap: 1.2, alternate: 0.9, wash: 0.8, flash: 0.5 }, si);
            if (sk && sk !== 'hold') slowLayer(sk, a, z - a, sec, mood, intensity); }
        } else if (q > 0) tryThrow(a, Math.min(z - a, bar * 2), sec, mood);
        // phrase-end fill on the fast bulbs
        if (has.fast && mood !== 'quiet' && S0.sparkle * o.complexity > 0.12 && z - a >= bar * 3 && R() < 0.3 + 0.6 * S0.sparkle * o.complexity) {
          const fk = pick({ chase: S0.chase + 0.3, flash: 0.8, strobe: mood === 'high' ? S0.strobe * 0.8 : 0, snap: 0.6 }, si);
          if (fk) { fill(fk, z - bar, bar, sec); used.add(fk); }
        }
      }
      groupUsed['g' + sec.group] = used; groupUsed['l' + sec.label] = used;
    });
    function allowsAny(tr) { return NAMES.some((k) => fxw(k) > 0 && allows(k, tr)); }
    function rhythm(k, t, d, sec, mood, intensity, who) {
      const [A, B] = pairFor(sec, t), hit = hiBri * (0.75 + 0.25 * intensity), S = S0, spd = Math.sqrt(o.speed);
      const kickOn = o.sync >= 0.5 && allows(k, 'bass') && (S.beat === 'kick' || S.beat === 'kicksnare' || R() < 0.35) ? 'kick' : null;
      const beatOn = S.beat === 'offbeat' ? 'offbeat' : S.beat === 'down' || mood === 'quiet' ? 'down' : 'beat';
      const rnd = allows(k, 'random') && !allows(k, 'beat') ? 'random' : null;
      const on = rnd || kickOn || beatOn, density = 0.45 + 0.55 * o.complexity;
      const P = { colors: [A, B], bri: hit, who, rand: o.randomness * 0.5, dyn: clamp(S.contrast * o.intensity, 0, 1) };
      if (k === 'flash') Object.assign(P, { on, step: mood === 'high' ? 1 : 2, prob: density, keepDown: true, decay: clamp(S.decay / spd, 0.25, 3), alt: true, white: S.hard * 0.3 });
      else if (k === 'pulse') Object.assign(P, { on: mood === 'quiet' ? 'step' : on, step: mood === 'quiet' ? 4 : mood === 'vocal' ? 2 : 1, prob: mood === 'high' ? density : 1, depth: clamp(S.contrast * o.intensity + 0.15, 0.2, 0.95), width: 0.9, alt: mood !== 'quiet', bri: mood === 'quiet' ? hiBri * 0.45 : hit });
      else if (k === 'heartbeat') Object.assign(P, { on: 'step', step: mood === 'high' ? 2 : 4, depth: 0.85 });
      else if (k === 'snap') Object.assign(P, { on: beatOn === 'down' ? 'down' : 'beat', step: mood === 'high' ? 1 : 2, split: R() < 0.5, prob: 1, colors: [A, B, toWhite(A, 0.2), B] });
      else if (k === 'alternate') Object.assign(P, { on: kickOn || beatOn, step: 1, by: R() < 0.6 ? 'side' : 'index', mode: R() < 0.65 ? 'color' : 'bright', depth: 0.85 });
      else if (k === 'chase') Object.assign(P, { step: mood === 'high' ? 0.5 : 1, dir: ['lr', 'rl', 'out', 'in', 'd1'][Math.floor(R() * 5)], bounce: R() < 0.5, dimOthers: R() < 0.3 });
      else if (k === 'wave') Object.assign(P, { on: 'step', step: mood === 'quiet' ? 8 : mood === 'vocal' ? 4 : 2, span: mood === 'high' ? 1 : 2, width: mood === 'high' ? 0.8 : 1.6, dir: ['lr', 'out', 'tb', 'd1', 'rl', 'in'][Math.floor(R() * 6)], bounce: true, alt: true, bri: mood === 'quiet' ? hiBri * 0.5 : hit });
      else if (k === 'flicker') Object.assign(P, { speed: 6 + 4 * o.complexity, depth: 0.6, rand: 0.7, bri: hit * 0.9 });
      else if (k === 'wash') Object.assign(P, { step: mood === 'quiet' ? 8 : 4, fade: 0.85, flow: 0.5, colors: palCols, bri: mood === 'quiet' ? hiBri * 0.4 : hiBri * 0.7 });
      else if (k === 'ambient') Object.assign(P, { step: 8, breathe: 0.35, rand: 0.5, colors: palCols, bri: hiBri * (0.25 + 0.2 * (sec.energy || 0.3)) });
      clip(k, t, d, P);
    }
    function slowLayer(k, t, d, sec, mood, intensity) {
      const [A, B] = pairFor(sec, t), b = hiBri * (0.5 + 0.4 * intensity);
      const P = { who: 'slow', colors: [B, A], bri: b };
      if (k === 'snap') Object.assign(P, { on: 'down', step: 2, split: true });
      else if (k === 'alternate') Object.assign(P, { on: 'down', step: 2, by: 'index', mode: 'color' });
      else if (k === 'wash') Object.assign(P, { step: 8, fade: 0.9, flow: 0.6, colors: [B, A, ...palCols.slice(0, 2)], bri: b * (mood === 'quiet' ? 0.6 : 0.9) });
      else if (k === 'ambient') Object.assign(P, { step: 8, rand: 0.5, colors: palCols, bri: b * 0.5 });
      else if (k === 'pulse') Object.assign(P, { on: 'step', step: 8, depth: 0.5 });
      else if (k === 'flash') Object.assign(P, { on: 'down', step: 4, decay: 4, alt: true, prob: 0.8 });
      clip(k, t, d, P);
    }
    function accent(k, sec, mood) {
      const [A, B] = pairFor(sec, sec.t0), t = sec.t0;
      if (k === 'blackout') clip('blackout', Math.max(0, t - iv), iv * 0.95, { ret: 'flash', decay: 1.5, colors: [toWhite(A, 0.3)], bri: hiBri });
      else if (k === 'snap') clip('snap', t, bar, { on: 'beat', step: 1, colors: [A, B], split: true, bri: hiBri, who: 'all' });
      else if (k === 'explosion') clip('explosion', t, bar, { decay: 2.5, white: 0.7, colors: [A, B], bri: hiBri });
      else if (k === 'wash') clip('wash', t, bar * 2, { step: 2, flow: 0.8, colors: [B, A], bri: hiBri * 0.6 });
    }
    function fill(k, t, d, sec) {
      const [A, B] = pairFor(sec, t), P = { colors: [B, A], bri: hiBri, who: 'fast' };
      if (k === 'chase') Object.assign(P, { step: o.complexity > 0.7 ? 0.25 : 0.5, dir: R() < 0.5 ? 'lr' : 'rl', bounce: R() < 0.4 });
      else if (k === 'flash') Object.assign(P, { on: 'step', step: 0.5, decay: 0.4, alt: true, prob: 1 });
      else if (k === 'strobe') { Object.assign(P, { hz: 8, white: 1 }); t += d / 2; d /= 2; }
      else if (k === 'snap') Object.assign(P, { on: 'step', step: 0.5, split: true });
      if (fxw(k) > 0) clip(k, t, d, P);
    }
    // ---- build-ups ----
    for (const b of an.builds || []) {
      if (range && (b.t1 <= range[0] || b.t0 >= range[1])) continue;
      const sec = sections.find((s) => b.t0 >= s.t0 - 0.01 && b.t0 < s.t1) || sections[0], [A, B] = pairFor(sec, b.t0);
      if (fxw('build') > 0) clip('build', b.t0, b.t1 - b.t0, { colors: [A, B], bri: hiBri, white: 0.6, accel: !soft, end: S0.black && R() < S0.black && fxw('blackout') > 0 ? 'blackout' : 'none', keep: true });
    }
    // ---- drops: explosion / blackout-then-snap / strobe-then-snap, varied between drops ----
    (an.drops || []).forEach((d, di) => {
      if (range && (d.t < range[0] || d.t >= range[1])) return;
      const sec = sections.find((s) => d.t >= s.t0 - 0.01 && d.t < s.t1) || sections[0], A = pairs[0][0], B = pairs[0][1];
      let k = o.dropFx && o.dropFx !== 'auto' ? o.dropFx : di === 0 ? 'explosion' : dropFx[(1 + dropK++ + Math.floor(R() * 2)) % dropFx.length];
      if (fxw(k) <= 0) k = ['explosion', 'snap', 'blackout', 'strobe'].find((x) => fxw(x) > 0) || null;
      if (soft && k === 'strobe') k = 'explosion';
      if (k === 'explosion') clip('explosion', d.t, bar * 2, { decay: soft ? 4 : 1.5, white: soft ? 0.5 : 1, split: true, span: 0.5, colors: [A, B], bri: hiBri });
      else if (k === 'blackout') { clip('blackout', Math.max(0, d.t - iv), iv * 0.98, { ret: 'flash', decay: 1, colors: [WHITE], bri: hiBri }); clip('snap', d.t + 0.02, bar * 2, { on: 'beat', step: 1, split: true, colors: [A, B], bri: hiBri }); }
      else if (k === 'snap') clip('snap', d.t, bar * 2, { on: 'beat', step: 0.5, split: true, colors: [A, B, WHITE], bri: hiBri });
      else if (k === 'strobe') { clip('strobe', d.t, iv * 2, { hz: 8, white: 1, bri: hiBri, who: 'fastmed' }); clip('snap', d.t + iv * 2, bar * 2 - iv * 2, { on: 'beat', step: 1, split: true, colors: [A, B], bri: hiBri }); }
      // after the hit, the base settles on the contrast pair split across the room
      if (k !== 'explosion') for (const sub of subs) base(sub, d.t + 0.02, bar * 2, sub.speed === 'slow' ? B : A, hiBri * 0.9, 0.05);
      if (!soft && S0.strobe && o.complexity > 0.3 && k === 'explosion' && has.fast && fxw('strobe') > 0) clip('strobe', d.t + iv * 1.5, iv * 2, { hz: 5, white: 1, bri: hiBri, who: 'fast' });
      if (!soft && S0.chase * o.complexity > 0.2 && all.filter((b) => b.speed === 'fast').length > 1) clip('chase', d.t + bar, iv * 4, { step: 0.25, dir: 'lr', colors: [A, B], bri: hiBri, who: 'fast', reps: 2 });
      void sec;
    });
    events.sort((a, b) => a.t - b.t); clips.sort((a, b) => a.t - b.t);
    return { events, clips };
  }

  // Effect statistics for a show (used by tests and the editor's summary line)
  function stats(clips, dur) { const by = {}; for (const c of clips || []) by[c.fx] = (by[c.fx] || 0) + 1; const thr = by.throw || 0; return { by, kinds: Object.keys(by).length, throws: thr, throwsPerMin: dur ? thr / (dur / 60) : 0 }; }

  return { EFFECTS, NAMES, PARAM, DIRS, ON, FX_DEFAULT, normParams, newClip, makeCtx, expand, materialize, generateShow, triggers, project, stats };
});
