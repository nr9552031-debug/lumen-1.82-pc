'use strict';
// A lost WiZ model-name reply must not turn a colour bulb into a white-only one (SIMULATED). Run: node test/wiz-caps.js
const fs = require('fs'), os = require('os'), path = require('path');
const { WizProvider } = require('../src/main/providers/wiz'); const { Manager } = require('../src/main/manager'); const { Store } = require('../src/main/store');
const { SimBulb } = require('./wiz-sim'); const diag = require('../src/main/diag'); diag.log = () => {};
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : (fail++, console.log('  ✗ ' + n + (x ? ' :: ' + x : ''))); };
const crypto = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString(), available: () => true }, stub = () => ({ connected: false, discover: async () => [] });
(async () => {
  const b = await new SimBulb({ ip: '127.0.0.70', mac: 'aabbccdd0070', port: 38899 }).start();
  b.pilot = { state: true, dimming: 100, temp: 2700 }; // colour bulb currently in white mode: status has no r/g/b
  let dropSys = 0; const orig = b.sock.listeners('message')[0]; b.sock.removeAllListeners('message');
  b.sock.on('message', (buf, r) => { let m; try { m = JSON.parse(buf); } catch { return; } if (m.method === 'getSystemConfig' && dropSys > 0) { dropSys--; return; } orig(buf, r); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-caps-')), store = new Store(dir, crypto);
  const w = new WizProvider({ port: 38899, broadcasts: ['127.0.0.70'] }), m = new Manager(store, { wiz: w, hubspace: stub(), cync: stub() });
  // 1. one or two lost replies: retries recover the real model
  dropSys = 3; await m.scan(); let d = m.devices.get('wiz:aabbccdd0070');
  ok(d && d.caps.color === true && d.capsGuess === false, 'retries recover the model name after lost replies', JSON.stringify(d && d.caps));
  // 2. every reply lost: first ever scan has to guess, but a LATER scan that guesses must keep the known capabilities
  dropSys = 1e6; await m.scan(); d = m.devices.get('wiz:aabbccdd0070');
  ok(d.caps.color === true, 'a scan that can only guess keeps the capabilities learned earlier', JSON.stringify(d.caps));
  // 3. a colour command still goes out as colour (not converted to a white temperature)
  b.log.length = 0; await m.apply(['wiz:aabbccdd0070'], { on: true, rgb: [255, 0, 0], brightness: 100 }); await new Promise((r) => setTimeout(r, 80));
  const last = b.log[b.log.length - 1]; ok(last && last.params.r === 255 && last.params.g === 0 && last.params.temp === undefined, 'colour is sent as r/g/b, not as white', JSON.stringify(last && last.params));
  // 4. with nothing known yet, an unanswered model name is flagged as a guess
  const w2 = new WizProvider({ port: 38899, broadcasts: [] }); dropSys = 1e6; const g = await w2.probe('127.0.0.70');
  ok(g && g.capsGuess === true, 'with no model name the capabilities are marked as a guess'); w2.close();
  w.close(); await b.stop(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
