'use strict';
// Multi-bulb WiZ tests against SIMULATED bulbs (see wiz-sim.js). Run: node test/wiz-multi.js
// Covers discovery, unique persistent ids, per-bulb routing, simultaneous control, groups, lightshow playback,
// per-bulb latency, IP change, bulb loss/return and an application restart, for N = 1, 2, 5 and 20 bulbs.
const fs = require('fs'), os = require('os'), path = require('path');
const { WizProvider } = require('../src/main/providers/wiz');
const { Manager } = require('../src/main/manager');
const { Store } = require('../src/main/store');
const { ShowPlayer } = require('../src/main/showplayer');
const { makeBulbs } = require('./wiz-sim');

let pass = 0, fail = 0; const failures = [];
const ok = (c, name, extra) => { if (c) { pass++; } else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const crypto = { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString(), available: () => true };
const stub = () => ({ connected: false, discover: async () => [] });
const PORT = 38899;

function boot(dir, endpoints) { // one "application start": new store + provider + manager over the same data folder
  const store = new Store(dir, crypto);
  const wiz = new WizProvider({ port: PORT, broadcasts: endpoints }); // each local simulator gets its own ephemeral UDP destination port
  const m = new Manager(store, { wiz, hubspace: stub(), cync: stub() });
  return { store, wiz, m };
}
const wizDevs = (m) => [...m.devices.values()].filter((d) => d.brand === 'wiz');
const rgbOf = (b) => [b.pilot.r, b.pilot.g, b.pilot.b];

async function scenario(N) {
  console.log(`\n== ${N} simulated WiZ bulb(s) ==`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-wiz-'));
  const rig = await makeBulbs(N, 0);
  const { bulbs } = rig;
  let app = boot(dir, rig.endpoints);

  // 1. discovery
  await app.m.scan();
  const devs = wizDevs(app.m);
  ok(devs.length === N, `N=${N} discovery finds every bulb`, `found ${devs.length}`);
  ok(new Set(devs.map((d) => d.id)).size === N, `N=${N} every bulb has a unique id`);
  ok(devs.every((d) => /^wiz:[0-9a-f]{12}$/.test(d.id)), `N=${N} ids come from the MAC, not the IP`);
  ok(devs.every((d) => d.online === true), `N=${N} all online after scan`);
  ok(bulbs.every((b) => { const d = app.m.devices.get('wiz:' + b.mac); return d && d.native.ip === b.ip; }), `N=${N} each id maps to its own IP`);

  // 2. independent control: different colour for each bulb, sent at the same moment
  const cols = bulbs.map((_, i) => [(i * 37 + 20) % 256, (i * 91 + 60) % 256, (i * 53 + 200) % 256]);
  const map = {}; bulbs.forEach((b, i) => { map['wiz:' + b.mac] = { on: true, rgb: cols[i], brightness: 40 + (i % 5) * 10 }; });
  const res = await app.m.applyMap(map, 'test');
  ok(res.failed === 0 && res.ok === N, `N=${N} simultaneous per-bulb commands all succeed`, JSON.stringify(res));
  await sleep(150);
  ok(bulbs.every((b, i) => rgbOf(b).join() === cols[i].join() && b.pilot.state === true), `N=${N} every bulb shows ITS OWN colour`, bulbs.map((b) => rgbOf(b)).join(' | '));
  ok(bulbs.every((b) => b.log.length >= 1 && b.log.every((l) => l.params.r === b.pilot.r)), `N=${N} no bulb received another bulb's command`);

  // 3. one bulb only
  if (N > 1) {
    const before = bulbs.map((b) => b.log.length);
    await app.m.apply(['wiz:' + bulbs[0].mac], { on: false });
    await sleep(100);
    ok(bulbs[0].pilot.state === false && bulbs.slice(1).every((b) => b.pilot.state === true), `N=${N} power-off on bulb 0 leaves the others on`);
    ok(bulbs.slice(1).every((b, i) => b.log.length === before[i + 1]), `N=${N} others received no extra packets`);
    await app.m.apply(['wiz:' + bulbs[0].mac], { on: true, brightness: 77 }); await sleep(80);
    ok(bulbs[0].pilot.dimming === 77 && bulbs.slice(1).every((b) => b.pilot.dimming !== 77 || N === 1), `N=${N} brightness goes to the right bulb`);
  }

  // 4. all at once with the same patch (a "scene"/all-lights command)
  const r2 = await app.m.apply(app.m.scopeIds({ type: 'all' }), { on: true, rgb: [255, 0, 0], brightness: 100 }); await sleep(100);
  ok(r2.failed === 0 && bulbs.every((b) => rgbOf(b).join() === '255,0,0'), `N=${N} apply to all reaches all`);

  // 5. groups: two groups, no overwriting
  if (N > 1) {
    const ids = bulbs.map((b) => 'wiz:' + b.mac), half = Math.ceil(N / 2);
    app.m.saveGroup({ name: 'A', deviceIds: ids.slice(0, half) }); app.m.saveGroup({ name: 'B', deviceIds: ids.slice(half) });
    const [gA, gB] = app.store.data.groups;
    await app.m.apply(app.m.scopeIds({ type: 'group', id: gA.id }), { on: true, rgb: [0, 255, 0] });
    await app.m.apply(app.m.scopeIds({ type: 'group', id: gB.id }), { on: true, rgb: [0, 0, 255] }); await sleep(120);
    ok(bulbs.slice(0, half).every((b) => rgbOf(b).join() === '0,255,0') && bulbs.slice(half).every((b) => rgbOf(b).join() === '0,0,255'), `N=${N} two groups drive their own bulbs without overwriting each other`);
  }

  // 6. persistence across an application restart
  app.store.saveNow();
  const idsBefore = devs.map((d) => d.id).sort();
  app.wiz.close();
  app = boot(dir, rig.endpoints);
  const restored = wizDevs(app.m);
  ok(restored.map((d) => d.id).sort().join() === idsBefore.join(), `N=${N} all bulbs still registered after restart (before any scan)`, `restored ${restored.length}`);
  ok(restored.every((d) => d.native && d.native.ip), `N=${N} restored bulbs keep their IP`);
  if (N > 1) ok(app.store.data.groups.length === 2 && app.store.data.groups.every((g) => g.deviceIds.length >= 1), `N=${N} groups survive restart`);
  await app.m.scan();
  ok(wizDevs(app.m).length === N && wizDevs(app.m).every((d) => d.online), `N=${N} rescan after restart brings all online, no duplicates`, `have ${wizDevs(app.m).length}`);

  // 7. a bulb is lost and returns; others unaffected
  if (N > 1) {
    bulbs[0].setOnline(false);
    await app.m.scan();
    ok(app.m.devices.get('wiz:' + bulbs[0].mac).online === false && wizDevs(app.m).filter((d) => d.online).length === N - 1, `N=${N} a missing bulb is shown offline, the rest stay online`);
    const r = await app.m.apply(['wiz:' + bulbs[1].mac], { on: true, rgb: [9, 9, 9] }); await sleep(80);
    ok(r.failed === 0 && rgbOf(bulbs[1]).join() === '9,9,9', `N=${N} other bulbs still controllable while one is down`);
    bulbs[0].setOnline(true);
    await app.m.scan();
    ok(app.m.devices.get('wiz:' + bulbs[0].mac).online === true, `N=${N} bulb comes back online after rescan`);
    const r3 = await app.m.apply(['wiz:' + bulbs[0].mac], { on: true, rgb: [1, 2, 3] }); await sleep(80);
    ok(r3.failed === 0 && rgbOf(bulbs[0]).join() === '1,2,3', `N=${N} returned bulb accepts commands`);
  }

  // 8. lightshow: every bulb in a lane gets its own commands, each with its own latency
  {
    const ids = bulbs.map((b) => 'wiz:' + b.mac);
    const show = { lanes: [{ id: 'L1', deviceIds: ids }], events: [
      { lane: 'L1', t: 0.0, dur: 0.6, type: 'solid', rgb: [255, 0, 0], bri: 100 },
      { lane: 'L1', t: 0.6, dur: 0.6, type: 'solid', rgb: [0, 0, 255], bri: 100 },
    ] };
    // find the event shape the compiler really accepts by compiling; fall back to the project's own helpers below if empty
    const prof = {}; ids.forEach((id, i) => { prof[id] = { ms: 40 + i * 25 }; });
    const player = new ShowPlayer({ manager: app.m, profiles: () => prof, healthEvery: 0 });
    const plan = player.compile(show, 0);
    ok(Object.keys(plan.per).length === N, `N=${N} show plan includes every bulb`, `plan covers ${Object.keys(plan.per).length}`);
    ok(ids.every((id, i) => plan.per[id] && plan.per[id].latency === 40 + i * 25), `N=${N} each bulb keeps its own latency profile`, JSON.stringify(Object.values(plan.per).map((p) => p.latency)));
    ok(ids.every((id) => plan.cmds.some((c) => c.id === id)), `N=${N} every bulb has scheduled commands`);
    const marks = bulbs.map((b) => b.log.length);
    const s = player.start({ show, from: 0, lead: 50 });
    await sleep(1800);
    await player.stop({ restore: false });
    ok(bulbs.every((b, i) => b.log.length > marks[i]), `N=${N} every bulb received show packets`, bulbs.map((b, i) => b.log.length - marks[i]).join(','));
    void s;
  }

  // 9. IP change (DHCP): same MAC at a new address must update the existing device, not add a second one
  if (N > 1) {
    const mv = bulbs[N - 1], oldPort = mv.port;
    await mv.stop(); mv.port = 0; await mv.start();
    rig.endpoints[N - 1] = { ip: mv.ip, port: mv.port };
    app.wiz.broadcasts = rig.endpoints;
    await app.m.scan();
    const d = app.m.devices.get('wiz:' + mv.mac);
    ok(wizDevs(app.m).length === N, `N=${N} bulb whose endpoint changed is not duplicated`, `have ${wizDevs(app.m).length}`);
    ok(d && d.native.ip === mv.ip && d.native.port === mv.port && d.online, `N=${N} bulb that changed UDP port is found at its new endpoint (was ${oldPort})`, d && d.native.port);
    const marks = bulbs.map((b) => b.log.length);
    await app.m.apply(['wiz:' + mv.mac], { on: true, rgb: [7, 8, 9] }); await sleep(80);
    ok(rgbOf(mv).join() === '7,8,9' && bulbs.slice(0, N - 1).every((b, i) => b.log.length === marks[i]), `N=${N} commands follow the bulb to its changed endpoint`);
  }

  app.wiz.close(); app.store.saveNow(); await rig.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  for (const n of [1, 2, 5, 20]) await scenario(n);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('test crashed:', e); process.exit(2); });
