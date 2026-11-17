'use strict';
// WiZ: fully LOCAL control over UDP port 38899. No account, no cloud.
const dgram = require('dgram');
const os = require('os');
const { clamp, sleep } = require('../util');
const diag = require('../diag');

const PORT = 38899;

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
      const ip = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
      out.add(ip.map((o, k) => (o | (~m[k] & 255))).join('.'));
    }
  }
  return [...out];
}

class WizProvider {
  constructor(opts = {}) {
    this.brand = 'wiz';
    this.port = opts.port || PORT;
    this.broadcasts = opts.broadcasts || broadcastAddresses();
    this.pending = new Map();
    this.collector = null;
    this.sock = null;
    this.ips = new Map(); // deviceId -> ip
    this.netError = null; // last socket/send error { code, ip, at }: lets a failed command say WHY (e.g. macOS blocking the local network)
    this._errLogAt = {};
  }
  // Socket and send errors used to be swallowed, so a blocked network looked like "the bulb did not respond". Record them,
  // log each kind at most every 30 s, and keep the latest so a failed command can report it.
  _netErr(e, ip) {
    const code = (e && (e.code || e.message)) || 'unknown', now = Date.now();
    this.netError = { code, ip: ip || null, at: now };
    if (now - (this._errLogAt[code] || 0) > 30000) { this._errLogAt[code] = now; diag.log('wiz', `network error ${code}${ip ? ' sending to ' + ip : ''}`); }
  }
  _send(msg, ip, port = this.port) { // every datagram goes through here so a failed send is never silent
    try { this.sock.send(msg, port, ip, (err) => { if (err) this._netErr(err, ip); }); } catch (e) { this._netErr(e, ip); }
  }
  // Human-readable reason when the OS refused to send (not when the bulb simply stayed silent).
  netHint(sinceMs = 5000) {
    const n = this.netError; if (!n || Date.now() - n.at > sinceMs) return '';
    if (!['EHOSTUNREACH', 'ENETUNREACH', 'EPERM', 'EACCES', 'ENOTCONN'].includes(n.code)) return ` (network error ${n.code})`;
    const mac = process.platform === 'darwin' ? ' On a Mac, open System Settings > Privacy & Security > Local Network, switch Lumen on, then restart Lumen.' : '';
    return ` (the system refused to send to ${n.ip || 'the bulb'}: ${n.code}.${mac})`;
  }

  _open() {
    if (this.sock) return;
    this.sock = dgram.createSocket('udp4');
    this.sock.on('error', (e) => this._netErr(e));
    this.sock.on('message', (buf, rinfo) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      // every request waiting on this bulb + method gets the answer (two callers asking at once must not cancel each other)
      const key = `${rinfo.address}|${msg.method}`, waiters = this.pending.get(key);
      if (waiters && waiters.length) { this.pending.delete(key); for (const w of waiters) { clearTimeout(w.t); w.resolve(msg); } }
      else if (this.collector && msg.method === 'getPilot' && msg.result) this.collector.set(`${rinfo.address}|${rinfo.port}`, msg);
    });
    this.bound = new Promise((res) => this.sock.bind(0, () => { try { this.sock.setBroadcast(true); } catch {} res(); }));
  }
  async _ready() {
    this._open();
    await Promise.race([this.bound, sleep(1000)]); // broadcasts need the socket bound with broadcast enabled
  }
  async request(ip, method, params = {}, timeout = 1200, tries = 2, port = this.port) {
    await this._ready();
    for (let a = 0; a < tries; a++) {
      const res = await new Promise((resolve) => {
        const key = `${ip}|${method}`, w = { resolve };
        w.t = setTimeout(() => { const list = (this.pending.get(key) || []).filter((x) => x !== w); if (list.length) this.pending.set(key, list); else this.pending.delete(key); resolve(null); }, timeout);
        this.pending.set(key, [...(this.pending.get(key) || []), w]);
        this._send(JSON.stringify({ id: 1, method, params }), ip, port);
      });
      if (res) return res;
    }
    return null;
  }

  async _describe(ip, pilotMsg, port = this.port) {
    const pilot = pilotMsg || await this.request(ip, 'getPilot', {}, 1200, 2, port);
    if (!pilot || !pilot.result) return null;
    // The model name decides whether this is a colour bulb. If that one reply is lost, ask again before guessing:
    // a bulb in white mode has no r/g/b in its status, so a wrong guess would turn every colour into plain white.
    let sys = null, mod = '';
    for (let a = 0; a < 3 && !mod; a++) { sys = await this.request(ip, 'getSystemConfig', {}, 1500, 2, port); mod = (sys && sys.result && sys.result.moduleName) || ''; }
    const mac = (pilot.result.mac || (sys && sys.result && sys.result.mac) || ip).toLowerCase();
    // WiZ module names: ..._SHRGB_.. = colour, ..._SHTW_.. = tunable white, ..._SHDW_.. = dimmable white, SOCKET = plug
    let color = /RGB/i.test(mod), temp = /RGB|TW/i.test(mod);
    if (!mod) { color = pilot.result.r !== undefined; temp = true; }
    const dev = {
      id: `wiz:${mac}`, brand: 'wiz', native: { ip, mac, module: mod },
      name: `WiZ ${mac.slice(-4).toUpperCase()}`,
      caps: { dim: !/SOCKET/i.test(mod), color, temp }, kelvinRange: [2200, 6500], online: true,
      capsGuess: !mod, // true when the model name never arrived, so caps are a guess from the status reply
    };
    if (port !== this.port) dev.native.port = port;
    if (!mod) diag.log('wiz', `model name from ${mac.slice(-4)} never arrived; capabilities guessed (colour=${color})`);
    Object.assign(dev, this._parse(pilot.result));
    diag.log('wiz', `found ${mac.slice(-4)} module=${mod || '?'} pilot=${JSON.stringify(pilot.result)}`);
    this.ips.set(dev.id, ip);
    return dev;
  }
  _parse(r) {
    const s = { on: !!r.state };
    if (r.dimming !== undefined) s.brightness = clamp(Math.round(r.dimming), 1, 100);
    if (r.temp) { s.mode = 'white'; s.kelvin = r.temp; }
    else if (r.r !== undefined) { s.mode = 'color'; s.rgb = [r.r, r.g, r.b]; }
    return s;
  }

  // Broadcast discovery, plus direct probes of any known / manually-added IPs.
  async discover(extraIps = []) {
    await this._ready();
    this.collector = new Map();
    for (let round = 0; round < 3; round++) {
      for (const b of this.broadcasts) this._send(JSON.stringify({ id: 1, method: 'getPilot', params: {} }), typeof b === 'string' ? b : b.ip, typeof b === 'string' ? this.port : b.port);
      await sleep(700);
    }
    const found = new Map(this.collector); this.collector = null;
    const out = [];
    for (const ip of extraIps) if (!found.has(ip)) { const d = await this._describe(ip); if (d) out.push(d); }
    for (const [key, msg] of found) { const [ip, port] = key.split('|'); const d = await this._describe(ip, msg, Number(port)); if (d) out.push(d); }
    diag.log('wiz', `discover: sent to ${this.broadcasts.length} address(es), ${found.size} answered, ${extraIps.length} saved address(es) probed, ${out.length} bulb(s) described${out.length ? '' : this.netHint(10000)}`);
    return out;
  }
  async probe(ip) { return this._describe(ip); }

  async refresh(dev) {
    const ip = dev.native.ip;
    const r = await this.request(ip, 'getPilot', {}, 900, 2, dev.native.port || this.port);
    if (!r || !r.result) return { online: false };
    return { online: true, ...this._parse(r.result) };
  }

  _params(p) {
    const params = {};
    if (p.on === false) params.state = false;
    else {
      params.state = true;
      if (p.rgb) {
        // Exact 0-255 integers per channel. The bulb's cool-white (c) and warm-white (w) LEDs are switched off
        // explicitly: setPilot only changes the keys it is sent, so white left on from an earlier white or scene
        // setting would otherwise mix into the colour and wash it out.
        const ch = (v) => clamp(Math.round(Number(v) || 0), 0, 255);
        params.r = ch(p.rgb[0]); params.g = ch(p.rgb[1]); params.b = ch(p.rgb[2]); params.c = 0; params.w = 0;
      }
      else if (p.kelvin) params.temp = clamp(Math.round(p.kelvin), 2200, 6500);
      if (p.brightness !== undefined) params.dimming = clamp(Math.round(p.brightness), 10, 100);
    }
    return params;
  }
  // Effects only: one datagram, no waiting for the bulb's answer and no retry, so a show can send ~11 a second.
  // A dropped packet just means that one frame is skipped. Normal control still goes through setState below.
  fast(dev, p) {
    this._open();
    this._send(JSON.stringify({ id: 1, method: 'setPilot', params: this._params(p) }), dev.native.ip, dev.native.port || this.port);
  }
  async setState(dev, p) {
    const ip = dev.native.ip, port = dev.native.port || this.port, params = this._params(p);
    const res = await this.request(ip, 'setPilot', params, 1200, 3, port);
    if (!res || (res.result && res.result.success === false) || res.error) { diag.log('wiz', `set ${JSON.stringify(params)} -> ${res ? JSON.stringify(res.error || res.result) : 'no reply'}`); throw new Error('WiZ bulb did not respond' + this.netHint()); }
    // Diagnostics: what was sent, and what the bulb says it is now doing (colour problems show up here).
    if (params.r !== undefined) this.request(ip, 'getPilot', {}, 900, 1, port).then((r) => diag.log('wiz', `set ${JSON.stringify(params)} -> bulb reports ${r && r.result ? JSON.stringify(r.result) : 'nothing'}`)).catch(() => {});
  }
  close() { try { this.sock && this.sock.close(); } catch {} this.sock = null; }
}
module.exports = { WizProvider };
