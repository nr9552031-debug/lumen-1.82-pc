'use strict';
/* Scenes, Schedules and the Control Panel. */
let sceneScope = 'all';
const SCENE_ICONS = ['✨', '🌆', '🌙', '☀️', '🎬', '🎮', '📖', '🛋️', '🍽️', '🎉', '💤', '🌊', '🔥', '🌿', '💼', '❤️'];

/* ---------- scenes ---------- */
function renderScenes(c) {
  const group = (title, list) => list.length ? `<div class="sect">${title}</div><div class="shortcuts">${list.map((s) => `<button class="shortcut" data-scene="${esc(s.id)}" data-tip="Click to apply · right-click for more">${s.fav ? '<span class="fav">★</span>' : ''}<div class="big">${esc(s.icon)}</div><span class="cap">${esc(s.name)}</span></button>`).join('')}</div>` : '';
  c.innerHTML = `<div class="panel"><div class="ph">${ico('scene')}Scenes<span class="sp"></span><span style="font-weight:normal">Apply to</span><select id="scScope">${scopeOptions(sceneScope)}</select><button class="btn pri" id="scNew">New scene…</button></div>
    <div class="pb">${group('Favourites', S.scenes.filter((s) => s.fav))}${group('Built-in', S.scenes.filter((s) => s.builtin && !s.fav))}${group('My scenes', S.scenes.filter((s) => !s.builtin && !s.fav))}
    <p class="muted" style="margin-top:10px">A scene of your own remembers each light's power, brightness and colour. Built-in scenes set every light in the chosen target the same way.</p></div></div>`;
  $('#scScope').onchange = (e) => { sceneScope = e.target.value; };
  $('#scNew').onclick = newScene;
  c.onclick = (e) => { const b = e.target.closest('[data-scene]'); if (b) applyScene(b.dataset.scene); };
  c.oncontextmenu = (e) => {
    const b = e.target.closest('[data-scene]'); if (!b) return; e.preventDefault();
    const s = S.scenes.find((x) => x.id === b.dataset.scene); if (!s) return;
    popup([{ label: `Apply to ${scopeLabel(parseScope(sceneScope))}`, run: () => applyScene(s.id) }, { label: s.fav ? 'Remove from favourites' : 'Add to favourites', run: () => call('scene:update', s.id, { fav: !s.fav }) }, { label: 'Duplicate', run: () => call('scene:duplicate', s.id) }, '-',
      { label: 'Rename…', disabled: s.builtin, run: async () => { const v = await ask('Rename scene', s.name); if (v) call('scene:update', s.id, { name: v }); } },
      { label: 'Change icon…', disabled: s.builtin, run: async () => { const v = await pickIcon(s.icon); if (v) call('scene:update', s.id, { icon: v }); } },
      { label: 'Update from current lights', disabled: s.builtin, run: () => call('scene:recapture', s.id, { type: 'all' }).then(() => toast(`"${s.name}" now matches the lights`)) },
      { label: 'Delete', disabled: s.builtin, run: async () => { if (await confirmBox('Delete scene', `Delete the scene "${s.name}"?`, 'Delete')) call('scene:delete', s.id); } }], e.clientX, e.clientY);
  };
}
const applyScene = (id) => call('scene:apply', id, parseScope(sceneScope)).then((r) => toast(r.failed ? `${r.failed} light(s) did not respond` : `Scene applied to ${r.ok} light(s)`));
const iconGrid = (cur) => `<div class="swatches" id="icGrid">${SCENE_ICONS.map((i) => `<button type="button" class="btn ic ${i === cur ? 'down' : ''}" data-ic="${i}" style="font-size:18px;min-width:34px">${i}</button>`).join('')}</div>`;
const wireIcons = (d) => { $('#icGrid', d).onclick = (e) => { const b = e.target.closest('[data-ic]'); if (!b) return; $$('[data-ic]', d).forEach((x) => x.classList.toggle('down', x === b)); }; };
const pickedIcon = (d) => { const b = $('[data-ic].down', d); return b ? b.dataset.ic : '✨'; };
const pickIcon = (cur) => dialogBox('Choose an icon', iconGrid(cur), [{ label: 'OK', pri: true, value: pickedIcon }, { label: 'Cancel', value: null }], wireIcons);
async function newScene() {
  const r = await dialogBox('New scene', `<p style="margin-bottom:8px">Saves what the lights are doing right now.</p><div class="f"><label>Name</label><input type="text" id="nsName" style="width:320px" maxlength="60" placeholder="Evening"></div>
    <div class="f"><label>Lights to remember</label><select id="nsScope" style="width:320px">${scopeOptions(sceneScope)}</select></div><div class="f"><label>Icon</label>${iconGrid('✨')}</div>`,
    [{ label: 'Save', pri: true, value: (d) => ({ name: $('#nsName', d).value.trim(), scope: parseScope($('#nsScope', d).value), icon: pickedIcon(d) }) }, { label: 'Cancel', value: null }], wireIcons);
  if (r && r.name) { await call('scene:save', r.name, r.icon, r.scope); toast(`Saved scene "${r.name}"`); }
}

/* ---------- schedules ---------- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = (d) => d.length === 7 ? 'Every day' : String(d.slice().sort()) === '1,2,3,4,5' ? 'Weekdays' : String(d.slice().sort()) === '0,6' ? 'Weekends' : d.slice().sort().map((x) => DAYS[x]).join(' ');
function actionText(a) {
  const where = scopeLabel(a.scope || { type: 'all' });
  if (a.type === 'scene') return `Scene "${(S.scenes.find((s) => s.id === a.sceneId) || {}).name || 'missing'}" on ${where}`;
  if (a.type === 'on' || a.type === 'off') return `Turn ${a.type} ${where}`;
  if (a.type === 'effect') return `Start ${a.mode} effect on ${where}`;
  if (a.type === 'stopEffect') return 'Stop the running effect';
  const l = S.layouts.find((x) => x.id === a.layoutId); return `Arrangement "${((l && l.arrangements.find((x) => x.id === a.arrId)) || {}).name || 'missing'}" (${l ? l.name : 'missing room'})`;
}
function renderSchedules(c) {
  c.innerHTML = `<div class="panel"><div class="ph">${ico('clock')}Schedules<span class="sp"></span><button class="btn pri" id="schNew">New schedule…</button></div><div class="pb">
    <div class="note"><i class="led warn"></i><span>Schedules run while Lumen is open. Turn on <a data-go="settings">Start with Windows</a> and <i>Keep running in the notification area</i> so they keep working. A time that passes while Lumen is closed is skipped.</span></div>
    ${S.schedules.length ? `<div class="lvwrap"><table class="lv"><thead><tr><th>On</th><th>Name</th><th>Time</th><th>Days</th><th>Does</th><th>Last run</th><th></th></tr></thead><tbody>${S.schedules.slice().sort((a, b) => a.time.localeCompare(b.time)).map((s) => `<tr data-sch="${esc(s.id)}">
      <td><input type="checkbox" data-en ${s.enabled ? 'checked' : ''}></td><td><b>${esc(s.name)}</b></td><td>${esc(s.time)}</td><td>${daysText(s.days)}</td><td>${esc(actionText(s.action))}</td><td>${esc(s.lastRun || 'never')}</td>
      <td><button class="btn" data-run>Run now</button> <button class="btn" data-edit>Edit…</button> <button class="btn danger" data-del>Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No schedules yet. Use one to switch lights at a set time, start an ambient effect, or apply a scene.</div>'}
    <div class="row" style="margin-top:10px"><span class="muted">${S.sleep ? `Sleep timer: lights turn off in ${Math.max(1, Math.round((S.sleep.at - Date.now()) / 60000))} min.` : 'Need a one-off? Use the sleep timer.'}</span><button class="btn" id="schSleep">${S.sleep ? 'Cancel sleep timer' : 'Sleep timer…'}</button></div></div></div>`;
  $('#schNew').onclick = () => editSchedule({ name: '', time: '07:00', days: [1, 2, 3, 4, 5], enabled: true, action: { type: 'scene', scope: { type: 'all' } } });
  $('#schSleep').onclick = sleepTimer;
  c.onclick = (e) => {
    const tr = e.target.closest('[data-sch]'); if (!tr) return; const s = S.schedules.find((x) => x.id === tr.dataset.sch); if (!s) return;
    if (e.target.matches('[data-en]')) call('schedule:save', { ...s, enabled: e.target.checked });
    else if (e.target.matches('[data-run]')) call('schedule:run', s.id).then(() => toast(`Ran "${s.name}"`));
    else if (e.target.matches('[data-edit]')) editSchedule(s);
    else if (e.target.matches('[data-del]')) confirmBox('Delete schedule', `Delete "${s.name}"?`, 'Delete').then((y) => y && call('schedule:delete', s.id));
  };
}
async function editSchedule(s) {
  const a = s.action, sc = a.scope || { type: 'all' }, scv = sc.type === 'all' ? 'all' : `${sc.type}:${sc.id}`;
  const amb = (fx.st ? fx.st.modes : []).filter((m) => !m.audio), arrs = S.layouts.flatMap((l) => l.arrangements.map((x) => ({ v: `${l.id}|${x.id}`, n: `${l.name}: ${x.name}` })));
  const r = await dialogBox(s.id ? 'Edit schedule' : 'New schedule', `<div class="kvgrid" style="grid-template-columns:auto 1fr;min-width:400px">
    <label>Name</label><input type="text" id="sdName" value="${esc(s.name)}" maxlength="60" placeholder="Morning lights">
    <label>Time</label><input type="time" id="sdTime" value="${esc(s.time)}" style="width:110px">
    <label>Days</label><div class="row wrap">${DAYS.map((d, i) => `<label class="chk"><input type="checkbox" data-day="${i}" ${s.days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
    <label>Do this</label><select id="sdType">${[['scene', 'Apply a scene'], ['on', 'Turn lights on'], ['off', 'Turn lights off'], ['effect', 'Start an ambient effect'], ['stopEffect', 'Stop the running effect'], ['arrangement', 'Apply a room arrangement']].map(([v, l]) => `<option value="${v}" ${a.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label data-for="scene">Scene</label><select id="sdScene" data-for="scene">${S.scenes.map((x) => `<option value="${esc(x.id)}" ${a.sceneId === x.id ? 'selected' : ''}>${esc(x.icon + ' ' + x.name)}</option>`).join('')}</select>
    <label data-for="effect">Effect</label><select id="sdMode" data-for="effect">${amb.map((m) => `<option value="${m.id}" ${a.mode === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <label data-for="arrangement">Arrangement</label><select id="sdArr" data-for="arrangement">${arrs.map((x) => `<option value="${esc(x.v)}" ${`${a.layoutId}|${a.arrId}` === x.v ? 'selected' : ''}>${esc(x.n)}</option>`).join('') || '<option value="">(save one in the Room Visualizer first)</option>'}</select>
    <label data-for="scene on off effect">Lights</label><select id="sdScope" data-for="scene on off effect">${scopeOptions(scv)}</select></div>`,
    [{ label: 'Save', pri: true, value: (d) => { const [layoutId, arrId] = ($('#sdArr', d).value || '|').split('|'); return { id: s.id, lastRun: s.lastRun, enabled: s.enabled, name: $('#sdName', d).value, time: $('#sdTime', d).value, days: $$('[data-day]:checked', d).map((x) => +x.dataset.day),
      action: { type: $('#sdType', d).value, sceneId: $('#sdScene', d).value, mode: $('#sdMode', d).value, layoutId, arrId, scope: parseScope($('#sdScope', d).value) } }; } }, { label: 'Cancel', value: null }],
    (d) => { const sync = () => { const t = $('#sdType', d).value; $$('[data-for]', d).forEach((el) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(t))); }; $('#sdType', d).onchange = sync; sync(); });
  if (r) await call('schedule:save', r);
}

/* ---------- control panel ---------- */
let cpTab = 'appearance';
const needCode = { hubspace: false, cync: false };
const signErr = { hubspace: '', cync: '' }; // last sign-in failure, kept on screen until the next attempt
const CP = [['appearance', 'Appearance', 'scene'], ['accounts', 'Accounts and lights', 'bulb'], ['startup', 'Startup and behaviour', 'cp'], ['backup', 'Backup and restore', 'group'], ['diag', 'Diagnostics', 'search'], ['about', 'About', 'home']];
function renderSettings(c) {
  const st = S.settings, su = st.startup || {}, n = (b) => S.devices.filter((d) => d.brand === b).length;
  const pill = (ok) => `<span class="right" style="font-weight:normal"><i class="led ${ok ? 'ok' : ''}"></i>${ok ? 'Connected' : 'Not connected'}</span>`;
  const err = (b) => [signErr[b], S.errors[b]].filter(Boolean).map((m) => `<div class="note err"><i class="led bad"></i><span>${esc(m)}</span></div>`).join('');
  const chk = (id, on, label, tip) => `<label class="chk" ${tip ? `data-tip="${esc(tip)}"` : ''}><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>${label}</label>`;
  const pages = {
    appearance: () => `<fieldset><legend>Theme</legend><div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${Object.keys(THEMES).map((k) => `<label class="chk" style="align-items:flex-start"><input type="radio" name="theme" value="${k}" ${(st.theme || 'aero') === k ? 'checked' : ''}><span><b>${THEMES[k]}</b><br><span class="muted">${k === 'aero' ? 'Blue glass, soft glossy controls' : k === 'xp-blue' ? 'The classic Luna blue' : k === 'xp-silver' ? 'Luna in brushed silver' : 'Luna in olive green'}</span></span></label>`).join('')}</div></fieldset>
      <fieldset><legend>Lights list</legend><label class="chk"><input type="radio" name="vm" value="tiles" ${(st.viewMode || 'tiles') === 'tiles' ? 'checked' : ''}>Tiles with brightness sliders</label><label class="chk"><input type="radio" name="vm" value="details" ${st.viewMode === 'details' ? 'checked' : ''}>Details list with sortable columns</label></fieldset>
      <fieldset><legend>Notifications</legend>${chk('cpToasts', st.toasts !== false, 'Show balloon messages for completed actions', 'Errors are always shown')}</fieldset>`,
    accounts: () => `<div class="panel"><div class="ph">WiZ<span class="right" style="font-weight:normal"><i class="led ok"></i>Local, no account</span></div><div class="pb"><p style="margin-bottom:8px">Found automatically over your Wi-Fi and controlled directly, without any cloud. ${n('wiz')} found. Bulbs must be set up in the WiZ app first and on the same network as this PC.</p>${err('wiz')}
        <div class="row"><input type="text" id="wizIp" placeholder="Not found? Enter the bulb's IP, e.g. 192.168.1.42" style="flex:1"><button class="btn" id="wizAdd">Add</button></div></div></div>
      <div class="panel"><div class="ph">Hubspace (Home Depot)${pill(S.accounts.hubspace)}</div><div class="pb"><p style="margin-bottom:8px">Hubspace has no local interface, so control goes through its cloud and is slower than WiZ. Your password is used once to sign in; only an encrypted sign-in token is kept on this PC. ${n('hubspace')} found.</p>${err('hubspace')}
        ${S.accounts.hubspace ? `<button class="btn danger" id="hsOut">Disconnect</button>` : `<div class="row wrap"><input type="email" id="hsEmail" placeholder="Hubspace email" value="${esc(st.hubspaceEmail || '')}" style="flex:1;min-width:160px"><input type="password" id="hsPw" placeholder="Password" style="flex:1;min-width:120px"><button class="btn pri" id="hsIn">Connect</button></div>
          <div class="row" style="margin-top:6px;${needCode.hubspace ? '' : 'display:none'}"><span>Code from the email:</span><input type="text" id="hsCode" style="width:110px" inputmode="numeric"><button class="btn" id="hsCodeBtn">Verify</button></div>`}</div></div>
      <div class="panel"><div class="ph">GE Cync${pill(S.accounts.cync)}</div><div class="pb"><p style="margin-bottom:8px">Cync is controlled through its cloud relay. Lumen waits for the relay to acknowledge each command; anything it could not confirm is marked "unconfirmed". ${n('cync')} found. Close the Cync phone app if lights stop responding (Cync allows one session per account).</p>${err('cync')}
        ${S.accounts.cync ? `<button class="btn danger" id="cyOut">Disconnect</button>` : `<div class="row wrap"><input type="email" id="cyEmail" placeholder="Cync email" value="${esc(st.cyncEmail || '')}" style="flex:1;min-width:160px"><input type="password" id="cyPw" placeholder="Password" style="flex:1;min-width:120px"><button class="btn pri" id="cyIn">Connect</button></div>
          <div class="row" style="margin-top:6px;${needCode.cync ? '' : 'display:none'}"><span>Code from the newest email:</span><input type="text" id="cyCode" style="width:110px" inputmode="numeric"><button class="btn" id="cyCodeBtn">Verify</button></div>`}
        <div style="margin-top:8px">${chk('cyTls', st.cyncAllowUnverifiedTls, "Trust the Cync relay's certificate", 'Cync\'s relay server (cm-sec.gelighting.com) uses an expired certificate, so normal checks always fail and Cync lights cannot be controlled without this. When ticked, Lumen records that exact certificate the first time and refuses any different one afterwards. Untick to forget it.')}</div></div></div>`,
    startup: () => `<fieldset><legend>When Windows starts</legend>${chk('suLogin', su.launchAtLogin, 'Start Lumen with Windows')}${chk('suMin', su.startMinimized, 'Start in the notification area, without opening the window')}</fieldset>
      <fieldset><legend>When Lumen runs</legend>${chk('suTray', su.closeToTray, 'Keep running in the notification area when the window is closed', 'Needed for schedules to run with the window closed. Use Exit in the tray menu or File menu to quit.')}${chk('suScan', su.scanOnStart !== false, 'Look for lights when Lumen opens')}</fieldset>
      <fieldset><legend>Switching a light on</legend>${chk('doOn', (st.defaultOn || {}).enabled, 'Use this brightness and warmth whenever a light is simply switched on')}
        <div class="kvgrid" style="margin-top:6px"><label>Brightness</label><input type="range" id="doBri" min="1" max="100" value="${(st.defaultOn || {}).brightness || 80}"><span id="doBriV">${(st.defaultOn || {}).brightness || 80}%</span><label>Warmth</label><input type="range" class="kelvin" id="doK" min="2200" max="6500" step="50" value="${(st.defaultOn || {}).kelvin || 2700}"><span id="doKV">${(st.defaultOn || {}).kelvin || 2700} K</span></div></fieldset>`,
    backup: () => `<fieldset><legend>Backup</legend><p style="margin-bottom:8px">Saves your rooms, groups, scenes, room layouts, schedules, favourites and light names to a file. Passwords, sign-in tokens and account emails are never included.</p><button class="btn" id="bkOut">Export backup…</button></fieldset>
      <fieldset><legend>Restore</legend><p style="margin-bottom:8px">Replaces rooms, groups, scenes, layouts and schedules with those in a backup file.</p><button class="btn" id="bkIn">Import backup…</button></fieldset>`,
    diag: () => `<div class="row" style="margin-bottom:6px"><span class="sp">What each service actually answered. Passwords, emails and sign-in tokens are never recorded.</span><button class="btn" id="dgRefresh">Refresh</button><button class="btn pri" id="dgCopy">Copy</button></div>
      <fieldset><legend>Lights</legend><div class="lvwrap" style="max-height:170px"><table class="lv"><thead><tr><th>Light</th><th>Brand</th><th>Reachable</th><th>Last seen</th><th>Last error</th></tr></thead><tbody>${S.devices.map((d) => `<tr><td>${esc(d.name)}</td><td>${BRANDS[d.brand]}</td><td><i class="led ${d.online === false ? 'bad' : 'ok'}"></i>${d.online === false ? 'No' : 'Yes'}</td><td>${ago(d.lastSeen)}</td><td>${d.lastError ? esc(d.lastError.msg) + ' (' + ago(d.lastError.at) + ')' : '—'}</td></tr>`).join('')}</tbody></table></div></fieldset>
      <pre id="dgBox" style="height:230px;overflow:auto;white-space:pre-wrap;background:#fff;border:1px solid var(--field-border);padding:6px;margin:0;user-select:text;font:11px Consolas,monospace"></pre>`,
    about: () => `<div class="row" style="gap:14px;align-items:flex-start">${ico('bulb', 'xl')}<div><h3 style="font-size:15px">Lumen <span id="abVer"></span></h3><p class="muted" id="abRt"></p><p style="margin-top:8px;max-width:520px">One control centre for WiZ, Hubspace and GE Cync lights. Not affiliated with those brands or with Microsoft; the interface is a tribute to the Windows XP and Windows 7 era.</p><p class="muted" id="abLog" style="margin-top:8px"></p></div></div>`,
  };
  // The page is re-drawn whenever any light changes state. Keep what was typed in the sign-in boxes (emails,
  // passwords, emailed codes) and where the cursor was; losing them sent empty passwords/codes to Cync before.
  const FORM = ['hsEmail', 'hsPw', 'hsCode', 'cyEmail', 'cyPw', 'cyCode', 'wizIp'], typed = {}, act = document.activeElement && document.activeElement.id;
  for (const id of FORM) { const el = $('#' + id); if (el && el.value) typed[id] = el.value; }
  c.innerHTML = `<div style="display:grid;grid-template-columns:190px 1fr;gap:12px;align-items:start"><div class="panel" style="margin:0"><div class="ph">Pick a category</div><div class="pb" style="padding:6px">${CP.map(([k, l, i]) => `<button class="nav-i ${cpTab === k ? 'on' : ''}" data-cp="${k}" style="padding:5px 6px">${ico(i, 'lg')}<span class="t">${l}</span></button>`).join('')}</div></div>
    <div class="panel" style="margin:0"><div class="ph">${CP.find((x) => x[0] === cpTab)[1]}</div><div class="pb" id="cpBody">${pages[cpTab]()}</div></div></div>`;
  for (const id of FORM) { const el = $('#' + id); if (el && typed[id] !== undefined) el.value = typed[id]; }
  if (act && FORM.includes(act) && $('#' + act)) $('#' + act).focus();
  const b = (id, fn, ev = 'onclick') => { const el = $('#' + id); if (el) el[ev] = fn; };
  c.onclick = (e) => { const t = e.target.closest('[data-cp]'); if (t) { cpTab = t.dataset.cp; renderSettings(c); } };
  $$('input[name=theme]', c).forEach((r) => (r.onchange = () => setTheme(r.value).then(render)));
  $$('input[name=vm]', c).forEach((r) => (r.onchange = () => setViewMode(r.value)));
  b('cpToasts', (e) => call('settings:set', { toasts: e.target.checked }), 'onchange');
  for (const [id, key] of [['suLogin', 'launchAtLogin'], ['suMin', 'startMinimized'], ['suTray', 'closeToTray'], ['suScan', 'scanOnStart']]) b(id, (e) => call('settings:set', { startup: { [key]: e.target.checked } }), 'onchange');
  const saveDef = debounce(() => call('settings:set', { defaultOn: { enabled: $('#doOn').checked, brightness: +$('#doBri').value, kelvin: +$('#doK').value } }), 250);
  b('doOn', saveDef, 'onchange'); b('doBri', (e) => { $('#doBriV').textContent = e.target.value + '%'; saveDef(); }, 'oninput'); b('doK', (e) => { $('#doKV').textContent = e.target.value + ' K'; saveDef(); }, 'oninput');
  b('bkOut', exportBackup); b('bkIn', importBackup);
  const loadDiag = () => window.lumen.call('diag').then((r) => { const el = $('#dgBox'); if (el && r.ok) el.textContent = r.data; });
  if (cpTab === 'diag') loadDiag();
  b('dgRefresh', loadDiag); b('dgCopy', async () => { await call('diag:copy'); toast('Diagnostics copied to the clipboard', true); });
  if (cpTab === 'about') call('app:info').then((i) => { if ($('#abVer')) { $('#abVer').textContent = i.version; $('#abRt').textContent = i.runtime || ''; $('#abLog').textContent = i.logFile ? `Diagnostics file: ${i.logFile}` : ''; } });
  // accounts
  b('wizAdd', async () => { const name = await call('wiz:addIp', $('#wizIp').value); toast(`Added ${name}`); });
  b('cyTls', async (e) => { if (e.target.checked && !await confirmBox('Unverified certificate', 'Cync\'s relay certificate expired years ago, so Windows cannot verify it. Lumen will remember the certificate it sees now and refuse to connect if it ever changes. Do this on your own home network, not public Wi-Fi. Trust it?', 'Trust')) { e.target.checked = false; return; } call('settings:set', { cyncAllowUnverifiedTls: e.target.checked }); }, 'onchange');
  const attempt = async (brand, btn, fn) => {
    signErr[brand] = ''; if (btn) btn.disabled = true;
    try { await fn(); } catch (x) { signErr[brand] = x.message; }
    finally { // re-render so the result shows, but keep what was typed so a failed attempt doesn't wipe the form
      const ids = ['hsEmail', 'hsPw', 'cyEmail', 'cyPw', 'hsCode', 'cyCode'], keep = {};
      for (const id of ids) { const el = $('#' + id); if (el) keep[id] = el.value; }
      if (view.t === 'settings') renderSettings($('#content'));
      for (const id of ids) { const el = $('#' + id); if (el && keep[id]) el.value = keep[id]; }
      const code = $(brand === 'hubspace' ? '#hsCode' : '#cyCode'); if (code && needCode[brand]) code.focus();
    }
  };
  const connect = (brand, pre, label) => (e) => attempt(brand, e.target, async () => {
    if (!$(`#${pre}Email`).value.trim() || !$(`#${pre}Pw`).value) throw new Error(`Enter your ${label} email and password.`);
    if (needCode[brand] && !await confirmBox(`Send a new ${label} code?`, `A code was already emailed. Connecting again sends a NEW code and the old one stops working. To use the code you have, type it in the box and click Verify instead.`, 'Send new code')) return;
    const r = await call(`${brand}:connect`, $(`#${pre}Email`).value, $(`#${pre}Pw`).value);
    if (r && r.needs2fa) { needCode[brand] = true; toast(`Check your email for the ${label} code`, true); } else { needCode[brand] = false; toast(`${label} connected`, true); }
  });
  b('hsIn', connect('hubspace', 'hs', 'Hubspace')); b('cyIn', connect('cync', 'cy', 'Cync'));
  b('hsCodeBtn', (e) => attempt('hubspace', e.target, async () => { await call('hubspace:2fa', $('#hsCode').value); needCode.hubspace = false; toast('Hubspace connected', true); }));
  b('cyCodeBtn', (e) => attempt('cync', e.target, async () => { const v = $('#cyCode').value.replace(/\s/g, ''); if (!/^[0-9A-Za-z]{4,10}$/.test(v)) throw new Error('Type the code from the newest Cync email (usually 6 digits), then click Verify.'); await call('cync:2fa', v); needCode.cync = false; toast('Cync connected', true); }));
  for (const [f, btn] of [['cyCode', 'cyCodeBtn'], ['hsCode', 'hsCodeBtn'], ['cyPw', 'cyIn'], ['hsPw', 'hsIn']]) b(f, (e) => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); const x = $('#' + btn); if (x && !x.disabled) x.click(); } }, 'onkeydown');
  b('hsOut', async () => { if (await confirmBox('Disconnect Hubspace', 'Sign out of Hubspace and remove its lights from Lumen?', 'Disconnect')) { needCode.hubspace = false; call('hubspace:disconnect'); } });
  b('cyOut', async () => { if (await confirmBox('Disconnect Cync', 'Sign out of Cync and remove its lights from Lumen?', 'Disconnect')) { needCode.cync = false; call('cync:disconnect'); } });
}
