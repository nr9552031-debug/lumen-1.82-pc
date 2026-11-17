'use strict';
let tdStatus = { state: 'disconnected', tools: [], turns: [], pendingTool: null };
let tdModels = [];
let tdModelsLoaded = false;
if (window.lumen.onTouchDesigner) window.lumen.onTouchDesigner((s) => { tdStatus = s || tdStatus; if (view.t === 'touchdesigner') paintTouchDesigner($('#content')); });

function paintTouchDesigner(c) {
  if (!c) return;
  const connected = tdStatus.state === 'connected', busy = !!tdStatus.runId;
  const rows = tdStatus.turns || [];
  const statusLabel = { disconnected: 'Disconnected', connecting: 'Connecting…', authorizing: 'Waiting for TouchDesigner approval…', connected: 'Connected', error: 'Connection error' }[tdStatus.state] || tdStatus.state;
  const project = tdStatus.projectInfo || 'Connect to TouchDesigner to inspect the current project.';
  const pending = tdStatus.pendingTool;
  c.innerHTML = `<div class="panel"><div class="ph">TouchDesigner Studio<span class="sp"></span><i class="led ${connected ? 'ok' : tdStatus.state === 'error' ? 'bad' : 'warn'}"></i><b>${esc(statusLabel)}</b></div><div class="pb">
    <div class="row"><label for="tdUrl">TDMCP endpoint</label><input id="tdUrl" style="width:320px" value="${esc(tdStatus.url || 'http://127.0.0.1:13316/mcp')}" spellcheck="false"><button class="btn pri" id="tdConnect">Connect / reconnect</button><button class="btn" id="tdDisconnect" ${!connected && tdStatus.state !== 'authorizing' && tdStatus.state !== 'connecting' ? 'disabled' : ''}>Disconnect</button></div>
    <p class="muted">Install the official TDMCP.tox in TouchDesigner and enable its local MCP server. Default: 127.0.0.1:13316. TDMCP authentication stays enabled; approve Lumen in TouchDesigner when prompted.</p>
    ${tdStatus.error ? `<div class="note err">${esc(tdStatus.error)}</div>` : ''}<div class="f"><label>Current TouchDesigner project</label><pre class="td-project">${esc(project)}</pre></div>
  </div></div>
  <div class="panel"><div class="ph">Make an animation</div><div class="pb"><p class="muted">Describe the finished result in ordinary words. Lumen inspects the open project, builds a playable scene, and checks a preview when TouchDesigner provides one. Connected means it is ready; nothing changes until you press Make animation.</p><p class="muted">Detailed characters may need a model or rig already in the project. If one is missing, Lumen will say so and make a clearly stylized version instead of pretending it created a realistic character.</p><div class="row"><label for="tdModel">Local Ollama model</label><select id="tdModel"><option value="">${tdModels.length ? 'Choose model…' : 'Ollama unavailable — refresh model list'}</option>${tdModels.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')}</select><button class="btn" id="tdModels">Refresh models</button><span class="sp"></span><button class="btn" id="tdStop" ${!busy ? 'disabled' : ''}>Stop generation</button></div>
    <textarea id="tdPrompt" rows="4" maxlength="12000" placeholder="Example: Make a 10-second cartoon monkey swim through blue water, with a clear side view and a smooth looping stroke." style="width:100%;resize:vertical;margin:8px 0" ${!connected || busy ? 'disabled' : ''}></textarea><div class="row"><span class="muted">Runs locally through Ollama. Lumen never saves the TouchDesigner project automatically.</span><span class="sp"></span><button class="btn pri" id="tdRun" ${!connected || busy ? 'disabled' : ''}>Make animation</button></div>
    ${pending ? `<div class="note warn" style="margin-top:10px"><b>${pending.destructive ? 'Separate approval needed' : 'Lumen is ready to change the scene'}</b><p>${esc(pending.description || 'This operation will make a change in the open TouchDesigner project.')}</p>${pending.destructive ? '<p>This action is outside routine scene edits and may run code, delete, save, or access files. Review it before allowing.</p>' : '<p>The project stays unsaved unless you separately approve a save.</p>'}<details><summary>Technical details</summary><p>${esc(pending.name)}</p><pre class="td-project">${esc(JSON.stringify(pending.args, null, 2))}</pre></details><div class="row"><button class="btn pri" id="tdApprove">Approve this change</button>${pending.allowRoutine ? '<button class="btn" id="tdApproveRun">Approve routine scene edits for this animation</button>' : ''}<button class="btn" id="tdReject">Decline</button></div>${pending.allowRoutine ? '<p class="small muted">Run approval covers only routine operator creation, wiring, and parameter edits in this animation. Code, deletion, saving, and file actions still ask separately.</p>' : ''}</div>` : ''}
  </div></div>
  <div class="panel"><div class="ph">TDMCP tools <span class="muted" style="font-weight:normal">${tdStatus.tools.length} discovered</span></div><div class="pb"><div class="td-tools">${tdStatus.tools.map((t) => `<details><summary><b>${esc(t.name)}</b> <span class="muted">${t.readOnly ? 'read only' : t.destructive ? 'high risk · approval required' : 'changes network · approval required'}</span></summary><p>${esc(t.description || '')}</p><pre>${esc(JSON.stringify(t.inputSchema || {}, null, 2))}</pre></details>`).join('') || 'No tools discovered yet.'}</div></div></div>
  <div class="panel"><div class="ph">Build progress & tool log</div><div class="pb"><div class="td-log">${rows.map((r) => `<div class="td-log-row"><span class="muted">${esc(new Date(r.time).toLocaleTimeString())}</span><b>${esc(r.type)}</b><span>${esc(r.text)}</span>${r.arguments ? `<details><summary>Arguments</summary><pre>${esc(JSON.stringify(r.arguments, null, 2))}</pre></details>` : ''}${r.result ? `<details><summary>Result</summary><pre>${esc(r.result)}</pre></details>` : ''}${(r.images || []).map((im) => `<img class="td-preview" alt="TouchDesigner output" src="data:${esc(im.mimeType)};base64,${im.data}">`).join('')}</div>`).join('') || 'No activity yet.'}</div></div></div>`;
  $('#tdUrl', c).onchange = (e) => { tdStatus.url = e.target.value; };
  $('#tdConnect', c).onclick = async () => { try { await call('td:config', { url: $('#tdUrl', c).value }); await call('td:connect'); } catch {} };
  $('#tdDisconnect', c).onclick = () => call('td:disconnect').catch(() => {});
  $('#tdModels', c).onclick = async () => { try { tdModels = await call('td:models'); tdModelsLoaded = true; paintTouchDesigner(c); } catch (e) { tdModelsLoaded = true; toast(e.message, true); } };
  $('#tdRun', c).onclick = async () => { const prompt = $('#tdPrompt', c).value.trim(), model = $('#tdModel', c).value; if (!prompt) return toast('Describe the visual you want to create.', true); try { await call('td:config', { url: $('#tdUrl', c).value, ollamaModel: model }); call('td:run', prompt, model).catch(() => {}); } catch {} };
  $('#tdStop', c).onclick = () => call('td:stop').catch(() => {});
  $('#tdApprove', c) && ($('#tdApprove', c).onclick = () => call('td:approve', pending.runId, true));
  $('#tdApproveRun', c) && ($('#tdApproveRun', c).onclick = () => call('td:approve', pending.runId, true, true));
  $('#tdReject', c) && ($('#tdReject', c).onclick = () => call('td:approve', pending.runId, false));
  if (tdStatus.ollamaModel) $('#tdModel', c).value = tdStatus.ollamaModel;
  else if (tdModels.length === 1) $('#tdModel', c).value = tdModels[0].name;
  if (!tdModelsLoaded) { tdModelsLoaded = true; call('td:models').then((m) => { tdModels = m; paintTouchDesigner(c); }).catch((e) => toast(e.message, true)); }
}

async function renderTouchDesigner(c) { try { tdStatus = await call('td:status'); } catch {} paintTouchDesigner(c); }
