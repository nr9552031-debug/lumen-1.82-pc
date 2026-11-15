'use strict';
// Plays a compiled lightshow. The page plays the music; both sides share one clock (wall time on this PC):
// the page tells us the wall time at which song position `from` will be HEARD, and every bulb command is sent at
// (that moment + command time - the bulb's latency). The page re-anchors us every couple of seconds from the real
// audio position, so long songs do not drift. Nothing is assumed to have worked just because it was sent:
// cloud bulbs (Cync, Hubspace) are counted only when the service confirms, failures are counted and a bulb that keeps
// failing is taken out of the show; WiZ commands are single UDP packets with no reply, so they are counted as
// "unconfirmed" and each WiZ bulb is asked for its real state every few seconds instead.
const Core = require('../shared/show-core');
const diag = require('./diag');

const snapOf = (d) => ({ on: d.on, brightness: d.brightness, rgb: d.rgb, mode: d.mode, kelvin: d.kelvin });
const patchOf = (s) => s.on === false ? { on: false } : { on: true, ...(s.brightness ? { brightness: s.brightness } : {}), ...(s.mode === 'color' && s.rgb ? { rgb: s.rgb } : s.kelvin ? { kelvin: s.kelvin } : {}) };

class ShowPlayer {
  constructor({ manager, now, profiles, healthEvery } = {}) {
    this.m = manager; this.now = now || Date.now; this.profiles = profiles || (() => ({}));
    this.state = 'idle'; this.q = []; this.idx = 0; this.timer = null; this.anchor = 0; this.lights = new Map(); this.snapshot = new Map();
    this.dropped = []; this.warnings = []; this.lastEmit = 0; this.healthEvery = healthEvery === undefined ? 4000 : healthEvery; this.hTimer = null; this.plan = null; this.pausedAt = 0;
  }
  devInfo() {
    const out = {}, prof = this.profiles();
    for (const d of this.m.devices.values()) out[d.id] = { brand: d.brand, name: (this.m._meta(d.id).name || d.name), caps: this.m._meta(d.id).caps || d.caps, online: d.online !== false, enabled: (prof[d.id] || {}).enabled !== false, profile: prof[d.id] };
    return out;
  }
  compile(show, from = 0) { return Core.compile(show, this.devInfo(), this.profiles(), { from }); }
  pos() { return this.state === 'playing' ? (this.now() - this.anchor) / 1000 : this.pausedAt; }
  // Returns { heardAt } = wall time (ms) when song position `from` must be heard. lead = extra ms the page needs to start audio.
  start({ show, from = 0, lead = 250 } = {}) {
    if (!show || !Array.isArray(show.events) || !Array.isArray(show.lanes)) throw new Error('No show to play');
    this._clear();
    const plan = this.plan = this.compile(show, from);
    this.warnings = plan.warnings;
    const catchup = plan.cmds.filter((c) => c.catchup), q = plan.cmds.filter((c) => !c.catchup && c.t >= from - 1e-6);
    const earliest = q.length ? Math.min(...q.slice(0, 400).map((c) => c.at)) : from, preRoll = Math.max(0, (from - earliest) * 1000);
    const heardAt = this.now() + Math.round(preRoll + lead);
    this.anchor = heardAt - from * 1000; this.q = q; this.idx = 0; this.state = 'playing'; this.endT = plan.endT;
    for (const id of Object.keys(plan.per)) if (!this.snapshot.has(id) && this.m.devices.has(id)) this.snapshot.set(id, snapOf(this.m.devices.get(id)));
    for (const id of Object.keys(plan.per)) if (!this.lights.has(id)) this.lights.set(id, { sent: 0, acked: 0, failed: 0, unconfirmed: 0, coalesced: 0, lateSkipped: 0, fails: 0, busy: false, pending: null, rtt: [], health: null, miss: 0, mismatch: 0, last: null, lastAt: 0 });
    for (const c of catchup) this._dispatch(c); // put every bulb in the right state for where we start, right away
    this._pump();
    if (this.healthEvery) this.hTimer = setInterval(() => this._health(), this.healthEvery);
    diag.log('show', `start from=${from.toFixed(2)} cmds=${q.length} preRoll=${Math.round(preRoll)}ms bulbs=${Object.keys(plan.per).length}`);
    return { heardAt, preRoll: Math.round(preRoll), per: plan.per, warnings: plan.warnings, cmds: q.length };
  }
  // The page reports where the music really is. Small differences are jitter; larger ones mean the audio drifted.
  sync(pos, wall) {
    if (this.state !== 'playing' || typeof pos !== 'number') return;
    const a = (wall || this.now()) - pos * 1000, d = a - this.anchor;
    if (Math.abs(d) > 1500) return; // nonsense (e.g. a seek is in flight)
    if (Math.abs(d) > 12) { this.anchor += d * 0.6; this.drift = Math.round(d); }
  }
  _pump() {
    clearTimeout(this.timer); this.timer = null;
    if (this.state !== 'playing') return;
    const now = this.now(), due = [];
    while (this.idx < this.q.length && this.anchor + this.q[this.idx].at * 1000 <= now + 2) due.push(this.q[this.idx++]);
    // if we fell behind (PC busy), only the newest command per bulb is worth sending
    const newest = new Map(); for (const c of due) newest.set(c.id, c);
    for (const c of due) { if (newest.get(c.id) !== c && now - (this.anchor + c.at * 1000) > 120) { const l = this.lights.get(c.id); if (l) l.lateSkipped++; continue; } this._dispatch(c); }
    if (now - this.lastEmit > 4000) { this.lastEmit = now; this.m._emit(); } // the page re-draws on every emit; keep it rare mid-show
    if (this.idx >= this.q.length) { if (this.anchor + (this.endT + 1) * 1000 < now) { this.state = 'ended'; diag.log('show', 'ended ' + JSON.stringify(this.summary())); } else this.timer = setTimeout(() => this._pump(), 200); return; }
    const wait = this.anchor + this.q[this.idx].at * 1000 - now;
    this.timer = setTimeout(() => this._pump(), Math.max(0, Math.min(100, wait - 1)));
  }
  _dispatch(c) {
    const dev = this.m.devices.get(c.id), l = this.lights.get(c.id);
    if (!dev || !l || this.dropped.some((d) => d.id === c.id)) return;
    const p = this.m._normalize(dev, c.off ? { on: false } : { on: true, rgb: c.rgb, brightness: Math.max(1, c.bri) });
    l.last = c; l.lastAt = this.now();
    dev.on = p.on !== false; if (p.brightness !== undefined) dev.brightness = p.brightness;
    if (p.rgb) { dev.rgb = p.rgb; dev.mode = 'color'; } else if (p.kelvin) { dev.kelvin = p.kelvin; dev.mode = 'white'; }
    const prov = this.m.providers[dev.brand];
    if (typeof prov.fast === 'function') { try { prov.fast(dev, p); l.sent++; l.unconfirmed++; } catch (e) { l.failed++; } return; }
    if (l.busy) { if (l.pending) l.coalesced++; l.pending = p; return; } // newest wins; never stack requests on a slow bulb
    this._send(c.id, dev, prov, l, p);
  }
  _send(id, dev, prov, l, p) {
    l.busy = true; l.sent++; const t0 = this.now();
    Promise.resolve().then(() => prov.setState(dev, p)).then(() => { l.acked++; l.fails = 0; l.rtt.push(this.now() - t0); if (l.rtt.length > 50) l.rtt.shift(); }, (e) => {
      l.failed++;
      if (e && e.authExpired || ++l.fails >= 4) { this.dropped.push({ id, name: dev.name, reason: e ? e.message : 'no reply' }); diag.log('show', `dropped ${dev.brand} light: ${e ? e.message : ''}`); }
    }).finally(() => {
      l.busy = false;
      if (l.pending && (this.state === 'playing') && !this.dropped.some((d) => d.id === id)) { const n = l.pending; l.pending = null; this._send(id, dev, prov, l, n); } else l.pending = null;
    });
  }
  async _health() { // WiZ only: confirm the bulb is answering and roughly showing what we asked for
    if (this.state !== 'playing') return;
    for (const [id, l] of this.lights) {
      const dev = this.m.devices.get(id); if (!dev || dev.brand !== 'wiz' || !this.m.providers.wiz.refresh) continue;
      const sentAt = l.lastAt, want = l.last;
      this.m.providers.wiz.refresh(dev).then((r) => {
        l.health = r && r.online ? 'answering' : 'no reply';
        if (!r || !r.online) { l.miss++; return; } l.miss = 0;
        if (want && this.now() - sentAt > 500 && l.lastAt === sentAt && !want.off && r.rgb && want.rgb.some((v, i) => Math.abs(v - r.rgb[i]) > 70)) l.mismatch++;
      }).catch(() => { l.health = 'no reply'; l.miss++; });
    }
  }
  pause() {
    if (this.state !== 'playing') return this.status();
    this.pausedAt = this.pos(); this._clear(); this.state = 'paused'; // lights hold where they are
    return this.status();
  }
  _clear() { clearTimeout(this.timer); this.timer = null; clearInterval(this.hTimer); this.hTimer = null; for (const l of this.lights.values()) l.pending = null; }
  async stop({ restore = true } = {}) {
    const was = this.state; this._clear(); this.state = 'idle';
    const lights = [...this.lights.values()];
    for (let i = 0; i < 40 && lights.some((l) => l.busy); i++) await new Promise((r) => setTimeout(r, 50));
    const sum = this.summary(), snap = this.snapshot; this.snapshot = new Map(); this.lights = new Map(); this.q = [];
    if (restore && was !== 'idle') await Promise.allSettled([...snap].map(([id, s]) => this.m.devices.has(id) ? this.m.apply([id], patchOf(s)) : null));
    if (was !== 'idle') diag.log('show', `stopped ${JSON.stringify(sum)}`);
    this.m._emit();
    return { ...this.status(), last: sum };
  }
  summary() {
    const per = {};
    for (const [id, l] of this.lights) { const r = [...l.rtt].sort((a, b) => a - b); per[id] = { sent: l.sent, acked: l.acked, failed: l.failed, unconfirmed: l.unconfirmed, coalesced: l.coalesced, lateSkipped: l.lateSkipped, ackMs: r.length ? r[r.length >> 1] : null, health: l.health, mismatch: l.mismatch }; }
    return per;
  }
  status() { return { state: this.state, pos: this.pos(), per: this.summary(), plan: this.plan ? this.plan.per : null, dropped: [...this.dropped], warnings: this.warnings, drift: this.drift || 0 }; }
}

// Calibration: time how long each bulb takes to confirm a command that changes nothing visible (re-sending its
// current state), or, for WiZ, to answer a status request. That is network + cloud delay; it is turned into a
// latency ESTIMATE. The light's own fade/LED response is not measurable without a light sensor, so the flash test
// plus manual offsets are there to fine-tune by eye and ear.
async function measureLatency(manager, ids, { tries = 4, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const out = {};
  for (const id of ids) {
    const dev = manager.devices.get(id); if (!dev) continue;
    const prov = manager.providers[dev.brand], rtts = []; let errors = 0;
    for (let i = 0; i < tries; i++) {
      const t0 = now();
      try {
        if (dev.brand === 'wiz') { const r = await prov.refresh(dev); if (!r || !r.online) throw new Error('no reply'); }
        else await prov.setState(dev, manager._normalize(dev, patchOf(snapOf(dev))));
        rtts.push(now() - t0);
      } catch { errors++; }
      await wait(dev.brand === 'hubspace' ? 2600 : dev.brand === 'cync' ? 600 : 150);
    }
    if (!rtts.length) { out[id] = { ok: false, errors }; continue; }
    rtts.sort((a, b) => a - b); const med = rtts[rtts.length >> 1];
    const ms = Math.round(dev.brand === 'wiz' ? med / 2 + 30 : med * 0.75);
    out[id] = { ok: true, ms, rtt: { min: rtts[0], med, max: rtts[rtts.length - 1] }, errors, n: rtts.length };
  }
  return out;
}

module.exports = { ShowPlayer, measureLatency, snapOf, patchOf };
