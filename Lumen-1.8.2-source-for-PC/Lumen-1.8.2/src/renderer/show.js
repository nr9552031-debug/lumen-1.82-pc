'use strict';
/* Lightshow workspace: import a song, analyse it offline, generate an editable light show, edit it on a timeline and
   play it back with every bulb's latency compensated. Analysis and generation run here (pure code in ../shared);
   the main process compiles the per-bulb command schedule and sends it, following the clock this page reports. */
const LA = window.LumenAnalysis, LS = window.LumenShow, LF = window.LumenFx;
const ls = {
  ready: false, an: null, audio: null, file: null, show: null, sel: new Set(), clip: [], range: null, pps: 40, t0: 0, pos: 0,
  playing: false, ctx: null, src: null, when: 0, from: 0, tab: 'gen', lat: [], presets: [], shows: [], snap: true, restore: true,
  busy: '', undo: [], redo: [], auto: {}, plan: null, status: null, test: null, drag: null, err: '',
  notes: {}, keepUser: true, myFx: [], fxAdv: false, fxPrev: null,
};
const LANE_H = 58, TOP = { ruler: 18, sec: 18, wave: 64, energy: 22 }, HEAD_W = 112, CLIP_Y = 15, CLIP_H = 17; // lane: base strip, effect clips, events
const topH = () => TOP.ruler + TOP.sec + TOP.wave + TOP.energy;
const fmtT = (t) => { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`; };
const hexOf = (rgb) => C.hex(rgb.map((v) => Math.round(v)));
const TYPES = [['flash', 'Flash'], ['pulse', 'Pulse'], ['color', 'Colour (base)'], ['ambient', 'Ambient drift (base)'], ['strobe', 'Strobe'], ['blackout', 'Blackout']];
const FX_CAT = { hit: 'Hits', rhythm: 'Rhythm', spatial: 'Moving across the room', atmos: 'Atmosphere', transition: 'Transitions' };
const TRIG_L = { beat: 'Beats', bass: 'Bass hits', vocal: 'Vocal / quiet parts', transition: 'Section changes & drops', random: 'Randomly' };
const SPEED_L = { fast: 'Fast bulbs (WiZ)', medium: 'Medium (Cync)', slow: 'Slow (Hubspace)' };
const SEC_COL = { intro: '#4a6fa5', verse: '#4f8a5b', 'build-up': '#c08a2e', drop: '#c0392b', chorus: '#a0379b', breakdown: '#2f7f8f', outro: '#5c5f73' };

/* ---------- data helpers ---------- */
function lsDevInfo() {
  const prof = Object.fromEntries(ls.lat.map((l) => [l.id, l]));
  // where each bulb is, from the Room Visualizer layouts (0..1 across the room); used for waves, sides and chases
  const pos = {}; for (const l of [lsLayout(), ...(S.layouts || [])].filter(Boolean)) for (const f of l.fixtures || []) if (f.deviceId && !pos[f.deviceId] && l.w && l.h) pos[f.deviceId] = { x: C.clamp(f.x / l.w, 0, 1), y: C.clamp(f.y / l.h, 0, 1) };
  const o = {}; for (const d of S.devices) { const p = prof[d.id] || {}; o[d.id] = { brand: d.brand, name: d.name, caps: d.caps, online: d.online !== false, enabled: p.enabled !== false, pos: pos[d.id], profile: { ms: p.ms, offset: p.offset, interval: p.interval, rel: p.rel } }; }
  return o;
}
function lsLanes() { // user groups first, then rooms, otherwise automatic lanes
  const live = new Set(S.devices.map((d) => d.id));
  let lanes = S.groups.map((g) => ({ id: 'g:' + g.id, name: g.name, deviceIds: g.deviceIds.filter((id) => live.has(id)) })).filter((l) => l.deviceIds.length);
  if (!lanes.length) lanes = S.rooms.map((r) => ({ id: 'r:' + r.id, name: r.name, deviceIds: S.devices.filter((d) => d.room === r.id).map((d) => d.id) })).filter((l) => l.deviceIds.length);
  const covered = new Set(lanes.flatMap((l) => l.deviceIds)), rest = S.devices.map((d) => d.id).filter((id) => !covered.has(id));
  if (!lanes.length) return LS.autoLanes(S.devices.map((d) => d.id), lsDevInfo());
  if (rest.length) lanes.push({ id: 'other', name: 'Other lights', deviceIds: rest });
  return lanes;
}
const lsTracks = () => [{ id: '*', name: 'All lights', deviceIds: [] }, ...(ls.show ? ls.show.lanes : [])];
const lsEvent = (id) => ls.show && ls.show.events.find((e) => e.id === id);
const lsClip = (id) => ls.show && (ls.show.clips || []).find((c) => c.id === id);
const lsItem = (id) => lsClip(id) || lsEvent(id); // a selected thing on the timeline: an effect clip or a single event
const lsSelItems = () => [...ls.sel].map(lsItem).filter(Boolean);
// Effect clips are the source of truth for effects; the events they produce are rebuilt from them (and from the bulbs'
// speed and position) whenever anything changes, so the bulbs always get exactly what the clips describe.
function lsMat() {
  if (!ls.show) return; if (!ls.show.clips) ls.show.clips = [];
  const r = LF.materialize(ls.show, ls.an || { duration: 1e9, beats: [] }, lsDevInfo()); ls.show.events = r.events; ls.notes = r.notes;
}
const lsNewId = () => 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const lsSnap = () => JSON.stringify({ e: ls.show.events.filter((v) => !v.fx), c: ls.show.clips || [] });
function lsPush() { if (!ls.show) return; ls.undo.push(lsSnap()); if (ls.undo.length > 60) ls.undo.shift(); ls.redo = []; }
function lsChanged(keepSide) { ls.show.events = ls.show.events.filter((v) => !v.fx); (ls.show.clips || []).sort((a, b) => a.t - b.t); lsMat(); ls.dirty = true; lsAutomation(); lsPaint(); if (!keepSide) lsSide(); lsPlanSoon(); }
const lsChangedSoon = throttle(() => lsChanged(true), 150);
const lsPlanSoon = debounce(async () => { if (!ls.show) return; try { ls.plan = await call('show:plan', ls.show); lsStatus(); if (ls.tab === 'gen') lsSide(); } catch {} }, 600);
function lsAutomation() { // colour + brightness each track will show, sampled 10x a second, for the automation strips
  ls.auto = {}; if (!ls.show || !ls.an) return;
  const dur = ls.an.duration;
  for (const tr of lsTracks()) {
    const evs = ls.show.events.filter((e) => e.lane === tr.id || e.lane === '*'); const st = LS.stateFn(evs), n = Math.ceil(dur * 10), out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = st.at(i / 10);
    ls.auto[tr.id] = out;
  }
  lsDevStates();
}
/* ---------- room preview: the Room Visualizer plan, lit by the show ---------- */
const lsShowIds = () => (ls.show && ls.show.lanes.length ? [...new Set(ls.show.lanes.flatMap((l) => l.deviceIds))] : S.devices.map((d) => d.id));
function lsLayout() { // the chosen drawn room if it has lights linked to this show's bulbs; otherwise an automatic one
  const L = S.layouts || [], ids = new Set(lsShowIds()), linked = (l) => (l.fixtures || []).some((f) => f.deviceId && ids.has(f.deviceId));
  const pick = L.find((l) => l.id === ls.layoutId && linked(l)) || L.find(linked); if (pick) return pick;
  const list = [...ids]; if (!list.length) return null;
  return { id: 'auto', auto: true, name: 'Automatic', w: 5, h: 4, objects: [], fixtures: list.map((id, k) => { const q = LS.autoPos(k, list.length); return { id: 'auto' + k, type: 'lamp', x: q.x * 5, y: q.y * 4, rot: 0, label: '', deviceId: id }; }) };
}
function lsDevStates() { // what every bulb in the show is doing, as a function of time (same maths the bulbs are scheduled from)
  ls.devSt = {}; if (!ls.show) return;
  const all = new Set(ls.show.lanes.flatMap((l) => l.deviceIds)), laneOf = new Map(ls.show.lanes.map((l) => [l.id, new Set(l.deviceIds)]));
  for (const id of all) ls.devSt[id] = LS.stateFn(ls.show.events.filter((e) => (e.devs && e.devs.length ? e.devs.includes(id) : e.lane === '*' || (laneOf.get(e.lane) || new Set()).has(id))));
}
function lsRoomBuild() {
  const box = $('#lsRoom'); if (!box) return;
  const l = lsLayout(), opts = (S.layouts || []).map((x) => `<option value="${esc(x.id)}" ${l && x.id === l.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const head = `<div class="ph">${ico('plan')}Room preview<span class="sp"></span>${opts && l && !l.auto ? `<select id="lsLayout" style="font-weight:normal;max-width:180px">${opts}</select>` : ''}
    <label class="chk" style="font-weight:normal" data-tip="Play the music and watch the show here without sending anything to the real lights"><input type="checkbox" id="lsPreviewOnly" ${ls.previewOnly ? 'checked' : ''}>Preview only</label>
    <button class="btn mini" data-a="roomtoggle" data-tip="Show or hide the room">${ls.roomHidden ? '▸' : '▾'}</button></div>`;
  if (ls.roomHidden) { box.innerHTML = head; return; }
  if (!l) { box.innerHTML = head + `<div class="pb muted">No room layout yet. Draw your room in <a href="#" data-nav="viz">Room Visualizer</a> and link its lights to your bulbs: the show is then previewed here, and waves, sides and chases follow where the bulbs really are.</div>`; return; }
  const W = l.w * U, H = l.h * U, P = 30, inShow = new Set(ls.show ? ls.show.lanes.flatMap((x) => x.deviceIds) : []);
  const objs = l.objects.map((o) => `<g transform="translate(${o.x * U} ${o.y * U}) rotate(${o.rot || 0} ${o.w * U / 2} ${o.h * U / 2})">${objSvg(o)}</g>`).join('');
  const defs = l.fixtures.map((f) => `<radialGradient id="lsg-${f.id}"><stop offset="0" stop-opacity="0"/><stop offset=".45" stop-opacity="0"/><stop offset="1" stop-opacity="0"/></radialGradient>`).join('');
  const glow = l.fixtures.map((f) => { const r = FIX[f.type][0] * U; return `<ellipse data-g="${f.id}" cx="${f.x * U}" cy="${f.y * U}" rx="${r}" ry="${f.type === 'strip' ? r * 0.42 : r}" transform="rotate(${f.rot || 0} ${f.x * U} ${f.y * U})" fill="url(#lsg-${f.id})"/>`; }).join('');
  const fix = l.fixtures.map((f) => { const d = f.deviceId ? dev(f.deviceId) : null, live = f.deviceId && inShow.has(f.deviceId);
    const sh = f.type === 'strip' ? '<rect x="-42" y="-7" width="84" height="14" rx="7"/>' : f.type === 'spot' ? '<path d="M0-14 13 10H-13z"/>' : f.type === 'wall' ? '<path d="M-14 0A14 14 0 0 1 14 0z"/>' : `<circle r="${f.type === 'ceiling' ? 15 : 11}"/>`;
    return `<g data-f="${f.id}" transform="translate(${f.x * U} ${f.y * U}) rotate(${f.rot || 0})" fill="#444" stroke="${live ? '#fff' : '#888'}" stroke-width="2" ${live ? '' : 'stroke-dasharray="4 3"'}>${sh}</g>
      <text x="${f.x * U}" y="${f.y * U + 32}" text-anchor="middle" font-size="14" fill="${live ? '#fff' : '#99a'}" style="paint-order:stroke" stroke="#000a" stroke-width="3">${esc(f.label || (d ? d.name : FIX[f.type][1]))}${live ? '' : f.deviceId ? ' (not in show)' : ' (not linked)'}</text>`; }).join('');
  box.innerHTML = head + `<div class="ls-roomwrap"><svg id="lsRoomSvg" viewBox="${-P} ${-P} ${W + 2 * P} ${H + 2 * P}" preserveAspectRatio="xMidYMid meet">
    <defs>${defs}<pattern id="lsfloor" width="50" height="200" patternUnits="userSpaceOnUse"><rect width="50" height="200" fill="#8a6a45"/><path d="M0 0V200M25 100V200M0 100H50" stroke="#6f5334" stroke-width="2"/></pattern></defs>
    <rect width="${W}" height="${H}" fill="url(#lsfloor)"/><g>${objs}</g><rect width="${W}" height="${H}" fill="#000" opacity=".86"/>
    <g>${glow}</g><rect width="${W}" height="${H}" fill="none" stroke="#e9e3d6" stroke-width="10"/>${fix}</svg></div>${l.auto ? `<div class="pb muted small">Automatic layout: Lumen is assuming your bulbs sit around the room in this order, and room effects (colour thrown side to side, corner to corner) follow it. For real positions, draw the room in <a href="#" data-nav="viz">Room Visualizer</a>, link each light to its bulb, then Generate again.</div>` : ''}`;
  ls.roomFix = l.fixtures.map((f) => ({ f, stops: [...box.querySelectorAll(`#lsg-${CSS.escape(f.id)} stop`)], g: box.querySelector(`[data-f="${CSS.escape(f.id)}"]`), e: box.querySelector(`[data-g="${CSS.escape(f.id)}"]`) }));
  lsRoomUpdate(ls.pos, true);
}
function lsRoomUpdate(t, force) {
  if (!ls.roomFix || ls.roomHidden) return;
  const now = performance.now(); if (!force && now - (ls.roomAt || 0) < 80) return; ls.roomAt = now;
  if (!$('#lsRoomSvg')) return;
  for (const r of ls.roomFix) {
    const src = ls.fxPrev ? ls.fxPrev.st : ls.devSt, st = r.f.deviceId && src && src[r.f.deviceId], s = st ? st.at(t) : null, k = s ? C.clamp(s.bri / 100, 0, 1) : 0;
    const c = s ? s.rgb.map((v) => Math.round(C.clamp(v, 0, 255))).join(',') : '60,60,60', a = k < 0.02 ? 0 : 0.35 + 0.65 * k;
    const sig = c + '|' + Math.round(a * 20); if (r.sig === sig) continue; r.sig = sig;
    r.stops.forEach((x, i) => { x.setAttribute('stop-color', `rgb(${c})`); x.setAttribute('stop-opacity', String(a * [1, 0.45, 0][i])); });
    if (r.g) r.g.setAttribute('fill', s && k >= 0.02 ? `rgb(${c})` : '#333');
  }
}

/* ---------- init / import ---------- */
async function lsInit() {
  [ls.lat, ls.presets, ls.shows, ls.myFx] = await Promise.all([call('latency:get'), call('show:presets'), call('show:list'), call('show:fxList').catch(() => [])]);
  ls.opts = { ...LS.DEFAULTS, ...(S.settings.showOpts || {}) }; ls.ready = true;
}
async function lsDecode(bytes) {
  if (bytes && !(bytes instanceof Uint8Array)) bytes = Uint8Array.from(bytes.data || bytes); // IPC hands back a Uint8Array; other bridges may give plain data
  if (!ls.ctx) ls.ctx = new AudioContext({ latencyHint: 'playback' });
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  try { return await ls.ctx.decodeAudioData(ab); } catch { throw new Error('This file could not be decoded. Try MP3, WAV, FLAC, OGG or M4A.'); }
}
async function lsImport(file) { // file: { path?, name, bytes }
  ls.err = ''; ls.busy = 'Decoding ' + file.name + '…'; lsBar();
  try {
    const buf = await lsDecode(file.bytes);
    const n = buf.length, mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    const key = LA.cacheKey(mono, buf.sampleRate);
    let an = await call('show:analysisGet', key).catch(() => null);
    if (!an || an.v !== 1) {
      an = await LA.analyze(mono, buf.sampleRate, { onProgress: (p) => { ls.busy = `Analysing music… ${Math.round(p * 100)}%`; lsBar(); } });
      call('show:analysisPut', key, an).catch(() => {});
    }
    ls.audio = buf; ls.an = an; ls.file = { path: file.path || null, name: file.name, key };
    const keep = ls.show && ls.show.audio && ls.show.audio.key === key;
    if (!keep) { ls.show = { id: null, name: file.name.replace(/\.[^.]+$/, ''), audio: { ...ls.file, duration: an.duration }, opts: { ...ls.opts }, lanes: lsLanes(), events: [], clips: [] }; ls.undo = []; lsGenerate(); }
    else { ls.show.audio = { ...ls.file, duration: an.duration }; ls.show.analysis = an; }
    ls.busy = ''; ls.pos = 0; ls.t0 = 0; lsFit(); lsAutomation(); lsAll();
    toast(`${file.name}: ${an.bpm} BPM, ${an.sections.length} sections${an.drops.length ? ', ' + an.drops.length + ' drop' + (an.drops.length > 1 ? 's' : '') : ''}`);
  } catch (e) { ls.busy = ''; ls.err = e.message; lsBar(); }
}
async function lsPick() { if (ls.playing) await lsStop(); const f = await call('show:pickAudio'); if (f) await lsImport(f); }

/* ---------- generate ---------- */
function lsGenerate(range) {
  if (!ls.an || !ls.show) return;
  lsPush();
  ls.show.opts = { ...ls.opts }; S.settings.showOpts = ls.opts; call('settings:set', { showOpts: ls.opts }).catch(() => {});
  ls.show.lanes = lsLanes();
  const opts = range ? { ...ls.opts, variant: Math.floor(Math.random() * 1e6) } : ls.opts;
  const g = LF.generateShow(ls.an, opts, ls.show.lanes, lsDevInfo(), range);
  if (ls.opts.mode === 'manual') g.clips = []; // manual: base colours only, the user places the effects
  // what the user made by hand (added effects and events) is kept unless they untick "keep my edits"
  const mine = (x) => ls.keepUser && x.user, out = (x) => range && (x.t < range[0] || x.t >= range[1]);
  const own = ls.show.events.filter((e) => !e.fx);
  ls.show.events = own.filter((e) => out(e) || mine(e)).concat(g.events);
  ls.show.clips = (ls.show.clips || []).filter((c) => out(c) || mine(c)).concat(g.clips);
  ls.sel.clear(); lsChanged();
}

/* ---------- playback (one clock: main sends each bulb's commands for the moment this page says the music is heard) ---------- */
const lsHeard = () => { if (!ls.playing || !ls.ctx) return ls.pos; const ts = ls.ctx.getOutputTimestamp ? ls.ctx.getOutputTimestamp() : null; const ct = ts && ts.contextTime ? ts.contextTime : ls.ctx.currentTime - (ls.ctx.outputLatency || 0); return Math.max(0, ct - ls.when + ls.from); };
async function lsPlay(from = ls.pos, test) {
  const show = test ? test.show : ls.show, audio = test ? test.audio : ls.audio;
  if (!show || !audio) return;
  if (!S.devices.length && !ls.previewOnly) toast('No lights connected: the music will play, but nothing will light up.', true);
  if (!ls.ctx) ls.ctx = new AudioContext({ latencyHint: 'playback' });
  await ls.ctx.resume();
  lsKillSrc();
  // Preview only: the music and the room preview run, nothing is sent to the bulbs.
  const r = ls.previewOnly && !test ? { heardAt: Date.now() + 120, preview: true } : await call('show:start', { show, from, lead: 160 });
  const outLat = (ls.ctx.outputLatency || 0) + (ls.ctx.baseLatency || 0);
  const when = ls.ctx.currentTime + Math.max(0.02, (r.heardAt - Date.now()) / 1000 - outLat);
  const src = ls.ctx.createBufferSource(); src.buffer = audio; src.connect(ls.ctx.destination); src.start(when, from);
  src.onended = () => { if (ls.src === src && ls.playing) lsStop(); };
  Object.assign(ls, { src, when, from, playing: true, test: test || null, startInfo: r });
  clearInterval(ls.syncT); ls.syncT = setInterval(lsSyncNow, 1500);
  lsBar(); lsStatus(); lsLoop();
}
function lsSyncNow() {
  if (!ls.playing || !ls.ctx || !ls.ctx.getOutputTimestamp) return;
  const ts = ls.ctx.getOutputTimestamp(); if (!ts || !ts.contextTime) return;
  window.lumen.call('show:sync', ts.contextTime - ls.when + ls.from, performance.timeOrigin + ts.performanceTime).catch(() => {});
  window.lumen.call('show:status').then((r) => { if (r.ok) { ls.status = r.data; lsStatus(); if (ls.tab === 'bulbs') lsLiveBulbs(); } }).catch(() => {});
}
function lsKillSrc() { if (ls.src) { try { ls.src.onended = null; ls.src.stop(); } catch {} ls.src = null; } }
async function lsPause() { if (!ls.playing) return; ls.pos = lsHeard(); ls.playing = false; lsKillSrc(); clearInterval(ls.syncT); const r = await call('show:pause').catch(() => null); if (r) ls.status = r; lsBar(); }
async function lsStop() {
  const wasTest = !!ls.test; ls.playing = false; lsKillSrc(); clearInterval(ls.syncT);
  const r = await call('show:stop', { restore: ls.restore }).catch(() => null); if (r) ls.status = { ...r, per: r.last };
  if (!wasTest) ls.pos = Math.min(ls.pos, ls.an ? ls.an.duration : 0); ls.test = null; if (ls.align) { ls.align = null; if (ls.tab === 'bulbs') lsSide(); } lsBar(); lsStatus(); lsPaint();
}
async function lsSeek(t) { t = C.clamp(t, 0, ls.an ? ls.an.duration : 0); ls.pos = t; if (ls.playing && !ls.test) await lsPlay(t); else lsPaint(); lsBar(); }
function lsLoop() {
  if (ls.raf) return;
  const f = () => {
    ls.raf = null; if (!$('#lsRoot')) return;
    if (ls.playing) { ls.pos = lsHeard(); const vw = lsViewW() / ls.pps; if (!ls.test && (ls.pos > ls.t0 + vw * 0.9 || ls.pos < ls.t0)) ls.t0 = Math.max(0, ls.pos - vw * 0.1); if ((ls.frame = (ls.frame || 0) + 1) % 2 === 0) { lsPaint(true); lsTime(); } ls.raf = requestAnimationFrame(f); }
  };
  ls.raf = requestAnimationFrame(f);
}

/* ---------- calibration flash test: a click and a flash every second, compensated per bulb ---------- */
async function lsFlashTest() {
  // A click every second. Each bulb flashes only as often as it can take commands: fast bulbs on every click,
  // slow cloud bulbs (Hubspace) on every 6th click, so their flash and the return to blue both fit.
  const use = ls.lat.filter((l) => l.enabled && l.online);
  if (!use.length) return toast('No connected lights to test.', true);
  if (ls.playing) await lsStop();
  if (!ls.ctx) ls.ctx = new AudioContext({ latencyHint: 'playback' });
  const clicks = 24, sr = ls.ctx.sampleRate, buf = ls.ctx.createBuffer(1, sr * (clicks + 2), sr), d = buf.getChannelData(0);
  const every = (l) => l.speed === 'slow' ? Math.max(2, Math.ceil(l.interval * 2.2 / 1000)) : l.speed === 'medium' ? Math.max(1, Math.ceil(l.interval * 2.2 / 1000)) : 1;
  for (let k = 1; k <= clicks; k++) {
    const s = Math.round(k * sr), loud = use.some((l) => every(l) > 1 && (k - 1) % every(l) === 0); // louder click when the slow bulbs flash
    for (let i = 0; i < sr * 0.03; i++) d[s + i] = Math.sin(2 * Math.PI * (loud ? 900 : 1400) * i / sr) * Math.exp(-i / (sr * 0.008)) * (loud ? 0.9 : 0.45);
  }
  const ids = use.map((l) => l.id), events = [{ id: 't0', t: 0, dur: clicks + 1, lane: 't', type: 'color', rgb: [30, 40, 160], bri: 15, fade: 0, pri: 3 }];
  for (const l of use) for (let k = 1; k <= clicks; k++) if ((k - 1) % every(l) === 0) events.push({ id: `t${k}-${l.id}`, t: k, dur: 0.35, lane: 't', devs: [l.id], type: 'flash', rgb: [255, 255, 255], bri: 100, pri: 3 });
  await lsPlay(0, { show: { lanes: [{ id: 't', name: 'Test', deviceIds: ids }], events }, audio: buf });
  toast('Fast bulbs flash on every click; Hubspace bulbs flash on every 6th (the deeper click). A bulb that flashes after its click needs a higher offset; one that flashes before needs a lower one.', true);
}

/* ---------- page ---------- */
function renderShow(c) {
  if (!ls.ready) { c.innerHTML = '<div class="panel"><div class="empty">Loading Lightshow…</div></div>'; if (!ls.loading) { ls.loading = true; lsInit().then(() => { if (view.t === 'show') render(); }); } return; }
  if ($('#lsRoot')) { if (!busyDrag) { lsStatus(); if (ls.tab === 'bulbs' && !ls.playing) lsSide(); } return; }
  c.innerHTML = `<div id="lsRoot" class="ls">
    <div class="panel"><div class="pb ls-bar" id="lsBar"></div></div>
    <div class="ls-main"><div class="ls-left"><div class="panel ls-tl"><div class="ls-cv" id="lsCv"><canvas id="lsCanvas"></canvas></div>
        <div class="pb ls-trans" id="lsTrans"></div><div class="ls-status" id="lsStatus"></div></div><div class="panel ls-room" id="lsRoom"></div></div>
      <div class="panel ls-side"><div class="pj-tabs" id="lsTabs"></div><div class="pb" id="lsSide"></div></div></div></div>`;
  lsWire(); lsAll();
  if (ls.playing) lsLoop(); // came back to the page mid-show: keep the playhead moving
}
function lsAll() { lsBar(); lsTrans(); lsTabs(); lsSide(); lsPaint(); lsStatus(); lsRoomBuild(); }
function lsBar() {
  const b = $('#lsBar'); if (!b) return; const a = ls.an;
  b.innerHTML = `<button class="btn pri" data-a="import" ${ls.busy ? 'disabled' : ''}>${ico('fx')}Import music…</button>
    <span class="ls-song">${ls.busy ? `<span class="spin"></span>${esc(ls.busy)}` : ls.file ? `<b>${esc(ls.file.name)}</b> <span class="muted">· ${a.bpm} BPM${a.bpmConf < 0.6 ? ' (tempo unsteady)' : ''} · ${fmtT(a.duration)} · ${a.sections.length} sections${a.drops.length ? ' · ' + a.drops.length + ' drop' + (a.drops.length > 1 ? 's' : '') : ''}</span>` : ls.show ? `<b>${esc(ls.show.name)}</b> <span class="muted">· song not loaded</span>` : '<span class="muted">MP3, WAV, FLAC, OGG, M4A. Drop a file here or use Import.</span>'}</span>
    ${ls.err ? `<span class="bad">${esc(ls.err)}</span>` : ''}<span class="sp"></span>
    <button class="btn" data-a="save" ${ls.show && ls.show.events.length ? '' : 'disabled'}>Save show</button><button class="btn" data-a="saveas" ${ls.show && ls.show.events.length ? '' : 'disabled'}>Save as…</button>`;
  lsTrans();
}
function lsTrans() {
  const t = $('#lsTrans'); if (!t) return; const ok = !!(ls.show && ls.audio);
  t.innerHTML = `<button class="btn" data-a="home" ${ok ? '' : 'disabled'} data-tip="Back to the start">⏮</button>
    <button class="btn pri ls-play" data-a="${ls.playing ? 'pause' : 'play'}" ${ok ? '' : 'disabled'}>${ls.playing ? '❚❚ Pause' : '▶ Play'}</button>
    <button class="btn" data-a="stop" ${ls.playing || (ls.status && ls.status.state === 'paused') ? '' : 'disabled'}>■ Stop</button>
    <span class="ls-time" id="lsTime">${fmtT(ls.pos)} / ${fmtT(ls.an ? ls.an.duration : 0)}</span>
    <label class="chk" data-tip="Put every light back how it was when the show stops"><input type="checkbox" id="lsRestore" ${ls.restore ? 'checked' : ''}>Restore lights after</label>
    <span class="sp"></span><label class="chk" data-tip="Dragged events snap to beats"><input type="checkbox" id="lsSnap" ${ls.snap ? 'checked' : ''}>Snap to beats</label>
    <button class="btn" data-a="zout" data-tip="Zoom out (Ctrl+wheel)">−</button><button class="btn" data-a="fit">Fit</button><button class="btn" data-a="zin" data-tip="Zoom in (Ctrl+wheel)">+</button>`;
}
const lsTime = () => { const e = $('#lsTime'); if (e) e.textContent = `${fmtT(ls.pos)} / ${fmtT(ls.an ? ls.an.duration : 0)}`; };
function lsTabs() { const t = $('#lsTabs'); if (t) t.innerHTML = [['gen', 'Generate'], ['fx', 'Effects'], ['event', 'Edit'], ['bulbs', 'Bulbs'], ['shows', 'Shows']].map(([k, l]) => `<button class="${k === ls.tab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join(''); }
function lsStatus() {
  const el = $('#lsStatus'); if (!el) return;
  const st = ls.status, bits = [];
  if (ls.show) bits.push(`${ls.show.events.length} events on ${ls.show.lanes.length} lane${ls.show.lanes.length === 1 ? '' : 's'}`);
  if (ls.plan) bits.push(`${ls.plan.cmds} bulb commands planned, lights get a ${(ls.plan.preRoll / 1000).toFixed(1)} s head start`);
  if (st && st.per) { let s = 0, a = 0, u = 0, f = 0; for (const p of Object.values(st.per)) { s += p.sent; a += p.acked; u += p.unconfirmed; f += p.failed; } if (s) bits.push(`sent ${s}: ${a} confirmed, ${u} unconfirmed (WiZ, no reply by design)${f ? `, <span class="bad">${f} failed</span>` : ''}`); }
  if (st && st.drift) bits.push(`clock correction ${st.drift} ms`);
  const warn = [...((st && st.dropped) || []).map((d) => `${esc(d.name)} left the show: ${esc(d.reason)}`)];
  el.innerHTML = `<span class="muted">${bits.join(' · ')}</span>${warn.length ? `<div class="bad">${warn.join('<br>')}</div>` : ''}`;
}

/* ---------- side panel ---------- */
function lsSide() {
  const el = $('#lsSide'); if (!el) return;
  if (ls.tab === 'gen') return lsSideGen(el);
  if (ls.tab === 'event') return lsSideEvent(el);
  if (ls.tab === 'fx') return lsSideFx(el);
  if (ls.tab === 'bulbs') return lsSideBulbs(el);
  lsSideShows(el);
}
function lsSideGen(el) {
  const o = ls.opts, sl = (k, label, min, max, step, tip) => `<label data-tip="${esc(tip)}">${label}</label><input type="range" data-o="${k}" min="${min}" max="${max}" step="${step}" value="${o[k]}"><span class="muted">${k === 'speed' ? o[k] + '×' : Math.round(o[k] * 100) + '%'}</span>`;
  el.innerHTML = `<div class="f"><label>Style</label><select data-o="style">${Object.entries(LS.STYLES).map(([k, s]) => `<option value="${k}" ${o.style === k ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="f"><label>Colour palette</label><select data-o="palette"><option value="">Style default (${esc(LS.STYLES[o.style].pal || 'varies')})</option>${lsPalOpts(o.palette)}</select>
      <div class="ls-pal">${(LS.PALETTES[o.palette || LS.STYLES[o.style].pal] || []).map((c) => `<i style="background:${hexOf(c)}"></i>`).join('')}</div></div>
    <div class="kvgrid ls-kv">${sl('intensity', 'Intensity', 0, 1, 0.05, 'How hard the lights hit: contrast between beats and the rest')}${sl('complexity', 'Complexity', 0, 1, 0.05, 'How many layers: fills, chases, strobes, more beats')}
      ${sl('brightness', 'Brightness', 0.1, 1, 0.05, 'Top brightness of the whole show')}${sl('speed', 'Speed', 0.25, 4, 0.25, 'How quickly colours move and flashes fade')}
      ${sl('randomness', 'Randomness', 0, 1, 0.05, 'Variation in colours and which beats are used')}${sl('sync', 'Sync strength', 0, 1, 0.05, 'High: lights follow the exact drum hits. Low: a looser, smoother groove on the beat grid')}</div>
    <div class="f"><label>How the show is made</label><select data-o="mode" data-tip="Manual gives you the base colours for each part of the song and an empty effect row to fill"><option value="auto" ${o.mode !== 'manual' ? 'selected' : ''}>Automatic: Lumen picks the effects</option><option value="manual" ${o.mode === 'manual' ? 'selected' : ''}>Manual: I place the effects</option></select></div>
    <label class="chk small" data-tip="Effects and events you added or pasted yourself (yellow outline) stay when you generate again"><input type="checkbox" id="lsKeepUser" ${ls.keepUser ? 'checked' : ''}>Keep my own effects when generating again</label>
    ${lsFxChoices(o)}
    <div class="row wrap" style="margin:8px 0"><button class="btn pri" data-a="gen" ${ls.an ? '' : 'disabled'}>Generate show</button><button class="btn" data-a="vary" ${ls.an ? '' : 'disabled'} data-tip="Same settings, a different take">New variation</button>
      <button class="btn" data-a="regen" ${ls.range && ls.an ? '' : 'disabled'} data-tip="Rebuild only the selected time range (drag across the section strip, or click a section)">Regenerate selection</button></div>
    ${ls.range ? `<div class="muted small">Selected: ${fmtT(ls.range[0])} – ${fmtT(ls.range[1])} <a href="#" data-a="clearrange">clear</a></div>` : '<div class="muted small">Tip: click a section, or drag across the section strip, to pick a range to regenerate.</div>'}
    <div class="sect">Presets</div><div class="row wrap"><select id="lsPreset" style="max-width:160px"><option value="">Choose…</option>${ls.presets.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select>
      <button class="btn" data-a="psave">Save as preset</button><button class="btn" data-a="pdel" ${ls.presets.length ? '' : 'disabled'}>Delete</button></div>
    ${ls.show && (ls.show.clips || []).length ? `<div class="sect">Effects in this show</div><div class="small muted" id="lsFxSum">${lsFxSummary()}</div>` : ''}
    ${ls.plan && ls.plan.warnings.length ? `<div class="sect">Notes for this show</div><div class="note small">${[...new Set(ls.plan.warnings)].slice(0, 6).map(esc).join('<br>')}</div>` : ''}`;
}
// palette menu: the regular palettes, then the high-contrast ones in their own group
const lsPalOpts = (cur) => { const o = (n) => `<option ${cur === n ? 'selected' : ''}>${esc(n)}</option>`, pol = LS.POLAR || [];
  return Object.keys(LS.PALETTES).filter((n) => !pol.includes(n)).map(o).join('') + (pol.length ? `<optgroup label="High contrast">${pol.map(o).join('')}</optgroup>` : ''); };
const THROW_L = [[0, 'Never'], [0.15, 'Occasionally'], [0.5, 'Often'], [1, 'Constantly']];
function lsFxSummary() { const st = LF.stats(ls.show.clips, ls.an && ls.an.duration); return Object.entries(st.by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(LF.EFFECTS[k].name)} ×${n}`).join(' · '); }
function lsFxChoices(o) {
  const fx = o.fx || {}, w = (k) => (fx[k] && fx[k].w != null ? fx[k].w : 1), trig = (k) => (fx[k] && fx[k].trig) || LF.EFFECTS[k].trig;
  const chips = LF.NAMES.filter((k) => k !== 'throw').map((k) => `<label class="chk ls-chip" data-tip="${esc(LF.EFFECTS[k].desc)}"><input type="checkbox" data-fxon="${k}" ${w(k) > 0 ? 'checked' : ''}>${esc(LF.EFFECTS[k].name)}</label>`).join('');
  const tr = THROW_L.reduce((b, x) => (Math.abs(x[0] - o.throwRate) < Math.abs(b[0] - o.throwRate) ? x : b));
  const adv = !ls.fxAdv ? '' : `<div class="ls-fxadv">${LF.NAMES.filter((k) => k !== 'throw' && k !== 'build').map((k) => `<div class="ls-fxrow"><b>${esc(LF.EFFECTS[k].name)}</b>
      <span class="row small"><span class="muted">How often</span><input type="range" data-fxw="${k}" min="0" max="3" step="0.1" value="${w(k)}"><span class="muted" style="min-width:34px">${w(k) <= 0 ? 'never' : w(k) < 0.6 ? 'rarely' : w(k) <= 1.4 ? 'normal' : 'often'}</span></span>
      <span class="row wrap small">${LF.EFFECTS[k].trig.concat(Object.keys(TRIG_L).filter((x) => !LF.EFFECTS[k].trig.includes(x))).filter((x, i, a) => a.indexOf(x) === i).map((x) => `<label class="chk"><input type="checkbox" data-fxtrig="${k}" value="${x}" ${trig(k).includes(x) ? 'checked' : ''}>${TRIG_L[x]}</label>`).join('')}</span></div>`).join('')}</div>`;
  return `<div class="sect">Effects to use</div><div class="ls-chips">${chips}</div>
    <div class="ls-kv2" style="margin-top:6px"><label data-tip="How often colour is thrown across the room from one side to the other">Room throw</label><select data-o="throwRate">${THROW_L.map(([v, l]) => `<option value="${v}" ${tr[0] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label>Throw direction</label><select data-o="throwDir">${Object.entries(LF.DIRS).map(([k, l]) => `<option value="${k}" ${o.throwDir === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label>Throw with</label><select data-o="throwWho">${Object.entries(LF.PARAM.who.opts).map(([k, l]) => `<option value="${k}" ${o.throwWho === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label data-tip="What happens when the music drops">Drops</label><select data-o="dropFx">${[['auto', 'Vary between drops'], ['explosion', 'Explosion'], ['blackout', 'Blackout, then burst'], ['snap', 'Colour snap'], ['strobe', 'Strobe']].map(([k, l]) => `<option value="${k}" ${o.dropFx === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <a href="#" class="small" data-a="fxadv">${ls.fxAdv ? 'Hide' : 'Show'} advanced: how often and when each effect is used</a>${adv}`;
}
function lsSetFx(k, patch) { const fx = { ...(ls.opts.fx || {}) }, cur = fx[k] || { w: 1, trig: LF.EFFECTS[k].trig.slice() }; fx[k] = { ...cur, ...patch }; ls.opts = { ...ls.opts, fx }; }

/* ---------- effect library: every effect with a live preview, try it, add it ---------- */
function lsSideFx(el) {
  const card = (k) => { const E = LF.EFFECTS[k]; return `<div class="ls-fxcard" data-fxk="${k}"><div class="row"><b>${esc(E.name)}</b><span class="sp"></span><span class="muted small">${FX_CAT[E.cat]}</span></div>
    <canvas class="ls-fxprev" data-prev="${k}" width="264" height="22"></canvas><div class="small muted">${esc(E.desc)}</div>
    <div class="row wrap" style="gap:4px;margin-top:3px"><button class="btn mini" data-fxadd="${k}" ${ls.show ? '' : 'disabled'}>Add at playhead</button><button class="btn mini" data-fxroom="${k}" ${ls.show ? '' : 'disabled'} data-tip="Play it in the room preview below, nothing is sent to the lights">Preview in room</button><button class="btn mini" data-fxtry="${k}" data-tip="Play it once on your real lights">Try on lights</button></div></div>`; };
  const mine = ls.myFx.length ? ls.myFx.map((f, i) => `<div class="ls-fxcard"><div class="row"><b>${esc(f.name)}</b><span class="sp"></span><span class="muted small">${f.kind === 'combo' ? `combination of ${f.clips.length}` : esc((LF.EFFECTS[f.fx] || {}).name || '')}</span></div>
    <div class="row wrap" style="gap:4px;margin-top:3px"><button class="btn mini" data-myadd="${i}" ${ls.show ? '' : 'disabled'}>Add at playhead</button>${f.kind !== 'combo' ? `<button class="btn mini" data-mytry="${i}">Try on lights</button>` : ''}<button class="btn mini" data-mydel="${i}">✕</button></div></div>`).join('') : '<p class="muted small">Select an effect on the timeline and use <b>Save as my effect</b>, or select several and use <b>Save as combination</b>.</p>';
  el.innerHTML = `<p class="muted small">Each effect is shown on six imaginary fast bulbs in a row. Slower bulbs (Cync, Hubspace) do a simpler version that fits how often they can change; the Edit tab tells you exactly what each of your bulbs will do.</p>
    ${Object.keys(FX_CAT).map((cat) => `<div class="sect">${FX_CAT[cat]}</div>${LF.NAMES.filter((k) => LF.EFFECTS[k].cat === cat).map(card).join('')}`).join('')}
    <div class="sect">My effects</div>${mine}`;
  lsFxPrevLoop();
}
// mini previews: the real effect code on a virtual row of fast bulbs, looped
const PREV_RIG = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`v${i}`, { brand: 'wiz', name: 'v' + i, pos: { x: 0.05 + 0.18 * i, y: 0.5 } }]));
const PREV_AN = (() => { const beats = []; for (let i = 0; i < 64; i++) beats.push(i * 0.5); return { duration: 32, bpm: 120, beats, downPhase: 0, kicks: beats.map((b, i) => [b, i % 4 ? 0.6 : 1]), snares: beats.filter((_, i) => i % 2).map((b) => [b, 0.7]), hats: [], curve: { dt: 0.1, e: new Array(320).fill(0.5) }, sections: [], drops: [], builds: [] }; })();
function lsPrevStates(k, p) {
  const lanes = [{ id: 'v', name: 'v', deviceIds: Object.keys(PREV_RIG) }], len = k === 'ambient' || k === 'wash' ? 16 : k === 'build' ? 8 : 4;
  const show = { lanes, events: [{ id: 'b', t: 0, dur: 32, lane: 'v', type: 'color', rgb: [20, 30, 70], bri: 25, fade: 0 }], clips: [{ id: 'pv' + k, fx: k, t: 0.25, dur: len, lane: '*', p: { colors: k === 'strobe' ? [[255, 255, 255]] : [[255, 0, 160], [0, 220, 255], [255, 200, 0]], ...(p || {}) } }] };
  const ev = LF.materialize(show, PREV_AN, PREV_RIG).events; return { len: len + 0.75, st: Object.keys(PREV_RIG).map((id) => LS.stateFn(ev.filter((e) => !e.devs || e.devs.includes(id)))) };
}
function lsFxPrevLoop() {
  if (ls.prevRaf) return; ls.prevCache = ls.prevCache || {};
  const f = (now) => {
    ls.prevRaf = null; const cvs = ls.tab === 'fx' ? [...document.querySelectorAll('canvas[data-prev]')] : []; if (!cvs.length) return;
    for (const cv of cvs) { const k = cv.dataset.prev, P = ls.prevCache[k] || (ls.prevCache[k] = lsPrevStates(k)), t = (now / 1000) % P.len, g = cv.getContext('2d');
      g.fillStyle = '#0d0f13'; g.fillRect(0, 0, cv.width, cv.height);
      P.st.forEach((st, i) => { const s2 = st.at(t), a = C.clamp(s2.bri / 100, 0, 1); g.fillStyle = `rgba(${s2.rgb.map(Math.round).join(',')},${(0.08 + 0.92 * a).toFixed(2)})`; g.beginPath(); g.arc(22 + i * 44, 11, 8, 0, 6.3); g.fill(); }); }
    ls.prevRaf = requestAnimationFrame(f);
  };
  ls.prevRaf = requestAnimationFrame(f);
}
// play one clip in the room preview (no commands to the lights)
function lsRoomPreview(clip) {
  if (!ls.show) return; if (ls.roomHidden) { ls.roomHidden = false; lsRoomBuild(); }
  const ids = lsShowIds(), lanes = [{ id: 'pv', name: 'pv', deviceIds: ids }];
  const ev = LF.materialize({ lanes, events: [{ id: 'b', t: 0, dur: 1e4, lane: 'pv', type: 'color', rgb: [20, 30, 70], bri: 20, fade: 0 }], clips: [{ ...JSON.parse(JSON.stringify(clip)), lane: '*', t: 0.2 }] }, ls.an || PREV_AN, lsDevInfo()).events;
  ls.fxPrev = { st: Object.fromEntries(ids.map((id) => [id, LS.stateFn(ev.filter((e) => !e.devs || e.devs.includes(id)))])), t0: performance.now(), len: clip.dur + 1 };
  const f = () => { if (!ls.fxPrev) return; const t = (performance.now() - ls.fxPrev.t0) / 1000; if (t > ls.fxPrev.len) { ls.fxPrev = null; lsRoomUpdate(ls.pos, true); return; } lsRoomUpdate(t, true); requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
// play one clip on the real lights: a silent "song" as long as the clip, every bulb's latency compensated as in a show
async function lsTryOnLights(clip) {
  const use = ls.lat.filter((l) => l.enabled && l.online); if (!use.length) return toast('No connected lights to try it on.', true);
  if (ls.playing) await lsStop(); if (!ls.ctx) ls.ctx = new AudioContext({ latencyHint: 'playback' });
  const ids = use.map((l) => l.id), lanes = [{ id: 't', name: 'Try', deviceIds: ids }], len = clip.dur + 1.2;
  const base = { id: 'b', t: 0, dur: len, lane: 't', type: 'color', rgb: [20, 30, 90], bri: 20, fade: 0, pri: 3 };
  const events = LF.materialize({ lanes, events: [base], clips: [{ ...JSON.parse(JSON.stringify(clip)), lane: '*', devs: clip.devs, t: 0.6 }] }, ls.an || PREV_AN, lsDevInfo()).events;
  const buf = ls.ctx.createBuffer(1, Math.ceil(ls.ctx.sampleRate * (len + 0.5)), ls.ctx.sampleRate);
  await lsPlay(0, { show: { lanes, events }, audio: buf });
}
function lsSideEvent(el) {
  const sel = lsSelItems(), tracks = lsTracks();
  const addBar = `<div class="sect">Add an effect at the playhead</div><div class="row wrap"><select id="lsAddFx" style="max-width:150px">${LF.NAMES.map((k) => `<option value="${k}" ${(ls.lastFx || 'flash') === k ? 'selected' : ''}>${esc(LF.EFFECTS[k].name)}</option>`).join('')}</select><button class="btn" data-a="addfx" ${ls.show ? '' : 'disabled'}>Add effect</button></div>
    <div class="sect">Add a single event</div><div class="row wrap">${TYPES.map(([k, l]) => `<button class="btn" data-add="${k}" ${ls.show ? '' : 'disabled'}>${l.replace(' (base)', '')}</button>`).join('')}</div>
    <p class="muted small">Double-click a lane's effect row to add an effect, or below it to add a flash. Delete, Ctrl+C / Ctrl+V / Ctrl+D, arrows nudge, Ctrl+Z undo.</p>`;
  if (!sel.length) { el.innerHTML = '<p class="muted">Click an event on the timeline to edit it. Shift+click selects more.</p>' + addBar; return; }
  if (sel.length > 1) {
    el.innerHTML = `<p><b>${sel.length} events selected</b></p><div class="f"><label>Set colour for all</label><input type="color" id="lsMultiCol" value="${hexOf(sel[0].rgb)}"></div>
      <div class="f"><label>Brightness for all</label><input type="range" id="lsMultiBri" min="0" max="100" value="${sel[0].bri}"></div>
      <div class="row"><button class="btn" data-a="dup">Duplicate</button><button class="btn" data-a="copy">Copy</button><button class="btn" data-a="del">Delete</button></div>
      ${sel.some(isClip) ? `<div class="row" style="margin-top:6px"><button class="btn" data-a="savecombo" data-tip="Save the selected effects, with their timing, as one reusable combination">Save as combination…</button></div>` : ''}` + addBar; return;
  }
  if (isClip(sel[0])) return lsSideClip(el, sel[0], addBar);
  const e = sel[0], base = !LS.isOverlay(e.type);
  el.innerHTML = `<div class="kvgrid ls-kv2">
    <label>Type</label><select data-e="type">${TYPES.map(([k, l]) => `<option value="${k}" ${e.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Lane</label><select data-e="lane">${tracks.map((t) => `<option value="${esc(t.id)}" ${e.lane === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <label>Start (s)</label><input type="number" data-e="t" step="0.01" min="0" value="${e.t}">
    <label>Length (s)</label><input type="number" data-e="dur" step="0.01" min="0.04" value="${e.dur}">
    <label>Colour</label><input type="color" data-e="rgb" value="${hexOf(e.rgb)}">
    <label>Brightness</label><input type="range" data-e="bri" min="0" max="100" value="${e.bri}">
    ${base ? `<label data-tip="Seconds to reach this colour from the one before">Fade in (s)</label><input type="number" data-e="fade" step="0.05" min="0" value="${e.fade || 0}">
      <label data-tip="Optional: drift to a second colour by the end of the event">End colour</label><span class="row"><label class="chk"><input type="checkbox" data-e="has2" ${e.rgb2 ? 'checked' : ''}>use</label><input type="color" data-e="rgb2" value="${hexOf(e.rgb2 || e.rgb)}" ${e.rgb2 ? '' : 'disabled'}></span>
      <label>End brightness</label><input type="range" data-e="bri2" min="0" max="100" value="${e.bri2 != null ? e.bri2 : e.bri}">` : ''}
    ${e.type === 'strobe' ? `<label>Flashes / s</label><input type="number" data-e="hz" min="1" max="10" step="0.5" value="${e.hz || 5}">` : ''}
    <label data-tip="When a bulb can't keep up, higher priority events win">Priority</label><select data-e="pri">${[1, 2, 3].map((p) => `<option ${(e.pri || 1) === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    ${e.devs ? `<p class="muted small">Only on: ${e.devs.map((id) => esc((dev(id) || {}).name || id)).join(', ')} <a href="#" data-a="alldevs">use the whole lane</a></p>` : ''}
    <div class="row" style="margin-top:6px"><button class="btn" data-a="dup">Duplicate</button><button class="btn" data-a="copy">Copy</button><button class="btn" data-a="del">Delete</button></div>` + addBar;
}
function lsSideClip(el, c, addBar) {
  const E = LF.EFFECTS[c.fx], p = c.p, tracks = lsTracks(), bt = ls.an ? 60 / ls.an.bpm : 0.5, note = ls.notes[c.id] || {};
  const laneIds = c.lane === '*' ? lsShowIds() : ((tracks.find((t) => t.id === c.lane) || {}).deviceIds || []);
  const field = (k) => { const P = LF.PARAM[k], v = p[k], tip = P.tip ? ` data-tip="${esc(P.tip)}"` : '';
    if (P.kind === 'select') return `<label${tip}>${P.label}</label><select data-c="${k}">${Object.entries(P.opts).map(([o, l]) => `<option value="${o}" ${v === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (P.kind === 'bool') return `<label${tip}>${P.label}</label><label class="chk"><input type="checkbox" data-c="${k}" ${v ? 'checked' : ''}>on</label>`;
    if (P.kind === 'pct') return `<label${tip}>${P.label}</label><span class="row"><input type="range" data-c="${k}" min="0" max="1" step="${P.step}" value="${v}"><span class="muted small" style="min-width:32px">${Math.round(v * 100)}%</span></span>`;
    return `<label${tip}>${P.label}</label><input type="number" data-c="${k}" min="${P.min}" max="${P.max}" step="${P.step}" value="${v}">`; };
  const cols = p.colors.map((col, i) => `<input type="color" data-ccol="${i}" value="${hexOf(col)}">`).join('');
  const pals = lsPalOpts('');
  const notes = Object.entries(note).filter(([k]) => SPEED_L[k]).map(([k, v]) => `<div>${SPEED_L[k]}: <b>${esc(v)}</b></div>`).join('');
  el.innerHTML = `<div class="row"><b style="font-size:13px">${esc(E.name)}</b><span class="sp"></span>${c.user ? '<span class="muted small">added by you</span>' : '<span class="muted small">generated</span>'}</div>
    <p class="muted small" style="margin:2px 0 6px">${esc(E.desc)}</p>
    <div class="kvgrid ls-kv2">
      <label>Effect</label><select data-c="fx">${LF.NAMES.map((k) => `<option value="${k}" ${k === c.fx ? 'selected' : ''}>${esc(LF.EFFECTS[k].name)}</option>`).join('')}</select>
      <label>Lane</label><select data-c="lane">${tracks.map((t) => `<option value="${esc(t.id)}" ${c.lane === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <label>Start (s)</label><input type="number" data-c="t" step="0.01" min="0" value="${c.t}">
      <label data-tip="${(c.dur / bt).toFixed(1)} beats">Length (s)</label><input type="number" data-c="dur" step="0.05" min="0.05" value="${c.dur}">
      <label>Colours</label><span class="row wrap ls-cols">${cols}<button class="btn mini" data-a="ccoladd" ${p.colors.length >= 6 ? 'disabled' : ''}>+</button><button class="btn mini" data-a="ccoldel" ${p.colors.length <= 1 ? 'disabled' : ''}>−</button></span>
      <label>Palette</label><span class="row"><select id="lsClipPal"><option value="">Use a palette…</option>${pals}</select><button class="btn mini" data-a="ccontrast" data-tip="Make the second colour the strongest contrast to the first">Contrast</button></span>
      ${E.params.map(field).join('')}
    </div>
    <div class="sect">Bulbs</div><div class="row wrap small">${laneIds.map((id) => { const d = dev(id); return `<label class="chk"><input type="checkbox" data-cdev="${esc(id)}" ${!c.devs || c.devs.includes(id) ? 'checked' : ''}>${esc(d ? d.name : id)}</label>`; }).join('') || '<span class="muted">No bulbs in this lane.</span>'}</div>
    ${notes ? `<div class="sect">What your bulbs will do</div><div class="small">${notes}</div>` : ''}
    <div class="row wrap" style="margin-top:8px;gap:4px"><button class="btn" data-a="cprev">Preview in room</button><button class="btn" data-a="ctry">Try on lights</button></div>
    <div class="row wrap" style="margin-top:4px;gap:4px"><button class="btn" data-a="dup">Duplicate</button><button class="btn" data-a="copy">Copy</button><button class="btn" data-a="del">Delete</button><button class="btn" data-a="savefx">Save as my effect…</button></div>` + addBar;
}
// change one setting of the selected clip
function lsClipField(t, commit) {
  const c = lsClip([...ls.sel][0]); if (!c) return; if (!ls.editPushed) { lsPush(); ls.editPushed = true; } if (commit) ls.editPushed = false;
  const k = t.dataset.c, P = LF.PARAM[k];
  if (k === 'fx') { const keep = { colors: c.p.colors, bri: c.p.bri, who: c.p.who, fadeIn: c.p.fadeIn, fadeOut: c.p.fadeOut }; c.fx = t.value; c.p = LF.normParams(c.fx, keep); ls.lastFx = c.fx; }
  else if (k === 'lane') { c.lane = t.value; delete c.devs; }
  else if (k === 't') c.t = Math.max(0, +t.value || 0);
  else if (k === 'dur') c.dur = Math.max(0.05, +t.value || 0.05);
  else if (P && P.kind === 'bool') c.p[k] = t.checked;
  else if (P && P.kind === 'select') c.p[k] = t.value;
  else if (P) { c.p[k] = +t.value; const sp = t.nextElementSibling; if (sp && P.kind === 'pct') sp.textContent = Math.round(+t.value * 100) + '%'; }
  c.p = LF.normParams(c.fx, c.p); c.user = true;
  if (commit) lsChanged(); else lsChangedSoon();
}
/* ---------- "Line up the lights": one brand at a time changes colour on a click; the user only says early / together / late ---------- */
// Each group changes only as often as its slowest bulb can (WiZ every second, Hubspace every 3 s) and the click sounds
// only when that group should change, so there is one thing to watch and one thing to hear. Every answer shifts the
// group's offset at once and the test restarts with it; the step halves whenever the answer flips, down to 10 ms.
function lsAlignGroups() {
  const by = {}; for (const l of ls.lat) if (l.enabled && l.online) (by[l.brand] = by[l.brand] || []).push(l);
  return ['wiz', 'cync', 'hubspace'].filter((b) => by[b]).map((b) => { const iv = Math.max(...by[b].map((l) => l.interval)); return { brand: b, name: BRANDS[b] || b, ids: by[b].map((l) => l.id), period: Math.max(1, Math.ceil(iv * 1.2 / 1000)), slow: iv > 700 }; });
}
async function lsAlignStart() {
  const groups = lsAlignGroups(); if (!groups.length) return toast('No connected lights to line up.', true);
  if (ls.playing) await lsStop();
  ls.align = { groups, i: 0, step: 0, dir: 0, moved: 0 }; await lsAlignPlay();
}
async function lsAlignPlay() {
  const a = ls.align; if (!a) return; const g = a.groups[a.i]; if (!a.step) a.step = g.slow ? 160 : 40;
  if (!ls.ctx) ls.ctx = new AudioContext({ latencyHint: 'playback' });
  const len = 120, sr = ls.ctx.sampleRate, key = g.period + ':' + sr;
  if (!a.buf || a.bufKey !== key) { const buf = ls.ctx.createBuffer(1, sr * (len + 1), sr), d = buf.getChannelData(0);
    for (let t = g.period; t < len; t += g.period) { const s0 = Math.round(t * sr); for (let i = 0; i < sr * 0.03; i++) d[s0 + i] = Math.sin(2 * Math.PI * 1200 * i / sr) * Math.exp(-i / (sr * 0.008)) * 0.8; }
    a.buf = buf; a.bufKey = key; }
  const all = a.groups.flatMap((q) => q.ids), events = [{ id: 'a0', t: 0, dur: len, lane: 't', type: 'color', rgb: [30, 40, 160], bri: 12, fade: 0, pri: 3 }];
  for (let t = g.period, k = 0; t < len; t += g.period, k++) events.push({ id: 'a' + t, t, dur: g.period, lane: 't', devs: g.ids, type: 'color', rgb: k % 2 ? [30, 40, 160] : [255, 255, 255], bri: k % 2 ? 12 : 100, fade: 0, pri: 3 });
  await lsPlay(0, { show: { lanes: [{ id: 't', name: 'Line up', deviceIds: all }], events }, audio: a.buf });
  if (ls.tab === 'bulbs') lsSide();
}
async function lsAlignAnswer(dir) { // -1: light changes before the click, +1: after it, 0: together
  const a = ls.align; if (!a || a.busy) return; a.busy = true;
  try {
    if (dir === 0) { a.i++; a.step = 0; a.dir = 0; a.moved = 0; if (a.i >= a.groups.length) { ls.align = null; await lsStop(); ls.lat = await call('latency:get'); lsSide(); lsPlanSoon(); toast('Lights lined up. The timing is saved and used for every show.', true); return; } await lsAlignPlay(); return; }
    const g = a.groups[a.i]; if (a.dir && a.dir !== dir) a.step = Math.max(10, Math.round(a.step / 2 / 5) * 5); a.dir = dir;
    for (const id of g.ids) { const l = ls.lat.find((q) => q.id === id); Object.assign(l, await call('latency:set', id, { offset: (l.offset || 0) + dir * a.step })); }
    a.moved += dir * a.step; await lsAlignPlay();
  } finally { a.busy = false; }
}
function lsAlignPanel() {
  const a = ls.align; if (!a) return `<div class="ls-align"><button class="btn pri" data-a="align">Line up the lights…</button><div class="muted small">Plays a click and changes one kind of bulb at a time. You only answer: early, together or late.</div></div>`;
  const g = a.groups[a.i];
  return `<div class="ls-align on"><div class="row"><b>Step ${a.i + 1} of ${a.groups.length}: ${esc(g.name)}</b><span class="sp"></span><span class="muted small">${g.ids.length} light${g.ids.length === 1 ? '' : 's'}</span></div>
    <div class="small">Watch the ${esc(g.name)} light${g.ids.length === 1 ? '' : 's'}. ${g.ids.length === 1 ? 'It changes' : 'They change'} colour every ${g.period === 1 ? 'second' : g.period + ' seconds'}, and a click plays when ${g.ids.length === 1 ? 'it' : 'they'} should. Does the light change before the click, with it, or after it?</div>
    <div class="ls-alignbtns"><button class="btn" data-align="-1">◀ Early</button><button class="btn pri" data-align="0">✔ Together</button><button class="btn" data-align="1">Late ▶</button></div>
    <div class="row small muted"><span id="lsAlignInfo">Moved ${a.moved > 0 ? '+' : ''}${a.moved} ms so far · next step ${a.step} ms</span><span class="sp"></span><a href="#" data-a="alignstop">Stop</a></div>
    <div class="muted small">Keys: ← early · Enter together · → late. After each answer the test restarts with the new timing${g.slow ? ' (these bulbs are slow, so give it a few changes)' : ''}.</div></div>`;
}
function lsSideBulbs(el) {
  const spd = { fast: 'beat-fast', medium: 'medium', slow: 'slow (sections only)' };
  el.innerHTML = `${lsAlignPanel()}<p class="muted small">Every effect adapts to each bulb: WiZ bulbs do the full effect (beats, strobes, chases); Cync bulbs do a simpler, slower version; Hubspace bulbs change at most every ~2.5 s, so they take section colours, washes, snaps on bars and big hits. Bulbs placed in the Room Visualizer get waves, chases, explosions and (if you turn them on) room throws by position. Each bulb's commands are sent early by its latency, so all lights change together on the beat. Defaults are estimates; <b>Measure</b> times each bulb's confirmations; the <b>flash test</b> lets you fine-tune by eye. Network and cloud delays vary from moment to moment, so this narrows the gap but can't remove it completely.</p>
    <div class="sect">Fine-tune each light (advanced)</div>
    <div class="row wrap" style="margin-bottom:8px"><button class="btn" data-a="measure">${ls.measuring ? '<span class="spin"></span>Measuring…' : 'Measure latency'}</button><button class="btn" data-a="ftest">Flash test (clicks)</button></div>
    <div class="ls-bulbs">${ls.lat.map((l) => `<div class="ls-bulb ${l.online ? '' : 'off'}" data-id="${esc(l.id)}">
      <div class="row"><label class="chk"><input type="checkbox" data-l="enabled" ${l.enabled ? 'checked' : ''}><b>${esc(l.name)}</b></label><span class="sp"></span><span class="muted small">${BRANDS[l.brand] || l.brand} · ${spd[l.speed]}${l.online ? '' : ' · offline'}</span></div>
      <div class="row small"><span data-tip="${l.ms != null ? esc(l.source) + (l.rtt ? ` (round trip ${l.rtt.min}–${l.rtt.max} ms)` : '') : 'Default estimate for this brand'}">Latency <input type="number" data-l="ms" value="${l.ms != null ? l.ms : ''}" placeholder="${l.def}" min="0" max="5000" style="width:58px"> ms</span>
        <span data-tip="Manual correction added to the latency. + sends earlier.">Offset <button class="btn mini" data-off="-10">−</button><input type="number" data-l="offset" value="${l.offset}" step="5" style="width:52px"><button class="btn mini" data-off="10">+</button></span></div>
      <div class="small ls-live" data-live="${esc(l.id)}"></div></div>`).join('') || '<p class="muted">No lights connected.</p>'}</div>`;
  lsLiveBulbs();
}
function lsLiveBulbs() {
  const st = ls.status; if (!st || !st.per) return;
  for (const [id, p] of Object.entries(st.per)) { const e = $(`[data-live="${CSS.escape(id)}"]`); if (!e) continue; e.innerHTML = `sent ${p.sent}${p.acked ? `, confirmed ${p.acked}${p.ackMs ? ` (~${p.ackMs} ms)` : ''}` : ''}${p.unconfirmed ? `, ${p.unconfirmed} unconfirmed` : ''}${p.failed ? `, <span class="bad">${p.failed} failed</span>` : ''}${p.coalesced ? `, ${p.coalesced} merged` : ''}${p.health ? ` · ${esc(p.health)}` : ''}${p.mismatch ? ` · <span class="bad">reported a different colour ${p.mismatch}×</span>` : ''}`; }
}
function lsSideShows(el) {
  el.innerHTML = `<div class="f"><label>Show name</label><input type="text" id="lsName" value="${esc(ls.show ? ls.show.name : '')}" ${ls.show ? '' : 'disabled'} maxlength="60"></div>
    <div class="sect">Saved shows</div><div class="ls-shows">${ls.shows.map((s) => `<div class="row ls-showrow"><span class="sp"><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.song || '')} · ${fmtT(s.duration)} · ${esc((LS.STYLES[s.style] || {}).name || '')} · ${s.events} events</span></span><button class="btn" data-open="${esc(s.id)}">Open</button><button class="btn mini" data-delshow="${esc(s.id)}">✕</button></div>`).join('') || '<p class="muted">No saved shows yet.</p>'}</div>`;
}

/* ---------- timeline canvas ---------- */
const lsViewW = () => { const c = $('#lsCv'); return c ? c.clientWidth - HEAD_W : 800; };
function lsFit() { if (ls.an) { ls.pps = Math.max(2, lsViewW() / ls.an.duration); ls.t0 = 0; } }
const tx = (t) => HEAD_W + (t - ls.t0) * ls.pps, xt = (x) => ls.t0 + (x - HEAD_W) / ls.pps;
function lsPaint(fast) {
  lsRoomUpdate(ls.pos, !fast);
  const cv = $('#lsCanvas'), box = $('#lsCv'); if (!cv || !box) return;
  const tracks = lsTracks(), W = box.clientWidth, H = topH() + tracks.length * LANE_H + 4, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  // Everything except the playhead is drawn once into an off-screen copy; during playback only the playhead moves.
  const key = [ls.t0, ls.pps, cv.width, cv.height].join();
  if (!fast || ls.cacheKey !== key || !ls.cacheCv) {
    const off = ls.cacheCv || (ls.cacheCv = document.createElement('canvas')); if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
    lsPaintStatic(off, tracks, W, H, dpr); ls.cacheKey = key;
  }
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(ls.cacheCv, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!ls.an) return;
  const px = tx(ls.pos); if (px >= HEAD_W) { g.fillStyle = '#ff3b3b'; g.fillRect(px - 0.5, 0, 2, H); g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 6, 0); g.lineTo(px + 0.5, 7); g.fill(); }
  if (ls.drag && ls.drag.box) { const b = ls.drag.box; g.strokeStyle = '#5ab0ff'; g.setLineDash([4, 3]); g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.setLineDash([]); }
}
function lsPaintStatic(cv, tracks, W, H, dpr) {
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#16191f'; g.fillRect(0, 0, W, H);
  const an = ls.an, t1 = xt(W);
  if (!an) { g.fillStyle = '#9aa4b2'; g.font = '13px Segoe UI, Tahoma, sans-serif'; g.fillText(ls.show ? 'Load the song for this show (Import music…) to see and play it.' : 'Import a song to begin. Lumen analyses it, then builds a light show you can edit here.', HEAD_W + 14, 40); lsHeads(g, tracks, H); return; }
  const yS = TOP.ruler, yW = yS + TOP.sec, yE = yW + TOP.wave, yL = yE + TOP.energy;
  g.save(); g.beginPath(); g.rect(HEAD_W, 0, W - HEAD_W, H); g.clip();
  // sections
  for (const s of an.sections) { const x0 = tx(s.t0), x1 = tx(s.t1); if (x1 < HEAD_W || x0 > W) continue; g.fillStyle = SEC_COL[s.label] || '#555'; g.fillRect(x0, yS + 1, x1 - x0 - 1, TOP.sec - 2); g.fillStyle = '#fff'; g.font = '11px Segoe UI, Tahoma, sans-serif'; if (x1 - x0 > 40) g.fillText(`${s.label}${s.vocal ? ' · vocal?' : ''} ${String.fromCharCode(65 + (s.group % 26))}`, Math.max(x0, HEAD_W) + 4, yS + 13); }
  for (const d of an.drops) { const x = tx(d.t); g.fillStyle = '#ff5a4a'; g.beginPath(); g.moveTo(x, yS + TOP.sec); g.lineTo(x - 5, yS + 2); g.lineTo(x + 5, yS + 2); g.fill(); }
  if (ls.range) { g.fillStyle = 'rgba(80,170,255,.18)'; g.fillRect(tx(ls.range[0]), yS, (ls.range[1] - ls.range[0]) * ls.pps, H - yS); g.strokeStyle = '#5ab0ff'; g.strokeRect(tx(ls.range[0]) + 0.5, yS + 0.5, (ls.range[1] - ls.range[0]) * ls.pps, TOP.sec - 1); }
  // waveform
  const wv = an.wave, mid = yW + TOP.wave / 2, amp = TOP.wave / 2 - 3; g.fillStyle = '#4c8fd6';
  for (let x = Math.max(HEAD_W, 0); x < W; x++) { const a = Math.floor(xt(x) * wv.rate), b = Math.max(a + 1, Math.floor(xt(x + 1) * wv.rate)); let lo = 0, hi = 0; for (let i = Math.max(0, a); i < Math.min(b, wv.d.length / 2); i++) { lo = Math.min(lo, wv.d[2 * i]); hi = Math.max(hi, wv.d[2 * i + 1]); } g.fillRect(x, mid - hi / 127 * amp, 1, Math.max(1, (hi - lo) / 127 * amp)); }
  // beats (downbeats brighter)
  const showB = ls.pps * (60 / an.bpm) > 4;
  an.beats.forEach((t, i) => { if (t < ls.t0 || t > t1) return; const down = ((i - an.downPhase) % 4 + 4) % 4 === 0; if (!down && !showB) return; g.fillStyle = down ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.12)'; g.fillRect(Math.round(tx(t)), yW, 1, H - yW); });
  // energy curve
  const ce = an.curve; g.strokeStyle = '#f0b23a'; g.beginPath();
  for (let x = HEAD_W; x < W; x += 2) { const v = ce.e[C.clamp(Math.floor(xt(x) / ce.dt), 0, ce.e.length - 1)]; const y = yE + TOP.energy - 2 - v * (TOP.energy - 4); x === HEAD_W ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  // lanes
  tracks.forEach((tr, li) => {
    const y = yL + li * LANE_H; g.fillStyle = li % 2 ? '#1b1f26' : '#1e232b'; g.fillRect(HEAD_W, y, W - HEAD_W, LANE_H);
    const au = ls.auto[tr.id];
    if (au) { for (let x = HEAD_W; x < W; x += 2) { const s = au[C.clamp(Math.floor(xt(x) * 10), 0, au.length - 1)]; if (!s) continue; const k = s.bri / 100; g.fillStyle = `rgb(${s.rgb.map((v) => Math.round(v * (0.25 + 0.75 * k))).join(',')})`; g.fillRect(x, y + LANE_H - 8, 2, 6); }
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.beginPath(); for (let x = HEAD_W; x < W; x += 2) { const s = au[C.clamp(Math.floor(xt(x) * 10), 0, au.length - 1)]; const yy = y + LANE_H - 9 - (s ? s.bri / 100 : 0) * 8; x === HEAD_W ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
    if (!ls.show) return;
    for (const e of ls.show.events) {
      if (e.fx || e.lane !== tr.id || e.t > t1 || e.t + e.dur < ls.t0) continue; // effect output is shown by its clip
      const x = tx(e.t), w = Math.max(3, e.dur * ls.pps), base = !LS.isOverlay(e.type), top = y + (base ? 3 : CLIP_Y + CLIP_H + 2), h = base ? 10 : LANE_H - CLIP_Y - CLIP_H - 13;
      const c1 = hexOf(e.rgb), c2 = hexOf(e.rgb2 || (base ? e.rgb : [20, 20, 20]));
      if (e.type === 'blackout') g.fillStyle = '#000'; else if (w > 6) { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, c1); gr.addColorStop(1, e.type === 'flash' || e.type === 'pulse' ? 'rgba(0,0,0,.2)' : c2); g.fillStyle = gr; } else g.fillStyle = c1;
      g.globalAlpha = 0.35 + 0.65 * (e.bri / 100); g.fillRect(x, top + (base ? 0 : h * (1 - Math.max(0.25, e.bri / 100))), w, base ? h : h * Math.max(0.25, e.bri / 100)); g.globalAlpha = 1;
      if (e.type === 'strobe') { g.fillStyle = '#fff'; for (let k = 0; k < e.dur * (e.hz || 5); k++) g.fillRect(x + k / (e.hz || 5) * ls.pps, top, Math.max(1, 0.5 / (e.hz || 5) * ls.pps), 3); }
      if (e.devs) { g.fillStyle = '#ffd23b'; g.fillRect(x, top + h - 2, Math.min(w, 6), 2); }
      if (ls.sel.has(e.id)) { g.strokeStyle = '#5ab0ff'; g.lineWidth = 2; g.strokeRect(x - 1, top - 1, w + 2, h + 2); g.lineWidth = 1; }
    }
    for (const c of ls.show.clips || []) {
      if (c.lane !== tr.id || c.t > t1 || c.t + c.dur < ls.t0) continue;
      const x = tx(c.t), w = Math.max(4, c.dur * ls.pps), top = y + CLIP_Y, h = CLIP_H, cols = (c.p && c.p.colors) || [[255, 255, 255]];
      const gr = g.createLinearGradient(x, 0, x + w, 0); cols.forEach((col, i) => gr.addColorStop(cols.length > 1 ? i / (cols.length - 1) : 0, hexOf(c.fx === 'blackout' ? [30, 30, 30] : col)));
      g.globalAlpha = 0.85; g.fillStyle = gr; g.fillRect(x, top, w, h); g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, top, w, h);
      g.strokeStyle = c.user ? '#ffd23b' : 'rgba(255,255,255,.45)'; g.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
      if (w > 26) { g.save(); g.beginPath(); g.rect(x, top, w - 2, h); g.clip(); g.fillStyle = '#fff'; g.font = '11px Segoe UI, Tahoma, sans-serif'; g.fillText((LF.EFFECTS[c.fx] || { name: c.fx }).name + (c.devs ? ' •' : ''), x + 4, top + 12); g.restore(); }
      if (ls.sel.has(c.id)) { g.strokeStyle = '#5ab0ff'; g.lineWidth = 2; g.strokeRect(x - 1, top - 1, w + 2, h + 2); g.lineWidth = 1; }
    }
  });
  // ruler
  g.fillStyle = '#0f1115'; g.fillRect(HEAD_W, 0, W, TOP.ruler); g.fillStyle = '#9aa4b2'; g.font = '10px Segoe UI, Tahoma, sans-serif';
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * ls.pps > 60) || 120;
  for (let t = Math.floor(ls.t0 / step) * step; t < t1; t += step) { const x = tx(t); g.fillRect(x, TOP.ruler - 6, 1, 6); g.fillText(fmtT(t).replace(/\.0$/, ''), x + 3, 11); }
  g.restore();
  lsHeads(g, tracks, H);
}
function lsHeads(g, tracks, H) {
  g.fillStyle = '#23272f'; g.fillRect(0, 0, HEAD_W, H); g.fillStyle = '#c8d0db'; g.font = '11px Segoe UI, Tahoma, sans-serif';
  const yL = topH(); [['Sections', TOP.ruler + 13], ['Waveform', TOP.ruler + TOP.sec + 14], ['Energy', TOP.ruler + TOP.sec + TOP.wave + 14]].forEach(([l, y]) => { g.fillStyle = '#8b95a3'; g.fillText(l, 8, y); });
  tracks.forEach((tr, i) => {
    const y = yL + i * LANE_H; g.fillStyle = '#2c313a'; g.fillRect(0, y, HEAD_W - 1, LANE_H - 1); g.fillStyle = '#e3e8ef'; g.fillText(tr.name.length > 16 ? tr.name.slice(0, 15) + '…' : tr.name, 8, y + 16);
    g.fillStyle = '#8b95a3'; g.fillText(tr.id === '*' ? 'every light' : `${tr.deviceIds.length} light${tr.deviceIds.length === 1 ? '' : 's'}`, 8, y + 30);
  });
}
function lsHit(x, y) { // -> { zone, ev?, edge?, lane? }
  const yL = topH(); if (y < TOP.ruler) return { zone: 'ruler' }; if (y < TOP.ruler + TOP.sec) return { zone: 'sec' }; if (y < yL) return { zone: 'wave' };
  const li = Math.floor((y - yL) / LANE_H), tr = lsTracks()[li]; if (!tr) return { zone: 'none' };
  if (ls.show) { const t = xt(x), yy = y - yL - li * LANE_H, near = (e) => e.lane === tr.id && t >= e.t - 3 / ls.pps && t <= e.t + Math.max(e.dur, 3 / ls.pps) + 3 / ls.pps;
    const edge = (ev) => Math.abs(x - tx(ev.t + ev.dur)) < 5 && ev.dur * ls.pps > 10;
    if (yy >= CLIP_Y && yy < CLIP_Y + CLIP_H) { const c = (ls.show.clips || []).filter(near).pop(); if (c) return { zone: 'ev', ev: c, lane: tr, edge: edge(c) }; }
    const cands = ls.show.events.filter((e) => !e.fx && near(e) && (LS.isOverlay(e.type) ? yy >= CLIP_Y + CLIP_H : yy < CLIP_Y));
    const ev = cands.pop(); if (ev) return { zone: 'ev', ev, lane: tr, edge: edge(ev) }; }
  return { zone: 'lane', lane: tr };
}
const lsSnapT = (t) => { if (!ls.snap || !ls.an) return t; const bs = ls.an.beats, half = []; let best = t, bd = 8 / ls.pps; for (let i = 0; i < bs.length; i++) { const d = Math.abs(bs[i] - t); if (d < bd) { bd = d; best = bs[i]; } const m = i + 1 < bs.length ? (bs[i] + bs[i + 1]) / 2 : null; if (m !== null && Math.abs(m - t) < bd && ls.pps > 60) { bd = Math.abs(m - t); best = m; } } void half; return +best.toFixed(3); };

function lsWire() {
  const root = $('#lsRoot'), cv = $('#lsCanvas'), box = $('#lsCv');
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'), tab = e.target.closest('[data-tab]');
    if (tab) { ls.tab = tab.dataset.tab; lsTabs(); lsSide(); return; }
    const nv = e.target.closest('[data-nav]'); if (nv) { e.preventDefault(); go(nv.dataset.nav); return; }
    const add = e.target.closest('[data-add]'); if (add) return lsAdd(add.dataset.add, ls.pos, ls.sel.size ? (lsEvent([...ls.sel][0]) || {}).lane : '*');
    const off = e.target.closest('[data-off]'); if (off) { const id = off.closest('[data-id]').dataset.id, l = ls.lat.find((q) => q.id === id); l.offset = (l.offset || 0) + +off.dataset.off; await call('latency:set', id, { offset: l.offset }); lsSide(); lsPlanSoon(); return; }
    const al = e.target.closest('[data-align]'); if (al) return lsAlignAnswer(+al.dataset.align);
    const op = e.target.closest('[data-open]'); if (op) return lsOpen(op.dataset.open);
    const fa = e.target.closest('[data-fxadd]'); if (fa) { ls.lastFx = fa.dataset.fxadd; lsAddClip(fa.dataset.fxadd, ls.pos, '*'); return; }
    const fr = e.target.closest('[data-fxroom]'); if (fr) { const k = fr.dataset.fxroom; lsRoomPreview(LF.newClip(k, 0, (60 / (ls.an ? ls.an.bpm : 120)) * (FX_LEN[k] || 8), { p: { colors: [[255, 0, 160], [0, 220, 255], [255, 200, 0]] } })); return; }
    const ft = e.target.closest('[data-fxtry]'); if (ft) { const k = ft.dataset.fxtry; lsTryOnLights(LF.newClip(k, 0, (60 / (ls.an ? ls.an.bpm : 120)) * Math.min(16, FX_LEN[k] || 8), { p: { colors: [[255, 0, 160], [0, 220, 255]] } })); return; }
    const ma = e.target.closest('[data-myadd]'); if (ma) { const f = ls.myFx[+ma.dataset.myadd]; if (f) { if (f.kind === 'combo') lsAddCombo(f, ls.pos, '*'); else lsAddClip(f.fx, ls.pos, '*', f); } return; }
    const mt = e.target.closest('[data-mytry]'); if (mt) { const f = ls.myFx[+mt.dataset.mytry]; if (f) lsTryOnLights(LF.newClip(f.fx, 0, f.dur || 4, { p: f.p })); return; }
    const md = e.target.closest('[data-mydel]'); if (md) { const f = ls.myFx[+md.dataset.mydel]; if (f && await confirmBox('Delete effect', `Delete "${f.name}" from My effects? Shows that use it keep their copy.`, 'Delete')) { ls.myFx = await call('show:fxDelete', f.name); lsSide(); } return; }
    const ds = e.target.closest('[data-delshow]'); if (ds) { if (await confirmBox('Delete show', 'Delete this saved show? The song file is not touched.', 'Delete')) { await call('show:delete', ds.dataset.delshow); ls.shows = await call('show:list'); lsSide(); } return; }
    if (!a) return; e.preventDefault();
    const act = a.dataset.a;
    if (act === 'import') lsPick();
    else if (act === 'play') lsPlay(ls.pos >= (ls.an ? ls.an.duration - 0.2 : 0) ? 0 : ls.pos);
    else if (act === 'pause') lsPause();
    else if (act === 'stop') lsStop();
    else if (act === 'home') lsSeek(0);
    else if (act === 'zin' || act === 'zout') { const c = ls.pos; ls.pps = C.clamp(ls.pps * (act === 'zin' ? 1.6 : 1 / 1.6), 1, 2000); ls.t0 = Math.max(0, c - lsViewW() / ls.pps / 2); lsPaint(); }
    else if (act === 'fit') { lsFit(); lsPaint(); }
    else if (act === 'gen') lsGenerate();
    else if (act === 'vary') { ls.opts.seed = Math.floor(Math.random() * 1e9); lsGenerate(); }
    else if (act === 'regen') lsGenerate(ls.range);
    else if (act === 'clearrange') { ls.range = null; lsSide(); lsPaint(); }
    else if (act === 'psave') { const n = await ask('Save preset', LS.STYLES[ls.opts.style].name + ' custom'); if (n) { ls.presets = await call('show:presetSave', n, ls.opts); lsSide(); } }
    else if (act === 'pdel') { const n = $('#lsPreset').value; if (n) { ls.presets = await call('show:presetDelete', n); lsSide(); } }
    else if (act === 'save' || act === 'saveas') lsSave(act === 'saveas');
    else if (act === 'del') lsDelete();
    else if (act === 'dup') lsDup();
    else if (act === 'copy') lsCopy();
    else if (act === 'alldevs') { lsPush(); lsSelItems().forEach((ev) => { delete ev.devs; }); lsChanged(); }
    else if (act === 'measure') { ls.measuring = true; lsSide(); try { const r = await call('latency:measure', ls.lat.filter((l) => l.enabled && l.online).map((l) => l.id)); const bad = Object.entries(r).filter(([, v]) => !v.ok).length; toast(`Measured ${Object.keys(r).length - bad} light${Object.keys(r).length - bad === 1 ? '' : 's'}${bad ? `, ${bad} did not answer` : ''}.`, true); } finally { ls.measuring = false; ls.lat = await call('latency:get'); lsSide(); lsPlanSoon(); } }
    else if (act === 'ftest') lsFlashTest();
    else if (act === 'align') lsAlignStart();
    else if (act === 'alignstop') lsStop();
    else if (act === 'roomtoggle') { ls.roomHidden = !ls.roomHidden; lsRoomBuild(); }
    else if (act === 'addfx') { const k = ($('#lsAddFx') || {}).value || 'flash'; ls.lastFx = k; lsAddClip(k, ls.pos, ls.sel.size ? (lsItem([...ls.sel][0]) || {}).lane : '*'); }
    else if (act === 'fxadv') { ls.fxAdv = !ls.fxAdv; lsSide(); }
    else if (act === 'ccoladd' || act === 'ccoldel' || act === 'ccontrast') { const c = lsClip([...ls.sel][0]); if (!c) return; lsPush(); const cols = c.p.colors;
      if (act === 'ccoladd') cols.push(LS.rgbOf([(LS.hsv(cols[cols.length - 1])[0] + 137) % 360, 1, 1])); else if (act === 'ccoldel') cols.pop(); else { const [h] = LS.hsv(cols[0]); cols[1] = LS.rgbOf([h + 180, 1, 1]); }
      c.user = true; lsChanged(); }
    else if (act === 'cprev') { const c = lsClip([...ls.sel][0]); if (c) lsRoomPreview(c); }
    else if (act === 'ctry') { const c = lsClip([...ls.sel][0]); if (c) lsTryOnLights(c); }
    else if (act === 'savefx') { const c = lsClip([...ls.sel][0]); if (!c) return; const n = await ask('Save as my effect', LF.EFFECTS[c.fx].name + ' (mine)'); if (n) { ls.myFx = await call('show:fxSave', { name: n, kind: 'effect', fx: c.fx, p: c.p, dur: c.dur }); toast('Saved to My effects (Effects tab)'); } }
    else if (act === 'savecombo') { const cs = lsSelItems().filter(isClip); if (!cs.length) return; const n = await ask('Save as combination', 'My combination'); if (n) { const t0 = Math.min(...cs.map((c) => c.t)); ls.myFx = await call('show:fxSave', { name: n, kind: 'combo', clips: cs.map((c) => ({ fx: c.fx, t: +(c.t - t0).toFixed(3), dur: c.dur, p: c.p, lane: c.lane })) }); toast('Saved to My effects (Effects tab)'); } }
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'lsRestore') ls.restore = t.checked;
    else if (t.id === 'lsLayout') { ls.layoutId = t.value; lsRoomBuild(); }
    else if (t.id === 'lsPreviewOnly') { ls.previewOnly = t.checked; if (ls.playing && !ls.test) { const at = lsHeard(); if (t.checked) await call('show:stop', { restore: ls.restore }).catch(() => {}); lsPlay(at); } }
    else if (t.id === 'lsSnap') ls.snap = t.checked;
    else if (t.id === 'lsPreset' && t.value) { const p = ls.presets.find((q) => q.name === t.value); if (p) { ls.opts = { ...ls.opts, ...p.opts }; lsSide(); } }
    else if (t.dataset.o === 'style' || t.dataset.o === 'palette' || t.dataset.o === 'mode' || t.dataset.o === 'throwDir' || t.dataset.o === 'throwWho' || t.dataset.o === 'dropFx') { ls.opts[t.dataset.o] = t.value; lsSide(); }
    else if (t.dataset.o === 'throwRate') { ls.opts.throwRate = +t.value; lsSide(); }
    else if (t.id === 'lsKeepUser') ls.keepUser = t.checked;
    else if (t.dataset.fxon) { lsSetFx(t.dataset.fxon, { w: t.checked ? 1 : 0 }); lsSide(); }
    else if (t.dataset.fxtrig) { const k = t.dataset.fxtrig, all = [...$$(`[data-fxtrig="${k}"]`)].filter((x) => x.checked).map((x) => x.value); lsSetFx(k, { trig: all }); }
    else if (t.dataset.fxw) { lsSetFx(t.dataset.fxw, { w: +t.value }); lsSide(); }
    else if (t.id === 'lsAddFx') ls.lastFx = t.value;
    else if (t.id === 'lsClipPal' && t.value) { const c = lsClip([...ls.sel][0]); if (c) { lsPush(); c.p.colors = LS.PALETTES[t.value].slice(0, Math.max(2, Math.min(5, c.p.colors.length))).map((x) => x.slice()); c.user = true; lsChanged(); } }
    else if (t.dataset.cdev !== undefined) { const c = lsClip([...ls.sel][0]); if (c) { lsPush(); const on = [...$$('[data-cdev]')].filter((x) => x.checked).map((x) => x.dataset.cdev), all = $$('[data-cdev]').length; if (on.length === all) delete c.devs; else c.devs = on; c.user = true; lsChanged(); } }
    else if (t.dataset.c) lsClipField(t, true);
    else if (t.id === 'lsName' && ls.show) { ls.show.name = t.value.trim() || ls.show.name; }
    else if (t.dataset.l) { const id = t.closest('[data-id]').dataset.id, l = ls.lat.find((q) => q.id === id), k = t.dataset.l; const v = k === 'enabled' ? t.checked : t.value === '' ? null : +t.value; Object.assign(l, await call('latency:set', id, { [k]: v })); if (k === 'ms' && v === null) l.ms = null; lsPlanSoon(); }
    else if (t.dataset.e) lsEditField(t, true);
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.o && t.type === 'range') { ls.opts[t.dataset.o] = +t.value; const s = t.nextElementSibling; if (s) s.textContent = t.dataset.o === 'speed' ? t.value + '×' : Math.round(t.value * 100) + '%'; }
    else if (t.dataset.e && (t.type === 'range' || t.type === 'color')) lsEditField(t, false);
    else if (t.dataset.c && t.type === 'range') lsClipField(t, false);
    else if (t.dataset.ccol !== undefined) { const c = lsClip([...ls.sel][0]); if (!c) return; const key = c.id + ':' + t.dataset.ccol; if (ls.colPush !== key) { lsPush(); ls.colPush = key; } c.p.colors[+t.dataset.ccol] = (e.detail && e.detail.rgb) || C.parseColor(t.value) || c.p.colors[+t.dataset.ccol]; c.user = true; lsChangedSoon(); }
    else if (t.dataset.fxw && t.type === 'range') { const sp = t.nextElementSibling, v = +t.value; if (sp) sp.textContent = v <= 0 ? 'never' : v < 0.6 ? 'rarely' : v <= 1.4 ? 'normal' : 'often'; }
    else if (t.id === 'lsMultiCol' || t.id === 'lsMultiBri') { if (!ls.multiPushed) { lsPush(); ls.multiPushed = true; } for (const ev of lsSelItems()) { const v = t.id === 'lsMultiCol' ? (e.detail && e.detail.rgb) || C.parseColor(t.value) : +t.value; if (isClip(ev)) { if (t.id === 'lsMultiCol') ev.p.colors = [v, ...ev.p.colors.slice(1)]; else ev.p.bri = v; } else if (t.id === 'lsMultiCol') ev.rgb = v; else ev.bri = v; } lsChangedSoon(); }
  });
  // timeline mouse
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (x < HEAD_W || !ls.an) return;
    cv.setPointerCapture(e.pointerId); ls.multiPushed = false;
    const h = lsHit(x, y), t = xt(x);
    if (h.zone === 'ruler' || h.zone === 'wave') { ls.drag = { kind: 'seek' }; lsSeek(t); return; }
    if (h.zone === 'sec') { ls.drag = { kind: 'range', a: t, moved: false, x }; return; }
    if (h.zone === 'ev') {
      if (e.shiftKey || e.ctrlKey) { ls.sel.has(h.ev.id) ? ls.sel.delete(h.ev.id) : ls.sel.add(h.ev.id); lsPaint(); lsSide(); return; }
      if (!ls.sel.has(h.ev.id)) { ls.sel = new Set([h.ev.id]); }
      ls.drag = { kind: h.edge ? 'resize' : 'move', x, y, ev: h.ev, orig: lsSelItems().map((v) => ({ v, t: v.t, dur: v.dur, lane: v.lane })), pushed: false, li: lsTracks().indexOf(h.lane) };
      if (ls.tab !== 'event') { ls.tab = 'event'; lsTabs(); } lsSide(); lsPaint(); return;
    }
    if (h.zone === 'lane') { ls.sel.clear(); ls.drag = { kind: 'box', box: { x0: x, y0: y, x1: x, y1: y }, sx: x }; lsSide(); lsPaint(); }
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = ls.drag;
    if (!d) { const h = x >= HEAD_W ? lsHit(x, y) : {}; cv.style.cursor = h.zone === 'ev' ? (h.edge ? 'ew-resize' : 'grab') : h.zone === 'sec' ? 'col-resize' : 'default'; return; }
    if (d.kind === 'seek') { ls.pos = C.clamp(xt(x), 0, ls.an.duration); lsPaint(true); lsTime(); }
    else if (d.kind === 'range') { if (Math.abs(x - d.x) > 3) d.moved = true; if (d.moved) { const b = xt(x); ls.range = [lsSnapT(Math.max(0, Math.min(d.a, b))), lsSnapT(Math.min(ls.an.duration, Math.max(d.a, b)))]; lsPaint(); } }
    else if (d.kind === 'box') { d.box.x1 = x; d.box.y1 = y; const ta = xt(Math.min(d.box.x0, x)), tb = xt(Math.max(d.box.x0, x)), tr = lsTracks(), la = Math.floor((Math.min(d.box.y0, y) - topH()) / LANE_H), lb = Math.floor((Math.max(d.box.y0, y) - topH()) / LANE_H);
      ls.sel = new Set([...ls.show.events.filter((ev) => !ev.fx), ...(ls.show.clips || [])].filter((ev) => { const li = tr.findIndex((q) => q.id === ev.lane); return li >= la && li <= lb && ev.t + ev.dur >= ta && ev.t <= tb; }).map((ev) => ev.id)); lsPaint(); }
    else if (d.kind === 'move' || d.kind === 'resize') {
      if (!d.pushed) { if (Math.abs(x - d.x) < 3 && Math.abs(y - d.y) < 4) return; lsPush(); d.pushed = true; busyDrag = true; }
      const dt = (x - d.x) / ls.pps;
      if (d.kind === 'resize') { const o = d.orig.find((q) => q.v === d.ev); d.ev.dur = Math.max(0.04, +(lsSnapT(o.t + o.dur + dt) - o.t).toFixed(3)); }
      else {
        const lead = d.orig.find((q) => q.v === d.ev), nt = lsSnapT(Math.max(0, lead.t + dt)), shift = nt - lead.t, tr = lsTracks(), dl = Math.floor((y - topH()) / LANE_H) - d.li;
        for (const o of d.orig) { o.v.t = +Math.max(0, o.t + shift).toFixed(3); const li = tr.findIndex((q) => q.id === o.lane), nl = tr[C.clamp(li + dl, 0, tr.length - 1)]; if (nl && nl.id !== o.v.lane) { o.v.lane = nl.id; delete o.v.devs; } }
      }
      lsPaint();
    }
  });
  const up = () => {
    const d = ls.drag; ls.drag = null; busyDrag = false; if (!d) return;
    if (d.kind === 'range' && !d.moved) { const s = ls.an.sections.find((q) => d.a >= q.t0 && d.a < q.t1); ls.range = s ? [s.t0, s.t1] : null; if (ls.tab !== 'gen') { ls.tab = 'gen'; lsTabs(); } lsSide(); lsPaint(); }
    else if (d.kind === 'range') { if (ls.tab !== 'gen') { ls.tab = 'gen'; lsTabs(); } lsSide(); }
    else if (d.kind === 'box') { if (Math.abs(d.box.x1 - d.box.x0) < 3 && Math.abs(d.box.y1 - d.box.y0) < 3) lsSeek(xt(d.box.x0)); lsSide(); lsPaint(); }
    else if (d.kind === 'seek') lsSeek(ls.pos);
    else if ((d.kind === 'move' || d.kind === 'resize') && d.pushed) lsChanged();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = lsHit(x, y); if (h.zone !== 'lane') return; const yy = y - topH() - lsTracks().indexOf(h.lane) * LANE_H; if (yy >= CLIP_Y && yy < CLIP_Y + CLIP_H) lsAddClip(ls.lastFx || 'flash', xt(x), h.lane.id); else lsAdd('flash', lsSnapT(xt(x)), h.lane.id); });
  box.addEventListener('wheel', (e) => {
    if (!ls.an) return; e.preventDefault();
    if (e.ctrlKey) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, t = xt(x); ls.pps = C.clamp(ls.pps * (e.deltaY < 0 ? 1.25 : 0.8), 1, 2000); ls.t0 = Math.max(0, t - (x - HEAD_W) / ls.pps); }
    else ls.t0 = C.clamp(ls.t0 + (e.deltaX || e.deltaY) / ls.pps, 0, Math.max(0, ls.an.duration - lsViewW() / ls.pps / 2));
    lsPaint();
  }, { passive: false });
  // drag & drop a song onto the workspace (the file's location isn't available this way, so saved shows will ask for it again)
  root.addEventListener('dragover', (e) => { e.preventDefault(); });
  root.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (ls.playing) await lsStop(); lsImport({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); });
  if (ls.ro) ls.ro.disconnect(); ls.ro = new ResizeObserver(() => lsPaint()); ls.ro.observe(box);
}
document.addEventListener('keydown', (e) => {
  if (view.t !== 'show' || !$('#lsRoot') || $('#dlg').open) return;
  const a = document.activeElement; if (a && a.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if (ls.align) { if (k === 'arrowleft' || k === 'arrowright' || k === 'enter') { e.preventDefault(); lsAlignAnswer(k === 'enter' ? 0 : k === 'arrowleft' ? -1 : 1); } else if (k === 'escape') { e.preventDefault(); lsStop(); } return; }
  if (k === ' ') { e.preventDefault(); ls.playing ? lsPause() : lsPlay(ls.pos); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); lsDelete(); }
  else if (e.ctrlKey && k === 'c') { e.preventDefault(); lsCopy(); }
  else if (e.ctrlKey && k === 'v') { e.preventDefault(); lsPaste(); }
  else if (e.ctrlKey && k === 'd') { e.preventDefault(); lsDup(); }
  else if (e.ctrlKey && k === 'a') { e.preventDefault(); if (ls.show) { ls.sel = new Set([...ls.show.events.filter((v) => !v.fx), ...(ls.show.clips || [])].map((v) => v.id)); lsPaint(); lsSide(); } }
  else if (e.ctrlKey && k === 'z') { e.preventDefault(); lsUndo(e.shiftKey); }
  else if (e.ctrlKey && k === 'y') { e.preventDefault(); lsUndo(true); }
  else if ((k === 'arrowleft' || k === 'arrowright') && ls.sel.size) { e.preventDefault(); lsPush(); const bt = ls.an ? 60 / ls.an.bpm : 0.5, st = e.shiftKey ? 0.01 : bt / 4; for (const v of lsSelItems()) v.t = +Math.max(0, v.t + (k === 'arrowleft' ? -st : st)).toFixed(3); lsChanged(); }
  else if (k === 'escape') { ls.sel.clear(); ls.range = null; lsPaint(); lsSide(); }
}, true);

/* ---------- editing ---------- */
function lsEditField(t, commit) {
  const e = lsEvent([...ls.sel][0]); if (!e) return;
  if (!ls.editPushed) { lsPush(); ls.editPushed = true; } if (commit) ls.editPushed = false;
  const k = t.dataset.e;
  if (k === 'rgb' || k === 'rgb2') e[k] = (t.type === 'color' && C.parseColor(t.value)) || e[k];
  else if (k === 'has2') { if (t.checked) e.rgb2 = e.rgb2 || e.rgb.slice(); else { delete e.rgb2; delete e.bri2; } }
  else if (k === 'type' || k === 'lane') { e[k] = t.value; if (k === 'lane') delete e.devs; if (k === 'type' && e.type === 'strobe' && !e.hz) e.hz = 5; }
  else e[k] = Math.max(0, +t.value || 0);
  if (k === 'dur') e.dur = Math.max(0.04, e.dur);
  if (commit) lsChanged(); else { lsAutomation(); lsPaint(); }
  if (commit && (k === 'type' || k === 'has2')) lsSide();
}
function lsAdd(type, t, lane) {
  if (!ls.show) return; lsPush();
  const bt = ls.an ? 60 / ls.an.bpm : 0.5, base = type === 'color' || type === 'ambient';
  const ev = { id: lsNewId(), t: +(+t).toFixed(3), dur: base ? bt * 8 : type === 'strobe' ? bt * 2 : bt * 0.75, lane: lane || '*', type, rgb: type === 'blackout' ? [0, 0, 0] : [255, 255, 255], bri: type === 'blackout' ? 0 : 100, pri: 3, ...(base ? { fade: bt } : {}), ...(type === 'strobe' ? { hz: 5 } : {}) };
  ev.user = true; ls.show.events.push(ev); ls.sel = new Set([ev.id]); ls.tab = 'event'; lsTabs(); lsChanged();
}
// add an effect clip; colours come from the show's palette, length from the kind of effect
const FX_LEN = { strobe: 2, blackout: 1, explosion: 8, throw: 8, build: 16, wash: 32, ambient: 32 };
function lsAddClip(fx, t, lane, preset) {
  if (!ls.show) return; lsPush(); const bt = ls.an ? 60 / ls.an.bpm : 0.5;
  const pal = LS.PALETTES[ls.opts.palette || (LS.STYLES[ls.opts.style] || {}).pal] || LS.PALETTES.Neon, cols = [pal[0], pal[Math.min(1, pal.length - 1)], ...pal.slice(2)];
  const p = { colors: fx === 'strobe' ? [[255, 255, 255]] : ['wash', 'ambient'].includes(fx) ? cols : cols.slice(0, 2), ...((preset && preset.p) || {}) };
  const c = LF.newClip(fx, lsSnapT(t), (preset && preset.dur) || bt * (FX_LEN[fx] || 16), { lane: lane || '*', p, user: true });
  ls.show.clips.push(c); ls.sel = new Set([c.id]); ls.tab = 'event'; lsTabs(); lsChanged(); return c;
}
function lsAddCombo(combo, t, lane) {
  if (!ls.show) return; lsPush(); const at = lsSnapT(t), n = combo.clips.map((q) => LF.newClip(q.fx, at + q.t, q.dur, { lane: q.lane && lsTracks().some((tr) => tr.id === q.lane) ? q.lane : lane || '*', p: q.p, user: true }));
  ls.show.clips.push(...n); ls.sel = new Set(n.map((c) => c.id)); ls.tab = 'event'; lsTabs(); lsChanged();
}
const isClip = (v) => !!(v && v.fx && v.p); // effect clip (an expanded event has fx too, but no p)
const lsPutItems = (items) => { for (const v of items) (isClip(v) ? ls.show.clips : ls.show.events).push(v); };
function lsDelete() { if (!ls.sel.size || !ls.show) return; lsPush(); ls.show.events = ls.show.events.filter((v) => !ls.sel.has(v.id)); ls.show.clips = (ls.show.clips || []).filter((v) => !ls.sel.has(v.id)); ls.sel.clear(); lsChanged(); }
function lsCopy() { const evs = lsSelItems(); if (!evs.length) return; const t0 = Math.min(...evs.map((v) => v.t)); ls.clip = evs.map((v) => ({ ...JSON.parse(JSON.stringify(v)), t: v.t - t0 })); toast(`Copied ${evs.length} item${evs.length > 1 ? 's' : ''}`); }
const lsFresh = (v) => ({ ...JSON.parse(JSON.stringify(v)), id: isClip(v) ? 'x' + lsNewId().slice(1) : lsNewId(), user: true });
function lsPaste() { if (!ls.clip.length || !ls.show) return; lsPush(); const at = lsSnapT(ls.pos), n = ls.clip.map((v) => ({ ...lsFresh(v), t: +(at + v.t).toFixed(3) })); lsPutItems(n); ls.sel = new Set(n.map((v) => v.id)); lsChanged(); }
function lsDup() { const evs = lsSelItems(); if (!evs.length) return; lsPush(); const span = Math.max(...evs.map((v) => v.t + v.dur)) - Math.min(...evs.map((v) => v.t)), n = evs.map((v) => ({ ...lsFresh(v), t: +(v.t + span).toFixed(3) })); lsPutItems(n); ls.sel = new Set(n.map((v) => v.id)); lsChanged(); }
function lsUndo(redo) {
  const from = redo ? ls.redo : ls.undo, to = redo ? ls.undo : ls.redo; if (!from.length || !ls.show) return; to.push(lsSnap());
  const st = JSON.parse(from.pop()); if (Array.isArray(st)) { ls.show.events = st; } else { ls.show.events = st.e; ls.show.clips = st.c; }
  ls.sel.clear(); lsChanged();
}

/* ---------- save / open ---------- */
async function lsSave(asNew) {
  if (!ls.show) return;
  if (asNew || !ls.show.id) { const n = await ask('Save show', ls.show.name); if (!n) return; ls.show.name = n; if (asNew) ls.show.id = null; }
  const r = await call('show:save', { ...ls.show, analysis: ls.an, opts: ls.opts });
  ls.show.id = r.id; ls.dirty = false; ls.shows = await call('show:list'); toast('Show saved'); lsBar(); if (ls.tab === 'shows') lsSide();
}
async function lsOpen(id) {
  if (ls.playing) await lsStop();
  const s = await call('show:load', id);
  ls.show = { id: s.id, name: s.name, audio: s.audio, opts: s.opts, lanes: s.lanes, events: s.events, clips: Array.isArray(s.clips) ? s.clips : [] };
  if (ls.show.clips.length) { ls.an = s.analysis; lsMat(); } // 1.6 show: rebuild effect events for the bulbs connected now (older shows are played as saved) ls.an = s.analysis; ls.opts = { ...LS.DEFAULTS, ...s.opts }; ls.sel.clear(); ls.undo = []; ls.range = null; ls.audio = null; ls.file = null; ls.pos = 0;
  const missing = s.lanes.flatMap((l) => l.deviceIds).filter((d) => !S.devices.some((x) => x.id === d));
  if (missing.length) toast(`${missing.length} light${missing.length > 1 ? 's' : ''} in this show ${missing.length > 1 ? 'are' : 'is'} not connected and will be skipped.`, true);
  lsFit(); lsAutomation(); lsAll();
  if (s.audio && s.audio.path) {
    try { const f = await call('show:readAudio', s.audio.path); ls.busy = 'Loading song…'; lsBar(); ls.audio = await lsDecode(f.bytes); ls.file = { ...s.audio }; }
    catch { ls.err = `Song not found at ${s.audio.path}. Use Import music… to load it again; the show's events are kept.`; }
  } else ls.err = 'This show was made from a dropped file. Use Import music… to load the song again; the events are kept.';
  ls.busy = ''; lsAll();
}
