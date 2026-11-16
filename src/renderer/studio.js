'use strict';
/* Colour Studio: one place to colour any mix of rooms, groups and lights at once. */
const stu = { t: { all: true, rooms: [], groups: [], ids: [] }, mode: 'color', hsv: [28, 1, 1], bri: 80, kelvin: 2700, live: false, recent: [], work: [] };
const stuScope = () => ({ type: 'multi', all: stu.t.all, rooms: stu.t.rooms, groups: stu.t.groups, ids: stu.t.ids });
function stuIds() {
  const out = new Set(stu.t.all ? S.devices.map((d) => d.id) : []);
  for (const d of S.devices) if (stu.t.rooms.includes(d.room) || stu.t.ids.includes(d.id)) out.add(d.id);
  for (const g of S.groups) if (stu.t.groups.includes(g.id)) g.deviceIds.forEach((id) => { if (dev(id)) out.add(id); });
  return [...out];
}
// Called from right-click menus elsewhere: open the studio aimed at one room, group or light.
function studioTarget(scope) {
  stu.t = { all: scope.type === 'all', rooms: scope.type === 'room' ? [scope.id] : [], groups: scope.type === 'group' ? [scope.id] : [], ids: scope.type === 'devices' ? scope.ids.slice() : [] };
  if (view.t === 'studio') stuPaint();
}
const stuRgb = () => stu.mode === 'white' ? C.kelvinToRgb(stu.kelvin) : C.hsvToRgb(stu.hsv);
const stuPatch = () => stu.mode === 'white' ? { on: true, kelvin: stu.kelvin, brightness: stu.bri } : { on: true, rgb: C.hsvToRgb(stu.hsv), brightness: stu.bri };
// What one light will actually do with the chosen colour, and why if that differs from what was asked.
function stuOutcome(d) {
  if (d.online === false) return { rgb: null, note: 'offline, will be skipped' };
  if (stu.mode === 'white') return d.caps.temp ? { rgb: C.kelvinToRgb(C.clamp(stu.kelvin, d.kelvinRange[0], d.kelvinRange[1])), note: stu.kelvin < d.kelvinRange[0] || stu.kelvin > d.kelvinRange[1] ? `limited to ${C.clamp(stu.kelvin, d.kelvinRange[0], d.kelvinRange[1])} K` : '' } : { rgb: C.stateRgb(d), note: d.caps.dim ? 'no white control: brightness only' : 'on/off only' };
  if (d.caps.color) return { rgb: C.hsvToRgb(stu.hsv), note: '' };
  if (d.caps.temp) return { rgb: C.kelvinToRgb(C.rgbToKelvin(C.hsvToRgb(stu.hsv))), note: 'white only: nearest white' };
  return { rgb: C.stateRgb(d), note: d.caps.dim ? 'no colour: brightness only' : 'on/off only' };
}
async function stuApply(label) {
  const ids = stuIds(); if (!ids.length) return toast('Tick at least one target on the left', true);
  const r = await applyTo(stuScope(), stuPatch(), label || (stu.mode === 'white' ? 'White' : 'Colour'));
  if (stu.mode === 'color') { const h = C.hex(C.hsvToRgb(stu.hsv)); stu.recent = [h, ...stu.recent.filter((x) => x !== h)].slice(0, 10); }
  if (r.failed) toast(`${r.failed} light(s) did not respond`, true);
  stuPaint();
}
const stuLive = throttle(() => { if (stu.live && stuIds().length) applyTo(stuScope(), stuPatch(), stu.mode === 'white' ? 'White' : 'Colour'); }, 220);
function stuSet(rgb) { const h = C.rgbToHsv(rgb); stu.mode = 'color'; stu.hsv = [h[0], h[1], 1]; stuPaint(); stuLive(); }

function stuWheel() {
  const cv = $('#wheel'); if (!cv) return; const g = cv.getContext('2d'), n = cv.width, r = n / 2;
  if (!stuWheel.img) { // the disc itself never changes: hue round the edge, white in the middle
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = x - r, dy = y - r, dist = Math.sqrt(dx * dx + dy * dy) / r, i = (y * n + x) * 4;
      if (dist <= 1) { const c = C.hsvToRgb([Math.atan2(dy, dx) * 180 / Math.PI, dist, 1]); img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; } }
    stuWheel.img = img;
  }
  g.putImageData(stuWheel.img, 0, 0);
  if (stu.mode === 'color') { const a = stu.hsv[0] * Math.PI / 180, x = r + Math.cos(a) * stu.hsv[1] * (r - 1), y = r + Math.sin(a) * stu.hsv[1] * (r - 1);
    g.beginPath(); g.arc(x, y, 7, 0, 7); g.lineWidth = 3; g.strokeStyle = '#000'; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke(); }
}
function renderStudio(c) {
  if (!$('#stRoot')) {
    c.innerHTML = `<div id="stRoot" class="studio">
      <div class="panel" style="margin:0"><div class="ph">${ico('group')}Targets</div><div class="pb"><div class="tree" id="stTree"></div><div class="muted" id="stCount" style="margin-top:6px"></div></div></div>
      <div class="panel" style="margin:0"><div class="ph">${ico('studio')}Colour</div><div class="pb">
        <div class="row" style="margin-bottom:8px"><label class="chk"><input type="radio" name="stMode" value="color">Colour</label><label class="chk"><input type="radio" name="stMode" value="white">White</label><span class="sp"></span><div class="bigsw" id="stSw" style="width:120px"></div></div>
        <div class="row" style="align-items:flex-start;gap:14px" id="stColor"><canvas id="wheel" width="200" height="200"></canvas>
          <div class="col" style="flex:1;min-width:150px"><div class="f"><label>Hue</label><input type="range" class="hue" id="stH" min="0" max="359"></div><div class="f"><label>Saturation <span id="stSV"></span></label><input type="range" id="stS" min="0" max="100"></div>
            <div class="kvgrid" style="grid-template-columns:auto 1fr"><label>HEX</label><input type="text" id="stHex" maxlength="24" data-tip="Also accepts rgb(…), hsv(…), hsl(…) or R, G, B"><label>RGB</label><div class="row" style="gap:3px"><input type="number" id="stR" min="0" max="255" style="width:52px"><input type="number" id="stG" min="0" max="255" style="width:52px"><input type="number" id="stB" min="0" max="255" style="width:52px"></div></div></div></div>
        <div class="f hidden" id="stWhite"><label>White temperature <span id="stKV"></span></label><input type="range" class="kelvin" id="stK" min="2200" max="6500" step="50"><div class="row muted small"><span>Candle</span><span class="sp"></span><span>Daylight</span></div></div>
        <div class="f" style="margin-top:8px"><label>Brightness <span id="stBV"></span></label><input type="range" id="stBri" min="1" max="100"></div>
        <div class="row wrap" style="margin-top:10px"><button class="btn pri" id="stApply" style="min-width:96px">Apply</button><label class="chk" data-tip="Send changes to the lights as you move the controls. Cloud lights follow more slowly."><input type="checkbox" id="stLive">Apply while I adjust</label><span class="sp"></span><button class="btn" id="stOn">On</button><button class="btn" id="stOff">Off</button><button class="btn ic" id="stUndo" data-tip="Put the lights back how they were">${ico('undo')}Undo</button></div>
        <fieldset style="margin-top:12px"><legend>Adjust what is already there</legend><div class="kvgrid"><label data-tip="Keeps each light's own colour and changes how vivid it is. Only lights currently showing a colour.">Saturation</label><input type="range" id="stRelS" min="0" max="100" value="100"><button class="btn" id="stRelSGo">Set</button>
          <label data-tip="Changes brightness only; colours stay as they are.">Brightness only</label><input type="range" id="stRelB" min="1" max="100" value="80"><button class="btn" id="stRelBGo">Set</button></div></fieldset></div></div>
      <div class="col" style="gap:12px"><div class="panel" style="margin:0"><div class="ph">Preview<span class="muted right" style="font-weight:normal">now → after</span></div><div class="pb"><div class="chips" id="stChips"></div></div></div>
        <div class="panel" style="margin:0"><div class="ph">${ico('star')}Favourites</div><div class="pb"><div class="swatches" id="stFav"></div><div class="row" style="margin-top:6px"><button class="btn" id="stFavAdd">Add current colour</button></div>
          <div class="muted" style="margin:8px 0 3px">Recent</div><div class="swatches" id="stRecent"></div></div></div>
        <div class="panel" style="margin:0"><div class="ph">Palettes</div><div class="pb"><div class="muted small" style="margin-bottom:4px">Build a set of colours, then spread it across the targets, one colour per light.</div><div class="swatches" id="stWork"></div>
          <div class="row wrap" style="margin:6px 0"><button class="btn" id="stWorkAdd">Add current</button><button class="btn" id="stWorkSpread">Spread</button><button class="btn" id="stWorkSave">Save…</button></div><div id="stPals" class="col" style="gap:4px"></div></div></div></div></div>`;
    const root = $('#stRoot');
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'stMode') { stu.mode = t.value; stuPaint(); stuLive(); }
      else if (t.dataset.tAll !== undefined) { stu.t.all = t.checked; stuPaint(); }
      else if (t.dataset.tk) { const set = new Set(stu.t[t.dataset.tk]); t.checked ? set.add(t.value) : set.delete(t.value); stu.t[t.dataset.tk] = [...set]; stuPaint(); }
      else if (t.id === 'stLive') stu.live = t.checked;
      else if (t.id === 'stHex') { const c2 = C.parseColor(t.value); if (c2) stuSet(c2); else { toast('Colour not recognised. Try #ff8800, rgb(255,136,0) or hsv(32,100%,100%).', true); stuPaint(); } }
      else if (['stR', 'stG', 'stB'].includes(t.id)) stuSet(['stR', 'stG', 'stB'].map((id) => C.clamp(+$('#' + id).value || 0, 0, 255)));
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'stH') { stu.hsv[0] = +t.value; stu.mode = 'color'; } else if (t.id === 'stS') stu.hsv[1] = t.value / 100; else if (t.id === 'stK') stu.kelvin = +t.value; else if (t.id === 'stBri') stu.bri = +t.value; else return;
      stuPaint(true); stuLive();
    });
    root.addEventListener('click', (e) => {
      const id = e.target.closest('button') && e.target.closest('button').id, sw = e.target.closest('[data-pick]'), pal = e.target.closest('[data-pal]');
      if (sw) return stuSet(C.parseColor(sw.dataset.pick));
      if (pal) { const p = (S.settings.favPalettes || [])[+pal.dataset.pal]; if (!p) return; if (e.target.closest('[data-del]')) return call('settings:set', { favPalettes: S.settings.favPalettes.filter((x) => x !== p) }); if (e.target.closest('[data-load]')) { stu.work = p.colors.map(C.hex); return stuPaint(); } return stuSpread(p.colors, p.name); }
      if (e.target.closest('[data-wrm]')) { stu.work.splice(+e.target.closest('[data-wrm]').dataset.wrm, 1); return stuPaint(); }
      const act = { stApply: () => stuApply(), stOn: () => applyTo(stuScope(), { on: true }, 'On'), stOff: () => applyTo(stuScope(), { on: false }, 'Off'), stUndo: () => (S.history.undo ? undo() : toast('Nothing to undo')),
        stRelSGo: () => call('saturation', stuScope(), $('#stRelS').value / 100).then((r) => toast(r.ok ? `Saturation set on ${r.ok} colour light(s)` : 'No selected light is showing a colour right now', !r.ok)),
        stRelBGo: () => applyTo(stuScope(), { on: true, brightness: +$('#stRelB').value }, 'Brightness'),
        stFavAdd: () => call('settings:set', { favColors: [C.hsvToRgb(stu.hsv), ...(S.settings.favColors || [])].slice(0, 24) }),
        stWorkAdd: () => { if (stu.work.length < 8) { stu.work.push(C.hex(stuRgb())); stuPaint(); } else toast('A palette holds up to 8 colours', true); },
        stWorkSpread: () => stuSpread(stu.work.map(C.parseColor), 'palette'),
        stWorkSave: async () => { if (!stu.work.length) return toast('Add some colours first', true); const n = await ask('Save palette', '', 'Palette name'); if (n) call('settings:set', { favPalettes: [...(S.settings.favPalettes || []), { name: n, colors: stu.work.map(C.parseColor) }] }); } }[id];
      if (act) act();
    });
    root.addEventListener('contextmenu', (e) => { const f = e.target.closest('[data-fav]'); if (!f) return; e.preventDefault(); popup([{ label: 'Remove from favourites', run: () => call('settings:set', { favColors: S.settings.favColors.filter((_, i) => i !== +f.dataset.fav) }) }], e.clientX, e.clientY); });
    const cv = $('#wheel'), pick = (e) => { const b = cv.getBoundingClientRect(), dx = e.clientX - b.left - b.width / 2, dy = e.clientY - b.top - b.height / 2;
      stu.mode = 'color'; stu.hsv[0] = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360; stu.hsv[1] = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (b.width / 2)); stuPaint(true); stuLive(); };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); busyDrag = true; pick(e); });
    cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) pick(e); });
  }
  stuPaint();
}
// Spread a palette across the selected colour lights, one colour each, as a single undoable step.
async function stuSpread(colors, name) {
  colors = (colors || []).filter(Boolean); if (!colors.length) return toast('Add some colours first', true);
  const lights = stuIds().map(dev).filter((d) => d && d.online !== false && d.caps.color); if (!lights.length) return toast('None of the selected lights can show colour', true);
  const map = {}; lights.forEach((d, i) => { map[d.id] = { on: true, rgb: colors[i % colors.length], brightness: stu.bri }; });
  const r = await call('applyMap', map, `Palette: ${name}`); toast(`Spread across ${r.ok} colour light(s)${stuIds().length > lights.length ? `; ${stuIds().length - lights.length} without colour left alone` : ''}`);
}
function stuPaint(dragging) {
  if (!$('#stRoot')) return;
  const ids = stuIds(), rgb = stuRgb(), list = ids.map(dev).filter(Boolean);
  if (!dragging) {
    const cb = (k, v, label, on, extra = '') => `<label class="chk ind"><input type="checkbox" data-tk="${k}" value="${esc(v)}" ${on ? 'checked' : ''} ${stu.t.all ? 'disabled' : ''}>${label}${extra}</label>`;
    $('#stTree').innerHTML = `<label class="chk"><input type="checkbox" data-t-all ${stu.t.all ? 'checked' : ''}><b>All lights</b></label>` +
      (S.rooms.length ? `<div class="muted" style="margin-top:5px">Rooms</div>` + S.rooms.map((r) => cb('rooms', r.id, esc(r.name), stu.t.rooms.includes(r.id))).join('') : '') +
      (S.groups.length ? `<div class="muted" style="margin-top:5px">Groups</div>` + S.groups.map((g) => cb('groups', g.id, esc(g.name), stu.t.groups.includes(g.id))).join('') : '') +
      `<div class="muted" style="margin-top:5px">Lights</div>` + (S.devices.map((d) => cb('ids', d.id, esc(d.name), stu.t.ids.includes(d.id), ` <span class="tag ${d.brand}" style="margin-left:5px">${BRANDS[d.brand]}</span>`)).join('') || '<div class="nav-empty">No lights yet</div>');
    $$('input[name=stMode]').forEach((r) => { r.checked = r.value === stu.mode; });
    $('#stH').value = Math.round(stu.hsv[0]); $('#stS').value = Math.round(stu.hsv[1] * 100); $('#stK').value = stu.kelvin; $('#stBri').value = stu.bri; $('#stLive').checked = stu.live;
    $('#stFav').innerHTML = (S.settings.favColors || []).map((c2, i) => `<button class="sw" style="background:${C.hex(c2)}" data-pick="${C.hex(c2)}" data-fav="${i}" data-tip="${C.hex(c2)} · right-click to remove"></button>`).join('') + SWATCHES.map((h) => `<button class="sw" style="background:${h}" data-pick="${h}"></button>`).join('');
    $('#stRecent').innerHTML = stu.recent.map((h) => `<button class="sw" style="background:${h}" data-pick="${h}" data-tip="${h}"></button>`).join('') || '<span class="muted small">Colours you apply appear here.</span>';
    $('#stWork').innerHTML = stu.work.map((h, i) => `<button class="sw" style="background:${h}" data-wrm="${i}" data-tip="Click to remove"></button>`).join('') || '<span class="muted small">Empty</span>';
    $('#stPals').innerHTML = (S.settings.favPalettes || []).map((p, i) => `<div class="row" data-pal="${i}"><button class="btn palbtn" data-tip="Spread across the targets"><i style="background:linear-gradient(90deg,${p.colors.map(C.hex).join(',')})"></i>${esc(p.name)}</button><span class="sp"></span><a data-load>Edit</a><a data-del>Delete</a></div>`).join('');
  }
  const c = { dim: 0, color: 0, temp: 0 }; list.forEach((d) => { for (const k in c) if (d.caps[k]) c[k]++; });
  $('#stCount').textContent = list.length ? `${list.length} light${list.length === 1 ? '' : 's'}: ${c.color} colour, ${c.temp} white-tunable, ${c.dim} dimmable` : 'Nothing selected';
  $('#stColor').classList.toggle('hidden', stu.mode !== 'color'); $('#stWhite').classList.toggle('hidden', stu.mode !== 'white');
  $('#stSw').style.background = C.hex(rgb); $('#stSV').textContent = Math.round(stu.hsv[1] * 100) + '%'; $('#stKV').textContent = stu.kelvin + ' K'; $('#stBV').textContent = stu.bri + '%';
  const a = document.activeElement; if (!a || a.id !== 'stHex') $('#stHex').value = C.hex(C.hsvToRgb(stu.hsv));
  ['stR', 'stG', 'stB'].forEach((id, i) => { if (!a || a.id !== id) $('#' + id).value = C.hsvToRgb(stu.hsv)[i]; });
  $('#stChips').innerHTML = list.map((d) => { const o = stuOutcome(d); return `<div class="chip" data-tip="${esc(o.note || 'will match exactly')}"><span>${esc(d.name)}${o.note ? ` <span class="muted small">(${esc(o.note)})</span>` : ''}</span><i style="background:${d.on ? lightColor(d) : '#777'}"></i><span class="muted">→</span><i style="background:${o.rgb ? C.hex(o.rgb) : 'repeating-linear-gradient(45deg,#bbb 0 3px,#eee 3px 6px)'}"></i></div>`; }).join('') || '<span class="muted">Tick targets on the left.</span>';
  stuWheel();
}
