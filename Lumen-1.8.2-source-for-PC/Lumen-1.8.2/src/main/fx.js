'use strict';
// Effects engine: lighting OUTPUT only. Signal analysis happens in the page (audio-analysis.js), which sends small
// "feature" frames here. This side turns them into per-light colours and sends them no faster than each brand can
// take, so slow cloud bulbs never hold up the analysis or each other.
const { clamp, statePatch, hsvToRgb, lerpRgb, num, rgbOk, rgb: cleanRgb } = require('./util');
const diag = require('./diag');

const PALETTES = {
  neon:    [[255, 0, 140], [0, 200, 255], [150, 70, 255], [255, 110, 0]],
  sunset:  [[255, 70, 20], [255, 150, 30], [255, 40, 100], [170, 50, 220]],
  ocean:   [[0, 110, 255], [0, 220, 200], [70, 80, 255], [0, 255, 150]],
  forest:  [[40, 220, 80], [160, 230, 40], [0, 180, 140], [255, 200, 60]],
  fire:    [[255, 50, 0], [255, 120, 0], [255, 25, 10], [255, 170, 30]],
  rainbow: [[255, 0, 0], [255, 160, 0], [220, 255, 0], [0, 255, 80], [0, 200, 255], [60, 60, 255], [200, 0, 255]],
};
// audio: needs analysed frames from the page. Otherwise the engine runs the effect on its own timer.
const MODES = {
  pulse:     { audio: true,  name: 'Pulse',        desc: 'Brightness rides the bass; colours step through the palette.' },
  bass:      { audio: true,  name: 'Bass',         desc: 'Only the low end moves the lights.' },
  treble:    { audio: true,  name: 'Treble',       desc: 'Only the high end (hi-hats, vocals) moves the lights.' },
  spectrum:  { audio: true,  name: 'Multi-band',   desc: 'Each light takes a slice: bass, mids or highs.' },
  bands:     { audio: true,  name: 'Colour map',   desc: 'Your own colour for bass, mids and highs, mixed by what is playing.' },
  party:     { audio: true,  name: 'Beat',         desc: 'Every beat throws each light to a new colour.' },
  cycle:     { audio: true,  name: 'Colour cycle', desc: 'Colours rotate; louder music turns them faster.' },
  ambient:   { audio: true,  name: 'Ambient',      desc: 'Slow, smooth response for background listening.' },
  strobe:    { audio: true,  name: 'Strobe',       desc: 'Flashes on the beat, limited to 2 a second.', strobe: true },
  screen:    { audio: true,  name: 'Screen match', desc: 'Lights follow the main colour on your screen.', noPalette: true },
  aurora:    { audio: false, name: 'Aurora',       desc: 'Slow drift through the palette.' },
  breathing: { audio: false, name: 'Breathing',    desc: 'Brightness rises and falls gently.' },
  rainbow:   { audio: false, name: 'Rainbow',      desc: 'Every light walks round the colour wheel.', noPalette: true },
  candle:    { audio: false, name: 'Candle',       desc: 'Warm flicker.', noPalette: true },
  fireplace: { audio: false, name: 'Fireplace',    desc: 'Deeper reds and oranges with the odd flare.', noPalette: true },
  storm:     { audio: false, name: 'Storm',        desc: 'Dim blue-grey with occasional lightning.', noPalette: true },
  sunrise:   { audio: false, name: 'Sunrise',      desc: 'Deep red to warm daylight over 10 minutes, then holds.', noPalette: true },
  sunset:    { audio: false, name: 'Sunset',       desc: 'Warm daylight down to a dim ember over 10 minutes, then holds.', noPalette: true },
};
// Minimum milliseconds between commands to one light. WiZ is local UDP. Cync goes through its cloud relay.
// Hubspace is one cloud HTTPS request per change, so it only gets a slow, smoothed version of any show.
const RATE = { wiz: 90, cync: 500, hubspace: 2500 };
const MIN_BEAT_GAP = 350;   // colour jumps stay under 3 a second
const MIN_STROBE_GAP = 500; // strobe flashes stay at 2 a second or fewer (well under the 3 Hz photosensitivity guideline)
const BANDS = ['bass', 'mid', 'treble'];
const lerp = (a, b, k) => a + (b - a) * k;
const snapOf = (d) => ({ on: d.on, brightness: d.brightness, rgb: d.rgb, mode: d.mode, kelvin: d.kelvin });
const SUN = [[0, [255, 30, 0], 0.03], [0.3, [255, 80, 10], 0.25], [0.6, [255, 150, 60], 0.6], [1, [255, 214, 170], 1]]; // position, colour, brightness
function sunAt(k) { for (let i = 1; i < SUN.length; i++) if (k <= SUN[i][0]) { const a = SUN[i - 1], b = SUN[i], t = (k - a[0]) / (b[0] - a[0]); return { rgb: lerpRgb(a[1], b[1], t), b: lerp(a[2], b[2], t) }; } return { rgb: SUN[3][1], b: 1 }; }

// Validates options coming from the page (also what gets saved as the user's last choice).
function normalize(o) {
  o = o || {};
  const maxB = clamp(Math.round(Number(o.brightness) || 100), 10, 100), bc = o.bandColors || {};
  const custom = Array.isArray(o.colors) ? o.colors.filter(rgbOk).slice(0, 8).map(cleanRgb) : [];
  return {
    mode: MODES[o.mode] ? o.mode : 'pulse',
    palette: o.palette === 'custom' && custom.length ? 'custom' : PALETTES[o.palette] ? o.palette : 'neon',
    colors: custom,
    sensitivity: num(o.sensitivity, 0.3, 3, 1),
    smoothing: num(o.smoothing, 0, 0.95, 0.5),
    intensity: num(o.intensity, 0.1, 1, 1),
    speed: num(o.speed, 0.25, 4, 1),
    brightness: maxB,
    minBrightness: Math.min(maxB, clamp(Math.round(num(o.minBrightness, 1, 100, 15)), 1, 100)),
    bandColors: { bass: rgbOk(bc.bass) ? cleanRgb(bc.bass) : [255, 30, 40], mid: rgbOk(bc.mid) ? cleanRgb(bc.mid) : [40, 255, 90], treble: rgbOk(bc.treble) ? cleanRgb(bc.treble) : [60, 110, 255] },
    perLight: Object.fromEntries(Object.entries(o.perLight && typeof o.perLight === 'object' ? o.perLight : {}).filter(([k, v]) => typeof k === 'string' && ['auto', 'bass', 'mid', 'treble', 'level'].includes(v)).slice(0, 200)),
    strobeOk: !!o.strobeOk,
    // used by the page's audio capture; kept here so the whole choice is saved in one place
    source: o.source === 'mic' ? 'mic' : 'system', micId: typeof o.micId === 'string' ? o.micId.slice(0, 200) : '',
    edges: { low: num((o.edges || {}).low, 60, 400, 180), high: num((o.edges || {}).high, 800, 6000, 2000) },
    ids: [...new Set(Array.isArray(o.ids) ? o.ids.filter((x) => typeof x === 'string') : [])].slice(0, 200),
  };
}

class FxEngine {
  constructor({ manager, now, rand, rates } = {}) {
    this.m = manager; this.now = now || Date.now; this.rand = rand || Math.random;
    this.rates = { ...RATE, ...(rates || {}) };
    this.active = false; this.lights = []; this.snapshot = new Map(); this.dropped = [];
    this.c = normalize({}); this.mode = this.c.mode;
    this.sent = { wiz: 0, hubspace: 0, cync: 0 }; this.timer = null; this.lastEmit = 0;
  }
  get pal() { return this.c.palette === 'custom' ? this.c.colors : PALETTES[this.c.palette]; }
  status() {
    return { active: this.active, ...this.c, ids: this.lights.map((l) => l.id), sent: { ...this.sent }, dropped: [...this.dropped], rates: { ...this.rates }, palettes: PALETTES,
      modes: Object.entries(MODES).map(([id, m]) => ({ id, ...m })) };
  }
  // What each light is being asked to show right now (for the on-screen preview), whether or not it was sent yet.
  preview() { return this.lights.map((l) => ({ id: l.id, rgb: l.tgt ? l.tgt.rgb.map(Math.round) : null, bri: l.tgt ? Math.round(l.tgt.brightness) : 0 })); }
  _configure(o) {
    const c = normalize(o);
    if (MODES[c.mode].strobe && !c.strobeOk) throw new Error('Strobe flashes the lights. Tick the confirmation under Strobe first.');
    const ids = c.ids.filter((id) => this.m.devices.has(id));
    if (!ids.length) throw new Error('Pick at least one light for the show');
    if (this.mode !== c.mode) this.t0 = this.now();
    this.c = c; this.mode = c.mode;
    // A light that leaves the show gets its own state back; one that joins has its state remembered first.
    const leaving = this.lights.filter((l) => !ids.includes(l.id)).map((l) => l.id);
    for (const id of ids) if (!this.snapshot.has(id)) this.snapshot.set(id, snapOf(this.m.devices.get(id)));
    const old = new Map(this.lights.map((l) => [l.id, l]));
    this.lights = ids.map((id, i) => Object.assign(old.get(id) || { id, lastSent: -1e9, last: null, tgt: null, busy: false, fails: 0, env: 0, flick: 0.6, flash: -1e9 }, { i }));
    if (leaving.length) this._restore(leaving);
    clearInterval(this.timer); this.timer = null;
    if (!MODES[this.mode].audio) { this.timer = setInterval(() => this._tick(null), 100); if (this.timer.unref) this.timer.unref(); }
  }
  start(o) {
    if (!this.active) { this.sent = { wiz: 0, hubspace: 0, cync: 0 }; this.dropped = []; this.env = 0; this.slow = 0; this.beats = 0; this.hue = 0; this.lastBeat = -1e9; this.lastFlash = -1e9; this.nextBolt = 0; this.t0 = this.now(); this.lastTick = this.now(); this.mode = null; }
    const was = this.active;
    this._configure(o);
    if (!was) diag.log('fx', `start mode=${this.mode} lights=${this.lights.length}`);
    this.active = true;
    return this.status();
  }
  update(o) { if (this.active) { const m = this.mode; this._configure(o); if (m !== this.mode) diag.log('fx', `mode -> ${this.mode}`); } return this.status(); }
  // One analysed frame from the page: { bass, mid, treble, level (0..1), beat, silent, screen: [r,g,b] | null }
  frame(f) { if (this.active && MODES[this.mode].audio && f) this._tick(f); }

  _tick(f) {
    if (!this.active) return;
    const t = this.now(), dt = clamp(t - this.lastTick, 0, 1000); this.lastTick = t;
    if (f) {
      const c = this.c, src = this.mode === 'bass' ? f.bass : this.mode === 'treble' ? f.treble : (this.mode === 'spectrum' || this.mode === 'bands' || this.mode === 'cycle' || this.mode === 'ambient') ? f.level : f.bass * 0.7 + f.level * 0.3;
      const drive = clamp(src * c.sensitivity, 0, 1);
      const rel = 0.55 + 0.43 * c.smoothing, att = 1 - c.smoothing * 0.75; // more smoothing: slower rise and fall, no flicker
      this.env = drive > this.env ? this.env + (drive - this.env) * att : this.env * rel + drive * (1 - rel);
      this.slow = this.slow * 0.96 + drive * 0.04;                         // what cloud lights follow
      if (f.beat && t - this.lastBeat >= MIN_BEAT_GAP) { this.lastBeat = t; this.beats++; if (this.mode === 'cycle') this.hue += 25; }
      if (this.mode === 'cycle') this.hue = (this.hue + dt * 0.02 * c.speed * (0.3 + 2 * this.env)) % 360;
      if (this.mode === 'strobe' && f.beat && t - this.lastFlash >= MIN_STROBE_GAP) this.lastFlash = t;
    }
    for (const l of [...this.lights]) { const tgt = this._target(l, f, t); if (tgt) { l.tgt = tgt; this._send(l, tgt, t); } }
    if (t - this.lastEmit >= 1000) { this.lastEmit = t; this.m._emit(); }
  }
  _band(l) { const pick = this.c.perLight[l.id]; return pick && pick !== 'auto' ? pick : null; }
  _target(l, f, t) {
    const dev = this.m.devices.get(l.id); if (!dev) return null;
    const c = this.c, pal = this.pal, n = this.lights.length, maxB = c.brightness, minB = c.minBrightness, el = (t - this.t0) * c.speed;
    const slowLight = (this.rates[dev.brand] || 500) >= 400;
    // A light pinned to one band follows that band instead of the overall drive.
    const own = f && this._band(l);
    let lvl = slowLight ? clamp(this.slow * 1.7, 0, 1) : this.env;
    if (own && f) { const v = clamp(f[own] * c.sensitivity, 0, 1); l.env = v > l.env ? v : l.env * 0.8 + v * 0.2; if (!slowLight) lvl = l.env; }
    const bri = (k) => lerp(minB, maxB, clamp(k, 0, 1) * c.intensity + (1 - c.intensity) * 0.6); // intensity: how deep the swing is
    switch (this.mode) {
      case 'pulse': return { rgb: pal[(Math.floor(this.beats / 4) + l.i) % pal.length], brightness: bri(lvl) };
      case 'bass': return { rgb: c.bandColors.bass, brightness: bri(lvl) };
      case 'treble': return { rgb: c.bandColors.treble, brightness: bri(lvl) };
      case 'party': { // every beat throws each light to its next colour, then it eases back until the next one
        const k = slowLight ? 0.7 : Math.exp(-(t - this.lastBeat) / 450);
        return { rgb: pal[(this.beats + l.i) % pal.length], brightness: bri(0.4 + 0.6 * k) };
      }
      case 'spectrum': { // each light takes a band (its own choice, or dealt out in order)
        const band = own || BANDS[l.i % 3];
        if (!own) { const v = clamp(f[band] * c.sensitivity, 0, 1); l.env = v > l.env ? v : l.env * 0.8 + v * 0.2; }
        return { rgb: n === 1 && !own ? this._mix(f, c.bandColors) : pal[l.i % pal.length], brightness: bri(slowLight ? lvl : l.env) };
      }
      case 'bands': return { rgb: own ? c.bandColors[own] || this._mix(f, c.bandColors) : this._mix(f, c.bandColors), brightness: bri(lvl) };
      case 'cycle': return { rgb: hsvToRgb([this.hue + l.i * (360 / Math.max(n, 3)), 1, 1]), brightness: bri(0.35 + 0.65 * lvl) };
      case 'ambient': { // slow and smooth: drifts through the palette, brightness follows the long average
        const pos = ((el / 14000 + l.i / Math.max(n, 2)) % 1) * pal.length, a = pal[Math.floor(pos) % pal.length], b = pal[(Math.floor(pos) + 1) % pal.length];
        return { rgb: lerpRgb(a, b, pos - Math.floor(pos)), brightness: bri(0.3 + 0.7 * clamp(this.slow * 1.7, 0, 1)) };
      }
      case 'strobe': { // a short flash per beat; cloud lights can't flash, so they hold a steady colour
        if (slowLight) return { rgb: pal[l.i % pal.length], brightness: lerp(minB, maxB, 0.6) };
        const on = t - this.lastFlash < 130;
        return on ? { rgb: [255, 255, 255], brightness: maxB, flash: true } : { rgb: pal[(this.beats + l.i) % pal.length], brightness: minB };
      }
      case 'screen': {
        if (!f.screen) return { rgb: l.last ? l.last.rgb : [255, 255, 255], brightness: minB }; // black screen: dim, keep colour
        const [r, g, b] = f.screen, lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return { rgb: f.screen, brightness: lerp(minB, maxB, clamp(lum * 1.8, 0, 1)) };
      }
      case 'aurora': {
        const pos = ((el / 9000 + l.i / Math.max(n, 2)) % 1) * pal.length, a = pal[Math.floor(pos) % pal.length], b = pal[(Math.floor(pos) + 1) % pal.length];
        return { rgb: lerpRgb(a, b, pos - Math.floor(pos)), brightness: lerp(minB, maxB, 0.78 + 0.22 * Math.sin(el / 2600 + l.i * 1.7)) };
      }
      case 'breathing': return { rgb: pal[l.i % pal.length], brightness: lerp(minB, maxB, 0.5 - 0.5 * Math.cos(el / 800 + l.i * 0.6)) };
      case 'rainbow': return { rgb: hsvToRgb([el / 55 + l.i * (360 / Math.max(n, 3)), 1, 1]), brightness: maxB };
      case 'candle': l.flick = l.flick * 0.55 + this.rand() * 0.45; return { rgb: [255, 110 + 50 * l.flick, 18 + 22 * l.flick], brightness: lerp(Math.max(minB, maxB * 0.45), maxB, l.flick) };
      case 'fireplace': { l.flick = l.flick * 0.7 + this.rand() * 0.3; const flare = this.rand() > 0.97 ? 1 : l.flick; return { rgb: [255, 40 + 90 * flare, 4 + 14 * flare], brightness: lerp(Math.max(minB, maxB * 0.3), maxB, flare) }; }
      case 'storm': { // lightning: a brief white flash at random intervals of several seconds (far below any strobe rate)
        if (t >= this.nextBolt) { this.lastFlash = t; this.nextBolt = t + (4000 + this.rand() * 9000) / c.speed; this.boltOn = Math.floor(this.rand() * n); }
        const hit = t - this.lastFlash < 180 && !slowLight && (l.i === this.boltOn || n < 3);
        return hit ? { rgb: [235, 240, 255], brightness: maxB } : { rgb: [40, 60, 120], brightness: lerp(minB, maxB, 0.12 + 0.05 * Math.sin(el / 3000 + l.i)) };
      }
      case 'sunrise': { const s = sunAt(clamp(el / 600000, 0, 1)); return { rgb: s.rgb, brightness: lerp(minB, maxB, s.b) }; }
      case 'sunset': { const s = sunAt(1 - clamp(el / 600000, 0, 1)); return { rgb: s.rgb, brightness: lerp(minB, maxB, s.b) }; }
    }
    return null;
  }
  // Colour for the current sound: the band colours mixed by how much of each band is playing.
  _mix(f, bc) {
    const w = BANDS.map((k) => Math.pow(f[k], 2)), sum = w[0] + w[1] + w[2];
    if (sum < 1e-4) return bc.bass;
    return [0, 1, 2].map((ch) => (bc.bass[ch] * w[0] + bc.mid[ch] * w[1] + bc.treble[ch] * w[2]) / sum);
  }
  _send(l, tgt, t) {
    const dev = this.m.devices.get(l.id); if (!dev) return;
    if (l.busy || t - l.lastSent < (this.rates[dev.brand] || 500)) return;
    // The flash limit is enforced on what is actually sent, so rate-limit jitter can never squeeze two flashes together.
    if (tgt.flash) { if (t - l.flash < MIN_STROBE_GAP) return; l.flash = t; }
    const bri = clamp(Math.round(tgt.brightness), 1, 100), rgb = tgt.rgb.map((x) => clamp(Math.round(x), 0, 255));
    if (l.last && Math.abs(l.last.bri - bri) < 4 && l.last.rgb.every((c, i) => Math.abs(c - rgb[i]) < 12)) return; // nothing visible to change
    const p = this.m._normalize(dev, { on: true, rgb, brightness: bri }); // drops colour/dimming a light can't do
    l.lastSent = t; l.last = { bri, rgb }; this.sent[dev.brand] = (this.sent[dev.brand] || 0) + 1;
    dev.on = true; if (p.brightness !== undefined) dev.brightness = p.brightness;
    if (p.rgb) { dev.rgb = p.rgb; dev.mode = 'color'; } else if (p.kelvin) { dev.kelvin = p.kelvin; dev.mode = 'white'; }
    const prov = this.m.providers[dev.brand];
    if (typeof prov.fast === 'function') { try { prov.fast(dev, p); } catch {} return; }
    l.busy = true; // cloud lights: never stack a second request on one that is still in flight
    Promise.resolve().then(() => prov.setState(dev, p)).then(() => { l.fails = 0; }, (e) => {
      if (e.authExpired || ++l.fails >= 4) this._drop(l, dev, e);
    }).finally(() => { l.busy = false; });
  }
  // A light that keeps failing is taken out of the show instead of hammering its cloud.
  _drop(l, dev, e) {
    if (!this.lights.includes(l)) return;
    this.lights = this.lights.filter((x) => x !== l).map((x, i) => Object.assign(x, { i }));
    this.dropped.push({ id: l.id, name: this.m._meta(l.id).name || dev.name, reason: e.message });
    this.snapshot.delete(l.id);
    diag.log('fx', `dropped ${dev.brand} light from the show: ${e.message}`);
  }
  _restore(ids) {
    return Promise.allSettled(ids.map((id) => {
      const s = this.snapshot.get(id); this.snapshot.delete(id);
      return s && this.m.devices.has(id) ? this.m.apply([id], statePatch(s)) : null;
    }));
  }
  async stop({ restore = true } = {}) {
    if (!this.active) return this.status();
    this.active = false; clearInterval(this.timer); this.timer = null;
    const lights = this.lights; this.lights = [];
    for (let i = 0; i < 30 && lights.some((l) => l.busy); i++) await new Promise((r) => setTimeout(r, 50));
    diag.log('fx', `stop sent=${JSON.stringify(this.sent)}`);
    if (restore) await this._restore([...this.snapshot.keys()]); else this.snapshot.clear();
    this.m._emit();
    return this.status();
  }
}
module.exports = { FxEngine, normalize, PALETTES, MODES, RATE, MIN_BEAT_GAP, MIN_STROBE_GAP };
