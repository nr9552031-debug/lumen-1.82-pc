'use strict';
/* Room Visualizer: a 2D plan of a room where lights can be placed, coloured ("staged") and compared before
   anything is sent to the real bulbs. The glow is an artistic approximation, not a physical simulation. */
const OBJ = { sofa: [2, 0.9, 'Sofa'], bed: [1.6, 2, 'Bed'], table: [1.2, 0.8, 'Table'], desk: [1.4, 0.7, 'Desk'], chair: [0.5, 0.5, 'Chair'], tv: [1.2, 0.12, 'TV'], shelf: [1, 0.35, 'Shelf'], plant: [0.5, 0.5, 'Plant'], rug: [2, 1.4, 'Rug'], door: [0.9, 0.1, 'Door'], window: [1.2, 0.1, 'Window'], wall: [2, 0.12, 'Wall'] };
const FIX = { ceiling: [2.4, 'Ceiling light'], lamp: [1.5, 'Lamp'], strip: [1.6, 'Light strip'], spot: [1.3, 'Spotlight'], wall: [1.4, 'Wall light'] };
const U = 100; // drawing units per metre
const viz = { id: null, draft: null, sel: null, drag: null, cmp: 0, anim: null, shown: null };
const vizNew = () => ({ id: '', name: 'New room', w: 5, h: 4, ambient: 0.25, room: null, objects: [], fixtures: [], arrangements: [] });
const vizClone = (o) => JSON.parse(JSON.stringify(o));
const vizId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const vizSave = debounce(async () => { if (!viz.draft) return; const saved = await call('layout:save', viz.draft); viz.id = saved.id; viz.draft.id = saved.id; }, 450);
const vizTouch = () => { vizDraw(); vizSave(); };
const fxState = (f) => (viz.shown && viz.shown[f.id]) || f.state;
const stRgb = (s) => s.rgb ? s.rgb : C.kelvinToRgb(s.kelvin || 2700);

function objSvg(o) {
  const w = o.w * U, h = o.h * U, r = (x, y, ww, hh, fill, rx = 0, extra = '') => `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${rx}" fill="${fill}" ${extra}/>`;
  switch (o.type) {
    case 'sofa': return r(0, 0, w, h, '#6f83a3', 12, 'stroke="#3d4b63" stroke-width="2"') + r(0, 0, w, h * 0.3, '#55698a', 10) + r(0, 0, w * 0.1, h, '#55698a', 8) + r(w * 0.9, 0, w * 0.1, h, '#55698a', 8);
    case 'bed': return r(0, 0, w, h, '#e6dfd0', 8, 'stroke="#8f8672" stroke-width="2"') + r(w * 0.08, h * 0.05, w * 0.38, h * 0.16, '#fff', 6) + r(w * 0.54, h * 0.05, w * 0.38, h * 0.16, '#fff', 6) + r(0, h * 0.3, w, h * 0.7, '#7d93b5', 8);
    case 'table': return r(0, 0, w, h, '#a87a48', 8, 'stroke="#6b4a26" stroke-width="2"');
    case 'desk': return r(0, 0, w, h, '#8e6b43', 4, 'stroke="#5a4126" stroke-width="2"') + r(w * 0.3, h * 0.15, w * 0.4, 6, '#222');
    case 'chair': return r(0, 0, w, h, '#8a8f9a', 12, 'stroke="#555a66" stroke-width="2"') + r(0, 0, w, h * 0.22, '#6b707c', 8);
    case 'tv': return r(0, 0, w, h, '#15171c', 3, 'stroke="#555" stroke-width="1"');
    case 'shelf': return r(0, 0, w, h, '#7a5a34', 2, 'stroke="#4a3418" stroke-width="2"') + `<path d="M${w / 3} 0V${h}M${w * 2 / 3} 0V${h}" stroke="#4a3418" stroke-width="2"/>`;
    case 'plant': return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#3c8a3c" stroke="#1f5a1f" stroke-width="2"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 4}" ry="${h / 4}" fill="#63b35a"/>`;
    case 'rug': return r(0, 0, w, h, '#a0524a', 10, 'opacity=".85"') + r(8, 8, w - 16, h - 16, 'none', 6, 'stroke="#e3c9a0" stroke-width="3" opacity=".8"');
    case 'door': return `<path d="M0 ${h / 2}H${w}" stroke="#d9c7a0" stroke-width="${Math.max(6, h * U / 100)}"/><path d="M0 ${h / 2}A${w} ${w} 0 0 1 ${w} ${h / 2 + w}" fill="none" stroke="#d9c7a0" stroke-width="2" stroke-dasharray="6 5"/>`;
    case 'window': return r(0, 0, w, h, '#9fd4ff', 2, 'stroke="#e9f6ff" stroke-width="2"');
    default: return r(0, 0, w, h, '#c9cdd3', 0, 'stroke="#8d939c" stroke-width="1"');
  }
}
function vizDraw() {
  const svg = $('#stage'), l = viz.draft; if (!svg || !l) return;
  const W = l.w * U, H = l.h * U, P = 40; svg.setAttribute('viewBox', `${-P} ${-P} ${W + 2 * P} ${H + 2 * P}`); svg.style.aspectRatio = `${W + 2 * P} / ${H + 2 * P}`;
  let grid = ''; for (let x = 1; x < l.w; x++) grid += `M${x * U} 0V${H}`; for (let y = 1; y < l.h; y++) grid += `M0 ${y * U}H${W}`;
  const sel = viz.sel, dark = 1 - C.clamp(l.ambient, 0, 1);
  const defs = l.fixtures.map((f) => { const s = fxState(f), c = stRgb(s).map(Math.round).join(','), a = s.on === false ? 0 : 0.3 + 0.6 * (s.brightness || 80) / 100;
    return `<radialGradient id="gl-${f.id}"><stop offset="0" stop-color="rgb(${c})" stop-opacity="${a}"/><stop offset=".45" stop-color="rgb(${c})" stop-opacity="${a * 0.45}"/><stop offset="1" stop-color="rgb(${c})" stop-opacity="0"/></radialGradient>`; }).join('');
  const glow = l.fixtures.map((f) => { const s = fxState(f); if (s.on === false) return ''; const base = FIX[f.type][0] * U * (0.5 + 0.5 * (s.brightness || 80) / 100);
    return `<ellipse cx="${f.x * U}" cy="${f.y * U}" rx="${f.type === 'strip' ? base : base}" ry="${f.type === 'strip' ? base * 0.42 : base}" transform="rotate(${f.rot || 0} ${f.x * U} ${f.y * U})" fill="url(#gl-${f.id})"/>`; }).join('');
  const fix = l.fixtures.map((f) => { const s = fxState(f), d = f.deviceId ? dev(f.deviceId) : null, on = s.on !== false, col = on ? C.hex(stRgb(s)) : '#555', isSel = sel && sel.k === 'f' && sel.id === f.id;
    const shape = f.type === 'strip' ? `<rect x="-42" y="-7" width="84" height="14" rx="7" fill="${col}" stroke="#fff" stroke-width="2"/>` : f.type === 'spot' ? `<path d="M0-14 13 10H-13z" fill="${col}" stroke="#fff" stroke-width="2"/>` : f.type === 'wall' ? `<path d="M-14 0A14 14 0 0 1 14 0z" fill="${col}" stroke="#fff" stroke-width="2"/>` : `<circle r="${f.type === 'ceiling' ? 15 : 11}" fill="${col}" stroke="#fff" stroke-width="2"/>${f.type === 'ceiling' ? '<path d="M-7 0H7M0-7V7" stroke="#0006" stroke-width="2"/>' : ''}`;
    return `<g data-k="f" data-id="${f.id}" transform="translate(${f.x * U} ${f.y * U}) rotate(${f.rot || 0})" style="cursor:move">${isSel ? '<circle r="24" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="5 4"/>' : ''}${shape}${d ? (d.online === false ? '<circle cx="14" cy="-14" r="5" fill="#e0432a" stroke="#fff"/>' : '<circle cx="14" cy="-14" r="5" fill="#2fc42f" stroke="#fff"/>') : ''}</g>
      <text x="${f.x * U}" y="${f.y * U + 34}" text-anchor="middle" font-size="15" fill="#fff" style="pointer-events:none;paint-order:stroke" stroke="#000a" stroke-width="3">${esc(f.label || (d ? d.name : FIX[f.type][1]))}</text>`; }).join('');
  const objs = l.objects.map((o) => { const isSel = sel && sel.k === 'o' && sel.id === o.id, w = o.w * U, h = o.h * U;
    return `<g data-k="o" data-id="${o.id}" transform="translate(${o.x * U} ${o.y * U}) rotate(${o.rot || 0} ${w / 2} ${h / 2})" style="cursor:move">${objSvg(o)}<rect width="${w}" height="${Math.max(h, 14)}" fill="transparent"/>${isSel ? `<rect x="-4" y="-4" width="${w + 8}" height="${h + 8}" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 4"/><rect data-h="1" x="${w - 2}" y="${h - 2}" width="14" height="14" fill="#fff" stroke="#000" style="cursor:nwse-resize"/>` : ''}</g>`; }).join('');
  svg.innerHTML = `<defs>${defs}<pattern id="floor" width="50" height="200" patternUnits="userSpaceOnUse"><rect width="50" height="200" fill="#8a6a45"/><path d="M0 0V200M25 100V200M0 100H50" stroke="#6f5334" stroke-width="2"/></pattern></defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#floor)"/><path d="${grid}" stroke="#fff" stroke-opacity=".10" stroke-width="1"/>
    <g>${objs}</g><rect x="0" y="0" width="${W}" height="${H}" fill="#000" opacity="${dark * 0.82}" style="pointer-events:none"/>
    <g style="mix-blend-mode:screen;pointer-events:none">${glow}</g><rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#e9e3d6" stroke-width="12"/>${fix}
    <text x="0" y="${H + 30}" font-size="15" fill="#aab">${l.w} m × ${l.h} m · approximate preview, not a physical simulation</text>`;
}
function vizPt(e) { const svg = $('#stage'), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()); return { x: p.x / U, y: p.y / U }; }
const snap = (n) => Math.round(n * 20) / 20;
const vizItem = (s) => s && viz.draft ? (s.k === 'o' ? viz.draft.objects : viz.draft.fixtures).find((x) => x.id === s.id) : null;

function renderViz(c) {
  if (viz.id && !S.layouts.find((l) => l.id === viz.id)) { viz.id = null; viz.draft = null; }
  if (!viz.draft && S.layouts.length) { viz.draft = vizClone(S.layouts[0]); viz.id = viz.draft.id; }
  if (!$('#vzRoot')) {
    c.innerHTML = `<div id="vzRoot"><div class="panel"><div class="ph">${ico('plan')}Room<select id="vzSel" style="min-width:150px"></select><button class="btn" data-a="new">New…</button><button class="btn" data-a="rename">Rename…</button><button class="btn" data-a="dup" data-tip="Make another version of this room to try a different setup">Duplicate</button><button class="btn danger" data-a="del">Delete</button>
        <span class="sp"></span><span style="font-weight:normal">Size</span><input type="number" id="vzW" min="1.5" max="30" step="0.5" style="width:58px"><span style="font-weight:normal">×</span><input type="number" id="vzH" min="1.5" max="30" step="0.5" style="width:58px"><span style="font-weight:normal">m</span></div>
      <div class="pb"><div class="viz" id="vzGrid">
        <div class="col"><fieldset><legend>Lights</legend><div class="pal">${Object.entries(FIX).map(([k, v]) => `<button class="btn" data-addf="${k}">${v[1]}</button>`).join('')}</div></fieldset>
          <fieldset><legend>Furniture</legend><div class="pal">${Object.entries(OBJ).map(([k, v]) => `<button class="btn" data-addo="${k}">${v[2]}</button>`).join('')}</div></fieldset>
          <div class="f"><label data-tip="How much daylight or other light is in the room in this preview">Room light</label><input type="range" id="vzAmb" min="0" max="100"></div><div class="muted small">Click to add, drag to move, drag the white square to resize. Delete removes the selected item.</div></div>
        <div><svg id="stage" tabindex="0"></svg></div>
        <div class="col"><fieldset><legend>Selected</legend><div id="vzProps"></div></fieldset>
          <fieldset><legend>Staging</legend><div class="col" style="gap:5px"><button class="btn pri" data-a="apply" data-tip="Send the colours shown here to the real lights linked to these fixtures">Apply to real lights</button><button class="btn" data-a="pull" data-tip="Copy what the linked lights are doing now into the preview">Copy from real lights</button>
            <div class="row"><select id="vzScene" style="flex:1"></select><button class="btn" data-a="scene" data-tip="Preview a scene here without touching the lights" style="min-width:0">Preview</button></div></div></fieldset>
          <fieldset><legend>Arrangements</legend><div id="vzArr" class="col" style="gap:3px"></div><div class="row wrap" style="margin-top:6px"><button class="btn" data-a="arrsave">Save staging…</button><button class="btn" data-a="flip" data-tip="Fade the preview between the two arrangements picked below">Compare</button></div>
            <div class="row" style="margin-top:5px"><select id="vzA" style="flex:1;min-width:0"></select><span>↔</span><select id="vzB" style="flex:1;min-width:0"></select></div></fieldset></div>
      </div><div class="empty hidden" id="vzEmpty">No room layouts yet. Create one to place your lights on a plan, try colours, and send the result to the real bulbs.<br><br><button class="btn pri" data-a="new">New room…</button></div></div></div></div>`;
    const root = $('#vzRoot'), svg = $('#stage');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.addo) { const [w, h] = OBJ[b.dataset.addo], l = viz.draft; const o = { id: vizId('o'), type: b.dataset.addo, x: snap(l.w / 2 - w / 2), y: snap(l.h / 2 - h / 2), w, h, rot: 0, label: '' }; l.objects.push(o); viz.sel = { k: 'o', id: o.id }; return vizAll(); }
      if (b.dataset.addf) { const l = viz.draft, f = { id: vizId('f'), type: b.dataset.addf, x: snap(l.w / 2), y: snap(l.h / 2), rot: 0, label: '', deviceId: null, state: { on: true, brightness: 80, kelvin: 2700 } }; l.fixtures.push(f); viz.sel = { k: 'f', id: f.id }; return vizAll(); }
      if (b.dataset.arr) return vizArrAct(b.dataset.arr, b.dataset.do);
      if (b.dataset.a) vizAct(b.dataset.a);
    });
    root.addEventListener('change', (e) => {
      const t = e.target, l = viz.draft;
      if (t.id === 'vzSel') { const src = S.layouts.find((x) => x.id === t.value); if (src) { viz.draft = vizClone(src); viz.id = src.id; viz.sel = null; viz.shown = null; vizAll(true); } }
      else if (t.id === 'vzW' || t.id === 'vzH') { l[t.id === 'vzW' ? 'w' : 'h'] = C.clamp(+t.value || 4, 1.5, 30); vizTouch(); }
      else if (t.dataset.p) vizProp(t);
    });
    root.addEventListener('input', (e) => { const t = e.target; if (t.id === 'vzAmb') { viz.draft.ambient = t.value / 100; vizTouch(); } else if (t.dataset.p && t.type === 'range') vizProp(t); else if (t.dataset.p === 'rgb') vizProp(t); });
    svg.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-k]'); viz.shown = null;
      if (!g) { viz.sel = null; return vizAll(true); }
      viz.sel = { k: g.dataset.k, id: g.dataset.id }; const it = vizItem(viz.sel), p = vizPt(e);
      viz.drag = { resize: !!e.target.dataset.h, dx: p.x - it.x, dy: p.y - it.y }; svg.setPointerCapture(e.pointerId); busyDrag = true; vizAll(true);
    });
    svg.addEventListener('pointermove', (e) => {
      const it = vizItem(viz.sel); if (!viz.drag || !it) return; const p = vizPt(e), l = viz.draft;
      if (viz.drag.resize) { it.w = C.clamp(snap(p.x - it.x), 0.1, 30); it.h = C.clamp(snap(p.y - it.y), 0.05, 30); }
      else { it.x = C.clamp(snap(p.x - viz.drag.dx), -1, l.w + 1); it.y = C.clamp(snap(p.y - viz.drag.dy), -1, l.h + 1); }
      vizDraw();
    });
    svg.addEventListener('pointerup', () => { if (viz.drag) { viz.drag = null; vizProps(); vizSave(); } });
    svg.addEventListener('keydown', (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && viz.sel) { e.preventDefault(); vizAct('remove'); } });
  }
  vizAll(true);
}
// Refresh everything on the page from the working copy. keep=true: nothing was edited, so do not save.
function vizAll(keep) {
  if (!$('#vzRoot')) return; const l = viz.draft;
  $('#vzGrid').classList.toggle('hidden', !l); $('#vzEmpty').classList.toggle('hidden', !!l);
  $('#vzSel').innerHTML = S.layouts.map((x) => `<option value="${esc(x.id)}" ${l && x.id === l.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('') + (l && !l.id ? `<option selected>${esc(l.name)}</option>` : '');
  if (!l) return;
  const a = document.activeElement; if (!a || a.id !== 'vzW') $('#vzW').value = l.w; if (!a || a.id !== 'vzH') $('#vzH').value = l.h; $('#vzAmb').value = Math.round(l.ambient * 100);
  $('#vzScene').innerHTML = S.scenes.map((s) => `<option value="${esc(s.id)}">${esc(s.icon + ' ' + s.name)}</option>`).join('');
  const opts = l.arrangements.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  const va = $('#vzA').value, vb = $('#vzB').value; $('#vzA').innerHTML = opts; $('#vzB').innerHTML = opts; if (va) $('#vzA').value = va; if (vb) $('#vzB').value = vb; else if (l.arrangements[1]) $('#vzB').value = l.arrangements[1].id;
  $('#vzArr').innerHTML = l.arrangements.map((x) => `<div class="row" style="gap:4px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(x.name)}</b></span><button class="btn" style="min-width:0" data-arr="${esc(x.id)}" data-do="show" data-tip="Load into the preview">Show</button><button class="btn" style="min-width:0" data-arr="${esc(x.id)}" data-do="apply" data-tip="Send to the real lights">Apply</button><button class="btn danger" style="min-width:0" data-arr="${esc(x.id)}" data-do="del">✕</button></div>`).join('') || '<span class="muted small">Save the staging as an arrangement to keep it, compare it with another, or schedule it.</span>';
  vizProps(); vizDraw(); if (!keep) vizSave();
}
function vizProps() {
  const box = $('#vzProps'), it = vizItem(viz.sel); if (!box) return;
  if (!it) { box.innerHTML = '<span class="muted">Click a light or a piece of furniture on the plan.</span>'; return; }
  const common = `<div class="f"><label>Label</label><input type="text" data-p="label" value="${esc(it.label || '')}" maxlength="40" placeholder="${viz.sel.k === 'f' ? FIX[it.type][1] : OBJ[it.type][2]}"></div><div class="f"><label>Rotation ${Math.round(it.rot || 0)}°</label><input type="range" data-p="rot" min="-180" max="180" step="15" value="${it.rot || 0}"></div>`;
  if (viz.sel.k === 'o') { box.innerHTML = common + `<div class="row"><span>Size</span><input type="number" data-p="w" value="${it.w}" min="0.1" max="30" step="0.05" style="width:62px"><span>×</span><input type="number" data-p="h" value="${it.h}" min="0.05" max="30" step="0.05" style="width:62px"><span>m</span></div><button class="btn danger" data-a="remove" style="margin-top:8px">Delete</button>`; return; }
  const s = it.state, d = it.deviceId ? dev(it.deviceId) : null;
  box.innerHTML = `<div class="f"><label>Real light</label><select data-p="deviceId"><option value="">Not linked (preview only)</option>${S.devices.map((x) => `<option value="${esc(x.id)}" ${x.id === it.deviceId ? 'selected' : ''}>${esc(x.name)} (${BRANDS[x.brand]})</option>`).join('')}</select></div>
    ${d ? `<div class="muted small" style="margin:-4px 0 6px"><i class="led ${d.online === false ? 'bad' : 'ok'}"></i>${d.online === false ? 'Offline' : 'Online'} · ${[d.caps.color && 'colour', d.caps.temp && 'white', d.caps.dim && 'dimming'].filter(Boolean).join(', ') || 'on/off only'}${s.rgb && !d.caps.color ? ' · this light cannot show colour; it will use the nearest white' : ''}</div>` : ''}
    <label class="chk"><input type="checkbox" data-p="on" ${s.on !== false ? 'checked' : ''}>On</label>
    <div class="f"><label>Colour</label><div class="swatches">${SWATCHES.map((h) => `<button class="sw" style="background:${h}" data-vc="${h}"></button>`).join('')}<input type="color" data-p="rgb" value="${s.rgb ? C.hex(s.rgb) : '#ffffff'}"></div></div>
    <div class="f"><label>…or white ${s.rgb ? '' : (s.kelvin || 2700) + ' K'}</label><input type="range" class="kelvin" data-p="kelvin" min="2200" max="6500" step="50" value="${s.kelvin || 2700}"></div>
    <div class="f"><label>Brightness ${s.brightness || 80}%</label><input type="range" data-p="brightness" min="1" max="100" value="${s.brightness || 80}"></div>${common}<button class="btn danger" data-a="remove">Delete</button>`;
  $$('[data-vc]', box).forEach((b) => (b.onclick = () => { it.state = { on: true, brightness: s.brightness || 80, rgb: C.parseColor(b.dataset.vc) }; viz.shown = null; vizProps(); vizTouch(); }));
}
function vizProp(t) {
  const it = vizItem(viz.sel); if (!it) return; const p = t.dataset.p; viz.shown = null;
  if (p === 'label') it.label = t.value; else if (p === 'rot') it.rot = +t.value; else if (p === 'w' || p === 'h') it[p] = C.clamp(+t.value || 0.5, 0.05, 30); else if (p === 'deviceId') it.deviceId = t.value || null;
  else if (p === 'on') it.state.on = t.checked; else if (p === 'brightness') it.state.brightness = +t.value; else if (p === 'kelvin') { delete it.state.rgb; it.state.kelvin = +t.value; it.state.on = true; } else if (p === 'rgb') { it.state.rgb = C.parseColor(t.value); delete it.state.kelvin; it.state.on = true; }
  if (t.type !== 'range' || p === 'rot') vizProps();
  vizTouch();
}
// Fade the preview from what is showing to another set of fixture states (shows "a preview of the transition").
function vizFade(target) {
  cancelAnimationFrame(viz.anim); const l = viz.draft, from = {}, t0 = performance.now();
  for (const f of l.fixtures) from[f.id] = { ...fxState(f) };
  const step = (now) => { const k = Math.min(1, (now - t0) / 700); viz.shown = {};
    for (const f of l.fixtures) { const a = from[f.id], b = target[f.id] || f.state, ab = a.on === false ? 0 : (a.brightness || 80), bb = b.on === false ? 0 : (b.brightness || 80);
      viz.shown[f.id] = { on: ab + (bb - ab) * k > 0.5, brightness: Math.max(1, ab + (bb - ab) * k), rgb: C.lerpRgb(stRgb(a), stRgb(b), k) }; }
    vizDraw(); if (k < 1) viz.anim = requestAnimationFrame(step); else { viz.shown = target; vizDraw(); } };
  viz.anim = requestAnimationFrame(step);
}
async function vizArrAct(id, what) {
  const l = viz.draft, a = l.arrangements.find((x) => x.id === id); if (!a) return;
  if (what === 'show') { for (const f of l.fixtures) if (a.states[f.id]) f.state = vizClone(a.states[f.id]); viz.shown = null; vizAll(); toast(`Showing "${a.name}" in the preview`); }
  else if (what === 'apply') { await call('layout:save', l); const r = await call('layout:apply', l.id, id); toast(`"${a.name}" sent to ${r.ok} light(s)${r.failed ? `, ${r.failed} did not respond` : ''}`, !!r.failed); }
  else if (what === 'del') { if (await confirmBox('Delete arrangement', `Delete "${a.name}"?`, 'Delete')) { l.arrangements = l.arrangements.filter((x) => x !== a); vizAll(); } }
}
async function vizAct(a) {
  const l = viz.draft;
  if (a === 'new') { const n = await ask('New room layout', S.rooms[0] ? S.rooms[0].name : 'Living room', 'Room name'); if (!n) return; const saved = await call('layout:save', { ...vizNew(), name: n }); viz.draft = vizClone(saved); viz.id = saved.id; viz.sel = null; return vizAll(true); }
  if (!l) return;
  if (a === 'rename') { const n = await ask('Rename layout', l.name); if (n) { l.name = n; vizAll(); } }
  else if (a === 'dup') { const saved = await call('layout:save', { ...vizClone(l), id: '', name: l.name + ' (version 2)' }); viz.draft = vizClone(saved); viz.id = saved.id; vizAll(true); toast('Made a copy. Changes here do not affect the original.'); }
  else if (a === 'del') { if (await confirmBox('Delete layout', `Delete the layout "${l.name}" and its arrangements?`, 'Delete')) { await call('layout:delete', l.id); viz.draft = null; viz.id = null; viz.sel = null; } }
  else if (a === 'remove') { if (!viz.sel) return; if (viz.sel.k === 'o') l.objects = l.objects.filter((x) => x.id !== viz.sel.id); else l.fixtures = l.fixtures.filter((x) => x.id !== viz.sel.id); viz.sel = null; vizAll(); }
  else if (a === 'apply') { if (!l.fixtures.some((f) => f.deviceId)) return toast('Link at least one fixture to a real light first (select it, then pick "Real light").', true); await call('layout:save', l); const r = await call('layout:apply', l.id); toast(`Sent to ${r.ok} light(s)${r.failed ? `, ${r.failed} did not respond` : ''}. Undo puts them back.`, !!r.failed); }
  else if (a === 'pull') { let n = 0; for (const f of l.fixtures) { const d = f.deviceId && dev(f.deviceId); if (d) { f.state = d.mode === 'color' && d.rgb ? { on: !!d.on, brightness: d.brightness || 80, rgb: d.rgb } : { on: !!d.on, brightness: d.brightness || 80, kelvin: d.kelvin || 2700 }; n++; } } viz.shown = null; vizAll(); toast(n ? `Copied ${n} light(s) into the preview` : 'No fixture is linked to a real light yet', !n); }
  else if (a === 'scene') { const sc = S.scenes.find((x) => x.id === $('#vzScene').value); if (!sc) return; const tgt = {};
    for (const f of l.fixtures) { const e = sc.entry || (f.deviceId && sc.devices[f.deviceId]); if (e) tgt[f.id] = { on: e.on !== false, brightness: e.brightness || 80, ...(e.rgb ? { rgb: e.rgb } : { kelvin: e.kelvin || 2700 }) }; }
    vizFade(tgt); toast(`Previewing "${sc.name}". Nothing was sent to the lights.`); }
  else if (a === 'arrsave') { if (!l.fixtures.length) return toast('Add a light to the plan first', true); const n = await ask('Save arrangement', `Arrangement ${l.arrangements.length + 1}`); if (!n) return; l.arrangements.push({ id: vizId('arr'), name: n, states: Object.fromEntries(l.fixtures.map((f) => [f.id, vizClone(f.state)])) }); vizAll(); }
  else if (a === 'flip') { const A = l.arrangements.find((x) => x.id === $('#vzA').value), B = l.arrangements.find((x) => x.id === $('#vzB').value); if (!A || !B || A === B) return toast('Save two arrangements, then pick them in the two boxes to compare.', true); viz.cmp = viz.cmp === 1 ? 0 : 1; const pick = viz.cmp ? B : A; vizFade(pick.states); toast(`Showing "${pick.name}"`); }
}
