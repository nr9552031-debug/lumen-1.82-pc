'use strict';
/* Window shell (menu bar, toolbar, navigation pane, status bar), the Home and Lights pages and the Properties pane. */
const PAGES = {
  home: ['Lumen Home', 'home'], all: ['All Lights', 'bulb'], room: ['Room', 'room'], group: ['Group', 'group'], studio: ['Colour Studio', 'studio'], viz: ['Room Visualizer', 'plan'], proj: ['Projection Studio', 'proj'], show: ['Lightshow', 'show'],
  fx: ['Audio & Effects', 'fx'], scenes: ['Scenes', 'scene'], schedules: ['Schedules', 'clock'], settings: ['Control Panel', 'cp'],
};
const go = (t, id) => { view = { t, id }; selected = null; filter = ''; render(); };

/* ---------- title bar ---------- */
$('#wMin').onclick = () => call('win:min'); $('#wMax').onclick = () => call('win:max'); $('#wClose').onclick = () => call('win:close');
if (window.lumen.onWin) window.lumen.onWin((s) => { document.body.classList.toggle('blurred', !s.focused); });

/* ---------- menu bar ---------- */
const MENUS = {
  File: () => [{ label: 'Scan for lights', key: 'F5', run: scan }, '-', { label: 'Export backup…', run: exportBackup }, { label: 'Import backup…', run: importBackup }, '-', { label: 'Exit', key: 'Alt+F4', run: () => call('win:close') }],
  View: () => [...Object.keys(THEMES).map((k) => ({ label: THEMES[k], checked: (S.settings.theme || 'aero') === k, run: () => setTheme(k).then(render) })), '-',
    { label: 'Tiles', checked: (S.settings.viewMode || 'tiles') === 'tiles', run: () => setViewMode('tiles') }, { label: 'Details', checked: S.settings.viewMode === 'details', run: () => setViewMode('details') }, '-',
    { label: 'Home', key: 'Ctrl+1', run: () => go('home') }, { label: 'All Lights', key: 'Ctrl+2', run: () => go('all') }, { label: 'Scenes', key: 'Ctrl+6', run: () => go('scenes') }],
  Lights: () => [{ label: 'All lights on', run: () => applyTo({ type: 'all' }, { on: true }, 'All on') }, { label: 'All lights off', run: () => applyTo({ type: 'all' }, { on: false }, 'All off') }, '-',
    { label: S.history.undo ? `Undo ${S.history.undo}` : 'Undo', key: 'Ctrl+Z', disabled: !S.history.undo, run: undo }, { label: S.history.redo ? `Redo ${S.history.redo}` : 'Redo', key: 'Ctrl+Y', disabled: !S.history.redo, run: redo }, '-',
    { label: S.sleep ? 'Cancel sleep timer' : 'Sleep timer…', run: sleepTimer }, { label: 'New room…', run: newRoom }, { label: 'New group…', run: newGroup }],
  Tools: () => [{ label: 'Colour Studio', key: 'Ctrl+3', run: () => go('studio') }, { label: 'Room Visualizer', key: 'Ctrl+4', run: () => go('viz') }, { label: 'Projection Studio', run: () => go('proj') }, { label: 'Lightshow', run: () => go('show') }, { label: 'Audio & Effects', key: 'Ctrl+5', run: () => go('fx') }, { label: 'Schedules', key: 'Ctrl+7', run: () => go('schedules') }, '-',
    { label: 'Control Panel', run: () => go('settings') }, { label: 'Copy diagnostics', run: () => call('diag:copy').then(() => toast('Diagnostics copied to the clipboard', true)) }],
  Help: () => [{ label: 'Keyboard shortcuts', run: showKeys }, { label: 'About Lumen', run: about }],
};
function renderMenubar() { $('#menubar').innerHTML = Object.keys(MENUS).map((m) => `<button data-menu="${m}">${m}</button>`).join(''); }
function openMenu(btn) { const r = btn.getBoundingClientRect(); popup(MENUS[btn.dataset.menu](), r.left, r.bottom, btn); }
$('#menubar').addEventListener('click', (e) => { const b = e.target.closest('[data-menu]'); if (!b) return; if (b.classList.contains('open')) closePopup(); else openMenu(b); });
$('#menubar').addEventListener('pointerover', (e) => { const b = e.target.closest('[data-menu]'); if (b && $('#popup') && popup.anchor && popup.anchor !== b && popup.anchor.dataset.menu) openMenu(b); });

/* ---------- commands ---------- */
const scan = () => call('scan');
const undo = () => call('undo').then((l) => toast(`Undid: ${l}`));
const redo = () => call('redo').then((l) => toast(`Redid: ${l}`));
const setViewMode = (m) => { S.settings.viewMode = m; call('settings:set', { viewMode: m }); render(); };
async function exportBackup() { const p = await call('backup:export'); if (p) toast(`Backup saved to ${p}`, true); }
async function importBackup() {
  if (!await confirmBox('Import backup', 'Importing replaces your rooms, groups, scenes, room layouts and schedules with the ones in the backup file. Accounts and lights are not affected.', 'Choose file…')) return;
  const r = await call('backup:import'); if (r) toast(`Restored ${r.rooms} rooms, ${r.scenes} scenes, ${r.layouts} layouts, ${r.schedules} schedules`, true);
}
async function sleepTimer() {
  if (S.sleep) return call('sleep:cancel').then(() => toast('Sleep timer cancelled'));
  const r = await dialogBox('Sleep timer', `<p style="margin-bottom:8px">Turn lights off after a while.</p><div class="kvgrid" style="grid-template-columns:auto 1fr"><label>Turn off</label><select id="slScope">${scopeOptions()}</select><label>After</label><select id="slMin">${[5, 10, 15, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></div>`,
    [{ label: 'Start', pri: true, value: (d) => ({ min: +$('#slMin', d).value, scope: parseScope($('#slScope', d).value) }) }, { label: 'Cancel', value: null }]);
  if (r) { await call('sleep:set', r.min, r.scope); toast(`Lights will turn off in ${r.min} minutes`); }
}
async function newRoom() { const n = await ask('New room', '', 'Room name'); if (n) await call('room:add', n); }
function newGroup() { return editGroup({ name: '', deviceIds: [] }); }
async function editGroup(g) {
  const r = await dialogBox(g.id ? 'Edit group' : 'New group', `<div class="f"><label>Group name</label><input type="text" id="gName" value="${esc(g.name)}" style="width:320px" maxlength="60"></div>
    <fieldset><legend>Lights in this group</legend><div style="max-height:240px;overflow:auto">${S.devices.map((d) => `<label class="chk"><input type="checkbox" value="${esc(d.id)}" ${g.deviceIds.includes(d.id) ? 'checked' : ''}>${esc(d.name)} <span class="tag ${d.brand}" style="margin-left:6px">${BRANDS[d.brand]}</span></label>`).join('') || '<span class="muted">No lights yet.</span>'}</div></fieldset>`,
    [{ label: 'OK', pri: true, value: (d) => ({ name: $('#gName', d).value.trim(), deviceIds: $$('input[type=checkbox]:checked', d).map((c) => c.value) }) }, { label: 'Cancel', value: null }]);
  if (r && r.name) await call('group:save', { id: g.id, ...r });
}
function showKeys() { dialogBox('Keyboard shortcuts', `<dl class="kv">${[['F5', 'Scan for lights'], ['Ctrl+F', 'Search lights'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo the last lighting change'], ['Ctrl+1 … Ctrl+7', 'Home, Lights, Colour Studio, Visualizer, Effects, Scenes, Schedules'], ['Esc', 'Close menus and the properties pane'], ['Right-click', 'More actions on lights, rooms and scenes']].map(([k, v]) => `<dt><b>${k}</b></dt><dd>${v}</dd>`).join('')}</dl>`); }
async function about() { const i = await call('app:info'); dialogBox('About Lumen', `<div class="row" style="gap:14px;align-items:flex-start">${ico('bulb', 'xl')}<div><h3 style="font-size:15px">Lumen</h3><p>Version ${esc(i.version)}</p><p class="muted">${esc(i.runtime || '')}</p><p style="margin-top:8px;max-width:330px">One control centre for WiZ, Hubspace and GE Cync lights. Not affiliated with those brands or with Microsoft; the interface is a tribute to the Windows XP and Windows 7 era.</p></div></div>`); }
document.addEventListener('keydown', (e) => {
  if ($('#dlg').open) return;
  if (e.key === 'Escape') { closePopup(); if (selected) { selected = null; renderDrawer(); } return; }
  if (e.key === 'F5') { e.preventDefault(); return scan(); }
  if (!e.ctrlKey) return;
  const typing = e.target.matches && e.target.matches('input,textarea,select');
  const k = e.key.toLowerCase();
  if (k === 'f') { e.preventDefault(); if (!['all', 'room', 'group'].includes(view.t)) go('all'); const s = $('#search'); if (s) s.focus(); }
  else if (k === 'z' && !typing) { e.preventDefault(); if (S.history.undo) undo(); }
  else if (k === 'y' && !typing) { e.preventDefault(); if (S.history.redo) redo(); }
  else if (/^[1-7]$/.test(k)) { e.preventDefault(); go(['home', 'all', 'studio', 'viz', 'fx', 'scenes', 'schedules'][+k - 1]); }
});

/* ---------- navigation pane ---------- */
function renderNav() {
  const item = (on, icon, label, n, attr) => `<button class="nav-i ${on ? 'on' : ''}" ${attr}>${ico(icon)}<span class="t">${esc(label)}</span>${n !== undefined ? `<span class="n">${n}</span>` : ''}</button>`;
  const box = (title, body, add) => `<div class="gbx"><h4>${title}${add ? `<button data-add="${add}" data-tip="New ${add}">+</button>` : ''}</h4><div>${body}</div></div>`;
  $('#nav').innerHTML =
    box('Lighting', item(view.t === 'home', 'home', 'Home', undefined, 'data-nav="home"') + item(view.t === 'all', 'bulb', 'All Lights', S.devices.length, 'data-nav="all"') + item(view.t === 'scenes', 'scene', 'Scenes', undefined, 'data-nav="scenes"')) +
    box('Rooms', S.rooms.map((r) => item(view.t === 'room' && view.id === r.id, 'room', r.name, S.devices.filter((d) => d.room === r.id).length, `data-nav="room" data-id="${r.id}"`)).join('') || '<div class="nav-empty">No rooms yet</div>', 'room') +
    box('Groups', S.groups.map((g) => item(view.t === 'group' && view.id === g.id, 'group', g.name, g.deviceIds.length, `data-nav="group" data-id="${g.id}"`)).join('') || '<div class="nav-empty">No groups yet</div>', 'group') +
    box('Tools', item(view.t === 'studio', 'studio', 'Colour Studio', undefined, 'data-nav="studio"') + item(view.t === 'viz', 'plan', 'Room Visualizer', undefined, 'data-nav="viz"') + item(view.t === 'proj', 'proj', 'Projection Studio', undefined, 'data-nav="proj"') + item(view.t === 'show', 'show', 'Lightshow', undefined, 'data-nav="show"') + item(view.t === 'fx', 'fx', 'Audio & Effects', undefined, 'data-nav="fx"') +
      item(view.t === 'schedules', 'clock', 'Schedules', undefined, 'data-nav="schedules"') + item(view.t === 'settings', 'cp', 'Control Panel', undefined, 'data-nav="settings"'));
}
$('#nav').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]'); if (add) return add.dataset.add === 'room' ? newRoom() : newGroup();
  const n = e.target.closest('[data-nav]'); if (n) go(n.dataset.nav, n.dataset.id);
});
$('#nav').addEventListener('contextmenu', (e) => {
  const n = e.target.closest('[data-nav][data-id]'); if (!n) return; e.preventDefault();
  const id = n.dataset.id, scope = { type: n.dataset.nav, id };
  const items = [{ label: 'Turn on', run: () => applyTo(scope, { on: true }, 'On') }, { label: 'Turn off', run: () => applyTo(scope, { on: false }, 'Off') }, { label: 'Colour…', run: () => { go('studio'); studioTarget(scope); } }, '-'];
  if (n.dataset.nav === 'room') items.push({ label: 'Rename…', run: async () => { const v = await ask('Rename room', roomName(id)); if (v) call('room:rename', id, v); } }, { label: 'Delete room', run: async () => { if (await confirmBox('Delete room', `Delete the room "${roomName(id)}"? Its lights are kept and become unassigned.`, 'Delete')) { await call('room:delete', id); if (view.id === id) go('all'); } } });
  else { const g = S.groups.find((x) => x.id === id); items.push({ label: 'Edit members…', run: () => editGroup(g) }, { label: 'Delete group', run: async () => { if (await confirmBox('Delete group', `Delete the group "${g.name}"?`, 'Delete')) { await call('group:delete', id); if (view.id === id) go('all'); } } }); }
  popup(items, e.clientX, e.clientY);
});

/* ---------- toolbar ---------- */
function renderToolbar() {
  const tb = $('#toolbar'), lights = ['all', 'room', 'group'].includes(view.t);
  let title = PAGES[view.t][0];
  if (view.t === 'room') title = roomName(view.id) || 'Room';
  if (view.t === 'group') title = (S.groups.find((g) => g.id === view.id) || {}).name || 'Group';
  const list = lights ? devicesIn(scopeOf()) : [];
  const avg = list.length ? Math.round(list.reduce((a, d) => a + (d.brightness || 100), 0) / list.length) : 100;
  tb.innerHTML = `${ico(PAGES[view.t][1], 'lg')}<h1>${esc(title)}</h1>` +
    (lights ? `<span class="sub">${list.filter((d) => d.on && d.online !== false).length} of ${list.length} on</span><span class="sp"></span>
      <button class="btn" data-act="on">On</button><button class="btn" data-act="off">Off</button><input type="range" min="1" max="100" value="${avg}" id="masterBri" style="width:110px" data-tip="Brightness for every light shown">
      <button class="btn ic" data-act="studio" data-tip="Colour these lights in the Colour Studio">${ico('studio')}Colour</button>
      <span class="row" style="gap:3px">${ico('search')}<input type="text" id="search" placeholder="Search lights" value="${esc(filter)}" style="width:130px"></span>` : '<span class="sp"></span>') +
    `<button class="btn ic" data-act="undo" ${S.history.undo ? '' : 'disabled'} data-tip="${esc(S.history.undo ? 'Undo ' + S.history.undo + ' (Ctrl+Z)' : 'Nothing to undo')}">${ico('undo')}</button>
     <button class="btn ic" data-act="redo" ${S.history.redo ? '' : 'disabled'} data-tip="${esc(S.history.redo ? 'Redo ' + S.history.redo + ' (Ctrl+Y)' : 'Nothing to redo')}">${ico('redo')}</button>
     <button class="btn ic" data-act="scan" ${S.scanning ? 'disabled' : ''} data-tip="Look for lights again (F5)">${S.scanning ? '<span class="spin"></span>Scanning' : ico('scan') + 'Scan'}</button>`;
}
$('#toolbar').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a) return; const scope = scopeOf();
  ({ on: () => applyTo(scope, { on: true }, 'On'), off: () => applyTo(scope, { on: false }, 'Off'), undo, redo, scan, studio: () => { go('studio'); studioTarget(scope); } })[a.dataset.act]();
});
$('#toolbar').addEventListener('input', (e) => {
  if (e.target.id === 'search') { filter = e.target.value; renderContent(); }
  if (e.target.id === 'masterBri') masterBri(scopeOf(), +e.target.value);
});
const masterBri = throttle((scope, v) => applyTo(scope, { on: true, brightness: v }, 'Brightness'), 140);

/* ---------- status bar ---------- */
function renderStatus() {
  const n = (b) => S.devices.filter((d) => d.brand === b).length, on = S.devices.filter((d) => d.on && d.online !== false).length, off = S.devices.filter((d) => d.online === false).length;
  const acct = (b, name) => `<span data-tip="${esc(S.errors[b] || '')}"><i class="led ${S.errors[b] ? 'bad' : S.accounts[b] ? 'ok' : ''}"></i>${name}: ${S.errors[b] ? 'problem' : S.accounts[b] ? n(b) + ' lights' : 'not connected'}</span>`;
  $('#statusbar').innerHTML = `<span class="grow">${S.scanning ? '<span class="spin"></span>Scanning for lights…' : `${S.devices.length} lights · ${on} on${off ? ` · ${off} offline` : ''}`}</span>
    <span><i class="led ${S.errors.wiz ? 'bad' : n('wiz') ? 'ok' : ''}"></i>WiZ: ${n('wiz')} local</span>${acct('hubspace', 'Hubspace')}${acct('cync', 'Cync')}
    ${S.fx && S.fx.active ? `<span><i class="led warn"></i>Effect: ${esc(S.fx.mode)}</span>` : ''}${S.sleep ? `<span data-tip="Lights → Cancel sleep timer">Sleep in ${Math.max(1, Math.round((S.sleep.at - Date.now()) / 60000))} min</span>` : ''}
    <span>Last scan: ${ago(S.lastScan)}</span>`;
}

/* ---------- light tiles / details ---------- */
const powerBtn = (on, attrs = '', big) => `<button class="power ${on ? 'on' : ''} ${big ? 'big' : ''}" ${attrs}><svg><use href="#i-power"/></svg></button>`;
function tile(d) {
  const offl = d.online === false;
  return `<div class="tile ${d.on && !offl ? 'on' : 'off'} ${offl ? 'offline' : ''} ${selected === d.id ? 'sel' : ''}" data-id="${esc(d.id)}">
    <div class="bulb" style="--c:${d.on && !offl ? lightColor(d) : 'transparent'}">${ico('bulb')}</div>
    <div class="nm" data-open data-tip="Open properties">${esc(d.name)}</div>${powerBtn(d.on && !offl, `data-toggle ${offl ? 'disabled' : ''} data-tip="${d.on ? 'Turn off' : 'Turn on'}"`)}
    <div class="st"><span class="tag ${d.brand}">${BRANDS[d.brand]}</span> ${esc(stateText(d))}${d.assumed ? ' · unconfirmed' : ''}${d.room && view.t !== 'room' ? ' · ' + esc(roomName(d.room)) : ''}</div>
    ${d.caps.dim ? `<input type="range" min="1" max="100" value="${d.brightness || 100}" data-bri ${offl ? 'disabled' : ''}>` : ''}</div>`;
}
function sorted(list) {
  const key = { name: (d) => d.name.toLowerCase(), brand: (d) => d.brand, room: (d) => roomName(d.room).toLowerCase(), state: (d) => (d.online === false ? 2 : d.on ? 0 : 1), brightness: (d) => d.brightness || 0 }[ui.sort];
  return [...list].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * ui.dir);
}
function details(list) {
  const th = (k, l) => `<th data-sort="${k}">${l}${ui.sort === k ? (ui.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  return `<div class="lvwrap"><table class="lv"><thead><tr>${th('name', 'Name')}${th('brand', 'Brand')}${th('room', 'Room')}${th('state', 'State')}${th('brightness', 'Brightness')}<th>Last seen</th></tr></thead><tbody>${list.map((d) => `<tr data-id="${esc(d.id)}" class="${selected === d.id ? 'sel' : ''}">
    <td><span class="row" style="gap:6px">${powerBtn(d.on && d.online !== false, `data-toggle style="width:18px;height:18px" ${d.online === false ? 'disabled' : ''}`)}<i class="sw" style="background:${d.on ? lightColor(d) : '#888'};width:12px;height:12px"></i><span data-open>${esc(d.name)}</span></span></td>
    <td>${BRANDS[d.brand]}</td><td>${esc(roomName(d.room) || '—')}</td><td><i class="led ${d.online === false ? 'bad' : d.on ? 'ok' : ''}"></i>${esc(stateText(d))}</td><td>${d.caps.dim ? (d.brightness || 100) + '%' : '—'}</td><td>${ago(d.lastSeen)}</td></tr>`).join('')}</tbody></table></div>`;
}
function errorNotes() {
  return Object.entries(S.errors || {}).map(([b, m]) => `<div class="note err"><i class="led bad"></i><span><b>${esc(BRANDS[b] || b)}</b> ${(S.needsReauth || {})[b] ? 'sign-in expired' : "couldn't be reached"}: ${esc(m)} <a data-go="settings">${(S.needsReauth || {})[b] ? 'Reconnect' : 'Open Control Panel'}</a></span></div>`).join('');
}
function renderLights(c) {
  let list = devicesIn(scopeOf()); const q = filter.trim().toLowerCase();
  if (q) list = list.filter((d) => (d.name + ' ' + BRANDS[d.brand] + ' ' + roomName(d.room)).toLowerCase().includes(q));
  list = sorted(list);
  if (!list.length) {
    c.innerHTML = errorNotes() + `<div class="panel"><div class="empty">${q ? `No light matches "${esc(q)}".` : S.devices.length ? `Nothing here yet. Right-click a light and choose a ${view.t === 'group' ? 'group' : 'room'} for it.` : 'No lights found yet. WiZ bulbs are found automatically on your Wi-Fi. For Hubspace and Cync, connect your account in the <a data-go="settings">Control Panel</a>.'}</div></div>`;
    return;
  }
  const mode = S.settings.viewMode || 'tiles';
  if (mode === 'details') { c.innerHTML = errorNotes() + details(list); return; }
  if (view.t === 'all' && S.rooms.length && !q) {
    const sections = [...S.rooms.map((r) => [r.name, list.filter((d) => d.room === r.id)]), ['Unassigned', list.filter((d) => !d.room || !S.rooms.find((r) => r.id === d.room))]].filter(([, l]) => l.length);
    c.innerHTML = errorNotes() + sections.map(([n, l]) => `<div class="sect">${ico('room')}${esc(n)}</div><div class="tiles">${l.map(tile).join('')}</div>`).join('');
  } else c.innerHTML = errorNotes() + `<div class="tiles">${list.map(tile).join('')}</div>`;
}
function lightMenu(d, x, y) {
  const one = { type: 'devices', ids: [d.id] };
  popup([{ label: d.on ? 'Turn off' : 'Turn on', disabled: d.online === false, run: () => applyTo(one, { on: !d.on }, d.on ? 'Off' : 'On') }, { label: 'Colour…', run: () => { go('studio'); studioTarget({ type: 'devices', ids: [d.id] }); } }, { label: 'Properties', run: () => { selected = d.id; renderDrawer(); } }, '-',
    { label: 'Rename…', run: async () => { const v = await ask('Rename light', d.name); if (v) call('device:meta', d.id, { name: v }); } },
    ...S.rooms.map((r) => ({ label: `Move to ${r.name}`, checked: d.room === r.id, run: () => call('device:meta', d.id, { room: r.id }) })), { label: 'No room', checked: !d.room, run: () => call('device:meta', d.id, { room: '' }) }, '-',
    { label: 'Remove from Lumen', run: async () => { if (await confirmBox('Remove light', `Remove "${d.name}" from Lumen? It will come back on the next scan if it is still on your network or account.`, 'Remove')) { selected = null; call('device:forget', d.id); } } }], x, y);
}
$('#content').addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); return go(g.dataset.go, g.dataset.id); }
  const th = e.target.closest('th[data-sort]'); if (th) { ui.dir = ui.sort === th.dataset.sort ? -ui.dir : 1; ui.sort = th.dataset.sort; return renderContent(); }
  const el = e.target.closest('.tile,table.lv tr[data-id]'); if (!el || !['all', 'room', 'group', 'home'].includes(view.t)) return;
  const d = dev(el.dataset.id); if (!d) return;
  if (e.target.closest('[data-toggle]')) applyTo({ type: 'devices', ids: [d.id] }, { on: !d.on }, d.on ? 'Off' : 'On');
  else if (e.target.closest('[data-open]') || el.tagName === 'TR') { selected = d.id; renderDrawer(); renderContent(); }
});
$('#content').addEventListener('contextmenu', (e) => { const el = e.target.closest('.tile,table.lv tr[data-id]'); const d = el && dev(el.dataset.id); if (d) { e.preventDefault(); lightMenu(d, e.clientX, e.clientY); } });
$('#content').addEventListener('input', throttle((e) => {
  if (!e.target.matches('[data-bri]')) return;
  applyTo({ type: 'devices', ids: [e.target.closest('.tile').dataset.id] }, { on: true, brightness: +e.target.value }, 'Brightness');
}, 140));

/* ---------- home ---------- */
function renderHome(c) {
  const h = new Date().getHours(), on = S.devices.filter((d) => d.on && d.online !== false), favs = S.scenes.filter((s) => s.fav), scenes = (favs.length ? favs : S.scenes).slice(0, 8);
  const prov = (b, name, how, ok, n) => `<div class="row" style="padding:3px 0"><i class="led ${S.errors[b] ? 'bad' : ok ? 'ok' : ''}"></i><b style="width:70px">${name}</b><span class="muted">${S.errors[b] ? esc(S.errors[b]) : ok ? `${n} light${n === 1 ? '' : 's'} · ${how}` : `not connected · <a data-go="settings">set up</a>`}</span></div>`;
  const cnt = (b) => S.devices.filter((d) => d.brand === b).length;
  const recent = [...S.devices].filter((d) => d.lastCmd).sort((a, b) => b.lastCmd - a.lastCmd).slice(0, 5);
  const rooms = [...S.rooms.map((r) => [r, S.devices.filter((d) => d.room === r.id)]), [{ id: '', name: 'Unassigned' }, S.devices.filter((d) => !d.room || !S.rooms.find((r) => r.id === d.room))]].filter(([, l]) => l.length);
  c.innerHTML = errorNotes() + `<div class="banner">${ico('bulb', 'xl')}<div><h2>Good ${h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'}</h2><div>${S.devices.length ? `${on.length} of ${S.devices.length} lights are on${S.rooms.length ? ` across ${S.rooms.length} room${S.rooms.length === 1 ? '' : 's'}` : ''}.` : 'No lights yet. Lumen is looking on your network.'}${S.fx && S.fx.active ? ` An effect is running (${esc(S.fx.mode)}).` : ''}</div></div>
    <span class="sp"></span>${powerBtn(on.length > 0, `data-home="toggle" data-tip="${on.length ? 'Turn everything off' : 'Turn everything on'}"`, true)}</div>
  <div class="cols">
    <div class="panel"><div class="ph">${ico('scene')}${favs.length ? 'Favourite scenes' : 'Scenes'}<a class="right" data-go="scenes" style="font-weight:normal">All scenes</a></div><div class="pb shortcuts">${scenes.map((s) => `<button class="shortcut" data-scene="${esc(s.id)}" data-tip="Apply to all lights"><div class="big">${esc(s.icon)}</div><span class="cap">${esc(s.name)}</span></button>`).join('')}</div></div>
    <div class="panel"><div class="ph">${ico('studio')}Quick colour<a class="right" data-go="studio" style="font-weight:normal">Colour Studio</a></div><div class="pb"><div class="swatches">${[...(S.settings.favColors || []).map(C.hex), ...SWATCHES].slice(0, 20).map((h2) => `<button class="sw" style="background:${h2}" data-qc="${h2}" data-tip="All colour lights to ${h2}"></button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><span class="muted">All lights</span><input type="range" min="1" max="100" value="${S.devices.length ? Math.round(S.devices.reduce((a, d) => a + (d.brightness || 100), 0) / S.devices.length) : 100}" id="homeBri" style="flex:1"></div></div></div>
    <div class="panel"><div class="ph">${ico('cp')}Connections</div><div class="pb">${prov('wiz', 'WiZ', 'local network', cnt('wiz') > 0, cnt('wiz'))}${prov('hubspace', 'Hubspace', 'cloud', S.accounts.hubspace, cnt('hubspace'))}${prov('cync', 'GE Cync', 'cloud relay', S.accounts.cync, cnt('cync'))}
      <div class="muted small" style="margin-top:6px">Last scan ${ago(S.lastScan)}${S.schedules.filter((s) => s.enabled).length ? ` · ${S.schedules.filter((s) => s.enabled).length} schedule(s) active` : ''}</div></div></div>
  </div>
  ${rooms.map(([r, l]) => `<div class="panel"><div class="ph">${ico('room')}${esc(r.name)}<span class="muted" style="font-weight:normal">${l.filter((d) => d.on && d.online !== false).length} of ${l.length} on</span><span class="sp"></span>
      ${r.id ? `<button class="btn" data-room-on="${r.id}">On</button><button class="btn" data-room-off="${r.id}">Off</button><a data-go="room" data-id="${r.id}" style="font-weight:normal">Open</a>` : ''}</div><div class="pb tiles">${l.map(tile).join('')}</div></div>`).join('')}
  ${recent.length ? `<div class="panel"><div class="ph">${ico('clock')}Recently controlled</div><div class="pb">${recent.map((d) => `<div class="row" style="padding:2px 0"><i class="sw" style="background:${d.on ? lightColor(d) : '#888'};width:12px;height:12px"></i><a data-open-id="${esc(d.id)}">${esc(d.name)}</a><span class="muted">${esc(stateText(d))} · ${ago(d.lastCmd)}</span></div>`).join('')}</div></div>` : ''}`;
}
$('#content').addEventListener('click', (e) => {
  if (view.t !== 'home') return;
  const sc = e.target.closest('[data-scene]'); if (sc) return call('scene:apply', sc.dataset.scene, { type: 'all' }).then((r) => toast(r.failed ? `${r.failed} light(s) did not respond` : 'Scene applied'));
  const qc = e.target.closest('[data-qc]'); if (qc) return applyTo({ type: 'all' }, { on: true, rgb: C.parseColor(qc.dataset.qc) }, 'Colour');
  const on = e.target.closest('[data-room-on]'), off = e.target.closest('[data-room-off]'), op = e.target.closest('[data-open-id]');
  if (on) return applyTo({ type: 'room', id: on.dataset.roomOn }, { on: true }, 'Room on');
  if (off) return applyTo({ type: 'room', id: off.dataset.roomOff }, { on: false }, 'Room off');
  if (op) { selected = op.dataset.openId; return renderDrawer(); }
  if (e.target.closest('[data-home="toggle"]')) { const any = S.devices.some((d) => d.on && d.online !== false); applyTo({ type: 'all' }, { on: !any }, any ? 'All off' : 'All on'); }
});
$('#content').addEventListener('input', (e) => { if (e.target.id === 'homeBri') masterBri({ type: 'all' }, +e.target.value); });

/* ---------- properties pane ---------- */
function renderDrawer() {
  const dr = $('#drawer'), d = dev(selected);
  if (!d) { dr.classList.add('hidden'); return; }
  dr.classList.remove('hidden');
  const off = d.online === false, one = { type: 'devices', ids: [d.id] };
  dr.innerHTML = `<h2>${ico('bulb')}<span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(d.name)} Properties</span><button class="btn ic" id="dClose" data-tip="Close (Esc)">✕</button></h2>
    <fieldset><legend>General</legend><div class="f"><label>Name</label><input type="text" id="dName" value="${esc(d.name)}" maxlength="60"></div>
      <div class="f"><label>Room</label><select id="dRoom"><option value="">No room</option>${S.rooms.map((r) => `<option value="${r.id}" ${d.room === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div></fieldset>
    <fieldset ${off ? 'disabled' : ''}><legend>Light</legend>
      <div class="row" style="margin-bottom:8px">${powerBtn(d.on && !off, 'id="dPower"', true)}<div><b>${off ? 'Offline' : d.on ? 'On' : 'Off'}</b><div class="muted">${esc(stateText(d))}${d.assumed ? ' · unconfirmed' : ''}</div></div></div>
      ${d.caps.dim ? `<div class="f"><label>Brightness</label><input type="range" min="1" max="100" value="${d.brightness || 100}" id="dBri"></div>` : ''}
      ${d.caps.color ? `<div class="f"><label>Colour</label><div class="swatches">${SWATCHES.map((h) => `<button class="sw" style="background:${h}" data-c="${h}"></button>`).join('')}<input type="color" id="dColor" value="${d.mode === 'color' && d.rgb ? C.hex(d.rgb) : '#ff0000'}" ${d.caps.dim ? `data-v="${(d.brightness || 100) / 100}"` : ''} data-tip="Any colour"></div></div>` : ''}
      ${d.caps.temp ? `<div class="f"><label>White temperature (${d.kelvinRange[0]}–${d.kelvinRange[1]} K)</label><input type="range" class="kelvin" min="${d.kelvinRange[0]}" max="${d.kelvinRange[1]}" step="50" value="${d.kelvin || 2700}" id="dK"></div>` : ''}
      ${!d.caps.color && !d.caps.temp && !d.caps.dim ? '<div class="muted">This device only switches on and off.</div>' : ''}</fieldset>
    ${d.brand === 'cync' ? `<fieldset><legend>What this bulb supports</legend>${['dim:Dimming', 'temp:White temperature', 'color:Colour'].map((x) => { const [k, l] = x.split(':'); return `<label class="chk"><input type="checkbox" data-cap="${k}" ${d.caps[k] ? 'checked' : ''}>${l}</label>`; }).join('')}<div class="muted small">Cync does not always report this. Untick what your bulb can't do.</div></fieldset>` : ''}
    <fieldset><legend>Status</legend><dl class="kv"><dt>Brand</dt><dd>${BRANDS[d.brand]} (${d.brand === 'wiz' ? 'local network' : d.brand === 'cync' ? 'cloud relay' : 'cloud'})</dd><dt>Supports</dt><dd>${[d.caps.dim && 'dimming', d.caps.color && 'colour', d.caps.temp && 'white temperature'].filter(Boolean).join(', ') || 'on / off only'}</dd>
      <dt>Connection</dt><dd><i class="led ${off ? 'bad' : 'ok'}"></i>${off ? 'Not reachable' : 'Reachable'}</dd><dt>Last seen</dt><dd>${ago(d.lastSeen)}</dd>${d.lastError ? `<dt>Last error</dt><dd data-tip="${esc(d.lastError.msg)}">${esc(d.lastError.msg)} (${ago(d.lastError.at)})</dd>` : ''}<dt>ID</dt><dd class="muted">${esc(d.id)}</dd></dl></fieldset>
    <button class="btn danger" id="dForget">Remove from Lumen</button>`;
  $('#dClose').onclick = () => { selected = null; renderDrawer(); renderContent(); };
  $('#dPower').onclick = () => applyTo(one, { on: !d.on }, d.on ? 'Off' : 'On');
  $('#dName').onchange = (e) => call('device:meta', d.id, { name: e.target.value.trim() });
  $('#dRoom').onchange = (e) => call('device:meta', d.id, { room: e.target.value });
  if ($('#dBri')) $('#dBri').oninput = throttle((e) => applyTo(one, { on: true, brightness: +e.target.value }, 'Brightness'), 140);
  dr.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => applyTo(one, { on: true, rgb: C.parseColor(b.dataset.c) }, 'Colour')));
  if ($('#dColor')) $('#dColor').oninput = throttle((e) => applyTo(one, e.detail ? { on: true, rgb: e.detail.rgb, ...(d.caps.dim ? { brightness: Math.max(1, Math.round(e.detail.v * 100)) } : {}) } : { on: true, rgb: C.parseColor(e.target.value) }, 'Colour'), 120);
  if ($('#dK')) $('#dK').oninput = throttle((e) => applyTo(one, { on: true, kelvin: +e.target.value }, 'White temperature'), 160);
  dr.querySelectorAll('[data-cap]').forEach((cb) => (cb.onchange = () => call('device:meta', d.id, { caps: { ...d.caps, [cb.dataset.cap]: cb.checked } })));
  $('#dForget').onclick = async () => { if (await confirmBox('Remove light', `Remove "${d.name}" from Lumen?`, 'Remove')) { selected = null; await call('device:forget', d.id); } };
}

/* ---------- render loop ---------- */
function renderContent() {
  const c = $('#content');
  if ((view.t === 'room' && !S.rooms.find((r) => r.id === view.id)) || (view.t === 'group' && !S.groups.find((g) => g.id === view.id))) view = { t: 'all' };
  const page = { home: renderHome, studio: renderStudio, viz: renderViz, proj: renderProj, show: renderShow, fx: renderFx, scenes: renderScenes, schedules: renderSchedules, settings: renderSettings }[view.t] || renderLights;
  if (c.dataset.page !== view.t + ':' + (view.id || '')) { c.dataset.page = view.t + ':' + (view.id || ''); c.innerHTML = ''; c.scrollTop = 0; }
  page(c);
}
function render() { applyTheme(S.settings.theme); renderMenubar(); renderNav(); renderToolbar(); renderContent(); renderDrawer(); renderStatus(); }
document.addEventListener('pointerdown', (e) => { if (e.target.matches('input[type=range],input[type=color]')) busyDrag = true; });
document.addEventListener('pointerup', () => { if (busyDrag) { busyDrag = false; if (pendingRender) { pendingRender = false; render(); } } });
window.lumen.onChanged((s) => {
  S = s;
  const a = document.activeElement, typing = a && a.matches('input[type=text],input[type=password],input[type=email],input[type=number],input[type=time],select,textarea');
  if (busyDrag || typing || $('#dlg').open || $('#popup')) { pendingRender = true; renderNav(); renderStatus(); return; }
  render();
});
// A change that arrived while a field had focus is shown as soon as the field is left.
document.addEventListener('focusout', () => setTimeout(() => { const a = document.activeElement; if (pendingRender && !busyDrag && !$('#dlg').open && !(a && a.matches('input[type=text],input[type=password],input[type=email],input[type=number],input[type=time],select,textarea'))) { pendingRender = false; render(); } }, 60));
(async () => { S = await call('state'); render(); setInterval(renderStatus, 30000); })();
