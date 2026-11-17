'use strict';
// Simulated WiZ bulbs for tests. Each bulb is a UDP socket bound to its own loopback address (127.0.0.k) and
// speaks the real WiZ local protocol (getPilot / getSystemConfig / setPilot, JSON over UDP). This is a SIMULATION:
// it proves Lumen's handling of several bulbs, not that a real bulb behaves the same.
const dgram = require('dgram');

class SimBulb {
  constructor({ ip, mac, module = 'ESP01_SHRGB_03', port, state = {} }) {
    this.ip = ip; this.mac = mac; this.module = module; this.port = port;
    this.pilot = { state: false, dimming: 100, r: 0, g: 0, b: 0, c: 0, w: 0, ...state };
    this.online = true; this.log = []; this.sock = null; this.dropEvery = 0; this.n = 0;
  }
  start() {
    return new Promise((res, rej) => {
      this.sock = dgram.createSocket('udp4');
      this.sock.on('error', rej);
      this.sock.on('message', (buf, r) => {
        if (!this.online) return;
        let m; try { m = JSON.parse(buf.toString()); } catch { return; }
        this.n++; if (this.dropEvery && this.n % this.dropEvery === 0) return; // simulated packet loss
        const reply = (o) => this.sock.send(JSON.stringify({ id: m.id, ...o }), r.port, r.address);
        if (m.method === 'getPilot') return reply({ method: 'getPilot', env: 'pro', result: { mac: this.mac, rssi: -50, ...this.pilot } });
        if (m.method === 'getSystemConfig') return reply({ method: 'getSystemConfig', env: 'pro', result: { mac: this.mac, moduleName: this.module, fwVersion: '1.25.0' } });
        if (m.method === 'setPilot') { this.log.push({ t: Date.now(), params: m.params }); Object.assign(this.pilot, m.params); return reply({ method: 'setPilot', env: 'pro', result: { success: true } }); }
      });
      this.sock.bind(this.port, this.ip, () => { this.port = this.sock.address().port; res(this); });
    });
  }
  stop() { return new Promise((r) => { try { this.sock.close(r); } catch { r(); } }); }
  setOnline(v) { this.online = v; }
}

// Bind all simulated bulbs to the portable loopback address and give each its own ephemeral UDP port.
// Real WiZ devices use the fixed protocol port; this port override keeps tests independent of 127/8 aliases.
async function makeBulbs(n, port, opts = {}) {
  const bulbs = [];
  for (let i = 0; i < n; i++) {
    const ip = '127.0.0.1', mac = ((0xa8bb50000000 + 0x1000 + i * 0x111).toString(16)).padStart(12, '0');
    bulbs.push(await new SimBulb({ ip, mac, port: port === 0 ? 0 : port + i, ...(opts.each ? opts.each(i) : {}) }).start());
  }
  return { bulbs, ips: [...new Set(bulbs.map((b) => b.ip))], endpoints: bulbs.map((b) => ({ ip: b.ip, port: b.port })), stop: () => Promise.all(bulbs.map((b) => b.stop())) };
}
module.exports = { SimBulb, makeBulbs };
