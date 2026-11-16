'use strict';
// WiZ network-error reporting (SIMULATED: send failures are injected, not produced by a real OS block). Run: node test/wiz-errors.js
const { WizProvider } = require('../src/main/providers/wiz');
const diag = require('../src/main/diag');
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? pass++ : (fail++, console.log('  ✗ ' + n + (x ? ' :: ' + x : ''))); };
const logs = []; const origLog = diag.log; diag.log = (...a) => { logs.push(a.join(' ')); };
(async () => {
  const w = new WizProvider({ port: 38899, broadcasts: ['127.0.0.250'] });
  await w._ready();
  // 1. a refused send (what macOS Local Network blocking looks like) is recorded, logged once, and explained to the user
  const realSend = w.sock.send.bind(w.sock);
  w.sock.send = (msg, port, ip, cb) => { setImmediate(() => cb && cb(Object.assign(new Error('send EHOSTUNREACH'), { code: 'EHOSTUNREACH' }))); };
  let err = null; try { await w.setState({ native: { ip: '127.0.0.250' } }, { on: true, rgb: [1, 2, 3] }); } catch (e) { err = e; }
  ok(err && /did not respond/.test(err.message), 'command still fails with the original message');
  ok(err && /EHOSTUNREACH/.test(err.message), 'failure message names the OS error', err && err.message);
  ok(w.netError && w.netError.code === 'EHOSTUNREACH' && w.netError.ip === '127.0.0.250', 'last network error recorded with its address');
  ok(logs.filter((l) => /network error EHOSTUNREACH/.test(l)).length === 1, 'repeated identical errors are logged once, not flooded', String(logs.filter((l) => /network error/.test(l)).length));
  // 2. discovery that finds nothing because sends were refused says so
  logs.length = 0;
  const found = await w.discover([]);
  ok(found.length === 0 && logs.some((l) => /discover: sent to 1 address/.test(l) && /0 bulb/.test(l)), 'discovery logs its summary', logs.join(' | '));
  // 3. an ordinary silent bulb (no OS error) keeps the plain message, no misleading permission advice
  w.sock.send = realSend; w.netError = null;
  let err2 = null; try { await w.setState({ native: { ip: '127.0.0.251' } }, { on: false }); } catch (e) { err2 = e; }
  ok(err2 && err2.message === 'WiZ bulb did not respond', 'plain silence keeps the original message', err2 && err2.message);
  // 4. the fast path (shows) no longer swallows send errors
  w.sock.send = (msg, port, ip, cb) => { setImmediate(() => cb && cb(Object.assign(new Error('send EPERM'), { code: 'EPERM' }))); };
  w.fast({ native: { ip: '127.0.0.250' } }, { on: true, rgb: [9, 9, 9] }); await new Promise((r) => setTimeout(r, 30));
  ok(w.netError && w.netError.code === 'EPERM', 'fast() send errors are recorded');
  w.close(); diag.log = origLog;
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
