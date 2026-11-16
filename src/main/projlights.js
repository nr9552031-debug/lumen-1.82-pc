'use strict';
// Sends Projection Studio's colour targets to the real lights. Rendering never waits for this: the page posts
// targets a few times a second and each light is updated no faster than its brand can take, exactly like the
// effects engine (same rates, same capability handling, same restore-on-stop).
const { clamp } = require('./util');
const { RATE } = require('./fx');
const diag = require('./diag');
const { createScheduler } = require('../shared/av-sched');
const snapOf = (d) => ({ on: d.on, brightness: d.brightness, rgb: d.rgb, mode: d.mode, kelvin: d.kelvin });
const patchOf = (s) => s.on === false ? { on: false } : { on: true, ...(s.brightness ? { brightness: s.brightness } : {}), ...(s.mode === 'color' && s.rgb ? { rgb: s.rgb } : s.kelvin ? { kelvin: s.kelvin } : {}) };

class ProjLights {
  // latencyOf(id) / intervalOf(id): the per-bulb timing profiles shared with Lightshow (measured or estimated, plus
  // the user's offset). Timed cues use them so every bulb's change is SEEN at the moment the page asked for.
  constructor({ manager, now, rates, latencyOf, intervalOf, timers } = {}) {
    this.m = manager; this.now = now || (() => Number(process.hrtime.bigint() / 1000n) / 1000); this.rates = { ...RATE, ...(rates || {}) };
    this.latencyOf = latencyOf || (() => 0); this.intervalOf = intervalOf || null; this.timers = timers || { set: setInterval, clear: clearInterval };
    this.active = false; this.lights = new Map(); this.snapshot = new Map(); this.sent = {}; this.dropped = []; this.smooth = 0.6; this.lastEmit = 0;
    this.sched = createScheduler({ now: () => this.now() }); this.cueTimer = null; this.cues = 0; this.stopPromise = null;
  }
  status() { return { active: this.active, ids: [...this.lights.keys()], sent: { ...this.sent }, dropped: [...this.dropped], cues: this.cues, sync: this.sched.stats() }; }
  _light(id, dev) {
    let l = this.lights.get(id);
    if (!l) { if (!this.snapshot.has(id)) this.snapshot.set(id, snapOf(dev)); l = { cur: null, lastSent: -1e9, last: null, busy: false, pending: null, fails: 0, holdUntil: 0 }; this.lights.set(id, l); }
    return l;
  }
  _interval(dev) { return Math.max(40, (this.intervalOf && this.intervalOf(dev.id)) || this.rates[dev.brand] || 500); }
  // Timed cues from the page: [{ id, in, rgb, bri, hold }]. 'in' = ms from now until the change should be SEEN.
  // Each bulb is sent early by its own latency, never faster than its rate, and a cue that can no longer arrive in
  // step is dropped (counted as missed) instead of arriving late. The projector is never waited for.
  cue(list) {
    if (!this.active || !Array.isArray(list)) return 0;
    const t = this.now(); let n = 0;
    for (const c of list.slice(0, 400)) {
      const dev = c && this.m.devices.get(c.id); if (!dev || dev.online === false || this.dropped.some((d) => d.id === c.id) || !Array.isArray(c.rgb) || c.rgb.length !== 3) continue;
      const inMs = Math.max(-200, Math.min(20000, Number(c.in) || 0)), iv = this._interval(dev);
      this.sched.output(dev.id, { latency: this.latencyOf(dev.id), interval: iv, maxLate: dev.brand === 'wiz' ? 120 : Math.max(250, iv * 0.5), kind: dev.brand });
      this.sched.at(dev.id, t + inMs, { rgb: c.rgb.map((v) => clamp(Number(v) || 0, 0, 255)), bri: clamp(Number(c.bri) || 1, 1, 100), hold: clamp(Number(c.hold) || 0, 0, 10000) }, { priority: 2 });
      n++;
    }
    if (n && !this.cueTimer) this.cueTimer = this.timers.set(() => this._cueTick(), 10);
    return n;
  }
  _cueTick() {
    if (!this.active || !this.sched.pending()) { if (this.cueTimer) { this.timers.clear(this.cueTimer); this.cueTimer = null; } return; }
    this.sched.tick(this.now(), (id, c) => {
      const dev = this.m.devices.get(id); if (!dev) return true;
      const l = this._light(id, dev); if (l.busy) return false; // still waiting for the cloud: try again until it is too late
      l.cur = { rgb: c.rgb, bri: c.bri }; l.holdUntil = this.now() + c.hold; this.cues++;
      this._out(id, dev, l, this.now(), true); return true;
    });
  }
  start(o = {}) {
    if (!this.active) { this.sent = {}; this.dropped = []; this.cues = 0; this.sched = createScheduler({ now: () => this.now() }); diag.log('proj', 'light sync started'); }
    this.active = true; this.smooth = clamp(Number(o.smooth) || 0, 0, 0.95);
    return this.status();
  }
  // targets: { lightId: { rgb:[r,g,b], bri } }. A light is remembered (for restore) the first time it is driven.
  frame(targets) {
    if (!this.active || !targets || typeof targets !== 'object') return;
    const t = this.now();
    for (const id of Object.keys(targets).slice(0, 200)) {
      const dev = this.m.devices.get(id), tg = targets[id];
      if (!dev || !tg || !Array.isArray(tg.rgb) || tg.rgb.length !== 3 || this.dropped.some((d) => d.id === id)) continue;
      const l = this._light(id, dev);
      if (t < l.holdUntil) continue; // a timed cue is showing: let it be seen
      const want = { rgb: tg.rgb.map((c) => clamp(Number(c) || 0, 0, 255)), bri: clamp(Number(tg.bri) || 1, 1, 100) };
      // ease toward the target so colours glide instead of jumping
      const k = 1 - this.smooth;
      l.cur = l.cur ? { rgb: l.cur.rgb.map((c, i) => c + (want.rgb[i] - c) * k), bri: l.cur.bri + (want.bri - l.cur.bri) * k } : want;
      this._send(id, dev, l, t);
    }
    if (t - this.lastEmit >= 1000) { this.lastEmit = t; this.m._emit(); }
  }
  _send(id, dev, l, t) {
    if (l.busy || t - l.lastSent < this._interval(dev)) return;
    // a timed cue for this bulb is due soon: don't use up its rate allowance now
    for (const q of this.sched.queue) if (q.id === id && q.sendAt - t < this._interval(dev)) return;
    this._out(id, dev, l, t, false);
  }
  _out(id, dev, l, t, forced) {
    const bri = Math.round(l.cur.bri), rgb = l.cur.rgb.map(Math.round);
    if (!forced && l.last && Math.abs(l.last.bri - bri) < 4 && l.last.rgb.every((c, i) => Math.abs(c - rgb[i]) < 12)) return;
    const p = this.m._normalize(dev, { on: true, rgb, brightness: bri }); // drops colour or dimming a light can't do
    l.lastSent = t; l.last = { bri, rgb }; this.sent[dev.brand] = (this.sent[dev.brand] || 0) + 1;
    dev.on = true; if (p.brightness !== undefined) dev.brightness = p.brightness;
    if (p.rgb) { dev.rgb = p.rgb; dev.mode = 'color'; } else if (p.kelvin) { dev.kelvin = p.kelvin; dev.mode = 'white'; }
    const prov = this.m.providers[dev.brand];
    if (typeof prov.fast === 'function') { try { prov.fast(dev, p); } catch {} return; }
    l.busy = true; const t0 = this.now();
    const request = Promise.resolve().then(() => prov.setState(dev, p)).then(() => { l.fails = 0; this.sched.observe(id, this.now() - t0); }, (e) => {
      if (e.authExpired || ++l.fails >= 4) {
        this.dropped.push({ id, name: dev.name, reason: e.message });
        this.lights.delete(id);
        // Keep the original snapshot until stop(): even a bulb we can no longer drive must get its
        // pre-show state back if it becomes reachable again before the show ends.
        this.sched.remove(id);
        diag.log('proj', `dropped ${dev.brand} light: ${e.message}`);
      }
    });
    l.pending = request.finally(() => { l.busy = false; l.pending = null; });
  }
  stop(options = {}) {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this._stop(options).finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }
  async _stop({ restore = true } = {}) {
    if (!this.active && !this.snapshot.size) return this.status();
    this.active = false; this.sched.clear(); if (this.cueTimer) { this.timers.clear(this.cueTimer); this.cueTimer = null; }
    const lights = [...this.lights.values()]; this.lights = new Map();
    await Promise.allSettled(lights.map((l) => l.pending).filter(Boolean)); // restore only after every in-flight output settles
    const snap = this.snapshot; this.snapshot = new Map();
    if (restore) await Promise.allSettled([...snap].map(([id, s]) => this.m.devices.has(id) ? this.m.apply([id], patchOf(s)) : null));
    const ss = this.sched.stats(), miss = Object.values(ss).reduce((a, x) => a + x.missed, 0);
    diag.log('proj', `light sync stopped sent=${JSON.stringify(this.sent)} cues=${this.cues} missed=${miss}`);
    this.m._emit();
    return this.status();
  }
}
module.exports = { ProjLights };
