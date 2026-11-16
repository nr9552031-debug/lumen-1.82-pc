'use strict';
const { EventEmitter } = require('events');
const http = require('http');
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const DEFAULT_TD_URL = 'http://127.0.0.1:13316/mcp';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const OAUTH_CALLBACK_PORT = 43829;
const READ_ONLY = new Set(['project_info', 'list_operators', 'search_operators', 'get_operator_info', 'get_connections', 'get_help', 'get_docs', 'get_parameters', 'get_dat_content', 'get_errors', 'inspect_values', 'view_operator', 'get_cook_performance']);
const DESTRUCTIVE = new Set(['delete_operator', 'execute_code']);

function safeEndpoint(value) {
  const u = new URL(String(value || DEFAULT_TD_URL));
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) throw new Error('Enter an http(s) TDMCP URL without credentials or a fragment');
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1' || /^127\./.test(u.hostname);
  if (!loopback && u.protocol !== 'https:') throw new Error('Remote TDMCP connections require HTTPS');
  return u;
}
const toolName = (name) => 'td_' + String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
const toToolOutput = (result) => {
  const parts = [];
  const images = [];
  for (const item of (result && result.content) || []) {
    if (item.type === 'text') parts.push(item.text);
    else if (item.type === 'image') {
      parts.push(`[Image result: ${item.mimeType || 'image'} returned by TouchDesigner]`);
      if (/^image\/(png|jpeg|webp)$/.test(item.mimeType || '') && typeof item.data === 'string' && item.data.length <= 1500000) images.push({ mimeType: item.mimeType, data: item.data });
    }
    else parts.push(`[${item.type} result returned by TouchDesigner]`);
  }
  if (result && result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return { text: (parts.join('\n') || JSON.stringify(result || {})).slice(0, 24000), images: images.slice(0, 2) };
};

class TouchDesigner extends EventEmitter {
  constructor({ store, openExternal, version = '1.8.2' }) {
    super(); this.store = store; this.openExternal = openExternal; this.version = version;
    this.client = null; this.transport = null; this.tools = []; this.state = 'disconnected'; this.error = null;
    this.callbackServer = null; this.callback = null; this.cancelled = false; this.activeRun = null; this.pendingTool = null; this.turns = []; this.chatHistory = []; this.projectInfo = null;
  }
  config() { const c = this.store.data.settings.touchDesigner || {}; return { url: c.url || DEFAULT_TD_URL, ollamaModel: c.ollamaModel || '' }; }
  snapshot() { const p = this.pendingTool; return { state: this.state, error: this.error, url: this.config().url, ollamaModel: this.config().ollamaModel, projectInfo: this.projectInfo, tools: this.tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations, readOnly: !!(annotations && annotations.readOnlyHint) || READ_ONLY.has(name), destructive: DESTRUCTIVE.has(name) })), runId: this.activeRun, pendingTool: p ? { id: p.id, runId: p.runId, name: p.name, args: p.args, destructive: DESTRUCTIVE.has(p.name) } : null, turns: this.turns.slice(-60) }; }
  publish() { this.emit('status', this.snapshot()); }
  log(type, text, extra = {}) {
    this.turns.push({ time: new Date().toISOString(), type, text: String(text).slice(0, 3000), ...extra }); this.turns = this.turns.slice(-100);
    let imageCount = 0; for (let i = this.turns.length - 1; i >= 0; i--) if (this.turns[i].images && this.turns[i].images.length) { imageCount += this.turns[i].images.length; if (imageCount > 2) this.turns[i].images = []; }
    this.publish();
  }
  saveConfig(patch) {
    const c = this.config();
    if (patch && patch.url !== undefined) c.url = safeEndpoint(patch.url).toString();
    if (patch && patch.ollamaModel !== undefined) c.ollamaModel = String(patch.ollamaModel).trim().slice(0, 120);
    this.store.data.settings.touchDesigner = c; this.store.save(); this.publish(); return c;
  }
  async startCallbackServer() {
    if (this.callbackServer) return;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/oauth/callback') { res.writeHead(404).end('Not found'); return; }
      if (u.searchParams.get('state') !== this.oauthState) { res.writeHead(400).end('State check failed. Return to Lumen and reconnect.'); this.rejectCallback(new Error('OAuth state check failed')); return; }
      if (u.searchParams.has('error')) { const e = new Error(`TouchDesigner authorization failed: ${u.searchParams.get('error')}`); res.writeHead(400).end('Authorization denied. Return to Lumen.'); this.rejectCallback(e); return; }
      const code = u.searchParams.get('code'); if (!code) { res.writeHead(400).end('Authorization code missing'); this.rejectCallback(new Error('OAuth authorization code missing')); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end('<!doctype html><title>Lumen</title><p>TouchDesigner is authorized. You can return to Lumen.</p>');
      this.resolveCallback(code);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', resolve); });
    this.callbackServer = server;
    this.redirectUrl = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/oauth/callback`;
  }
  closeCallbackServer() { if (this.callbackServer) this.callbackServer.close(); this.callbackServer = null; this.redirectUrl = null; }
  waitForCallback() { return new Promise((resolve, reject) => { this.resolveCallback = resolve; this.rejectCallback = reject; }); }
  async connect() {
    if (this.state === 'connecting' || this.state === 'authorizing') return this.snapshot();
    await this.disconnect(false); this.cancelled = false; this.error = null; this.state = 'connecting'; this.chatHistory = []; this.projectInfo = null; this.publish();
    try {
      await this.startCallbackServer();
      if (this.cancelled) throw new Error('Connection cancelled');
      const endpoint = safeEndpoint(this.config().url);
      let authorizationUrl = null;
      const service = this;
      const secretKey = 'touchdesigner_oauth_' + crypto.createHash('sha256').update(endpoint.origin).digest('hex').slice(0, 16);
      const saved = () => { try { return JSON.parse(service.store.getSecret(secretKey) || '{}'); } catch { return {}; } };
      const persist = (field, value) => { const x = saved(); if (value === undefined) delete x[field]; else x[field] = value; service.store.setSecret(secretKey, JSON.stringify(x)); };
      const provider = {
        get redirectUrl() { return service.redirectUrl; },
        get clientMetadata() { return { client_name: 'Lumen TouchDesigner Studio', redirect_uris: [service.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
        state: () => { service.oauthState = crypto.randomBytes(24).toString('base64url'); return service.oauthState; },
        clientInformation: () => saved().clientInformation,
        saveClientInformation: (v) => persist('clientInformation', v),
        tokens: () => saved().tokens,
        saveTokens: (v) => persist('tokens', v),
        saveCodeVerifier: (v) => persist('codeVerifier', v),
        codeVerifier: () => saved().codeVerifier,
        redirectToAuthorization: async (u) => { authorizationUrl = u; service.callbackWait = service.waitForCallback(); await service.openExternal(u.toString()); },
        saveDiscoveryState: (v) => persist('discoveryState', v),
        discoveryState: () => saved().discoveryState,
        invalidateCredentials: async (scope) => { const x = saved(); if (scope === 'all' || scope === 'tokens') { delete x.tokens; delete x.codeVerifier; } if (scope === 'all' || scope === 'client') delete x.clientInformation; service.store.setSecret(secretKey, JSON.stringify(x)); },
      };
      this.oauthProvider = provider;
      const boundedFetch = (input, init = {}) => fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
      this.transport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider, fetch: boundedFetch });
      this.transport.onerror = (error) => { if (this.state === 'connected') { this.state = 'error'; this.error = error.message; this.log('error', `TDMCP connection lost: ${error.message}`); } };
      this.transport.onclose = () => { if (this.state === 'connected') { this.state = 'disconnected'; this.error = null; this.log('system', 'TDMCP connection closed.'); } };
      this.client = new Client({ name: 'lumen-touchdesigner-studio', version: this.version }, { capabilities: {} });
      try { await this.client.connect(this.transport); }
      catch (error) {
        if (!authorizationUrl) throw error;
        this.state = 'authorizing'; this.publish(); this.log('auth', 'Waiting for TouchDesigner consent in the browser and app.');
        const authCode = await this.callbackWait;
        if (this.cancelled) throw new Error('Connection cancelled');
        await this.transport.finishAuth(authCode);
        await this.client.connect(this.transport);
      }
      this.tools = (await this.client.listTools()).tools || [];
      this.state = 'connected'; this.error = null; this.log('system', `Connected to TDMCP; discovered ${this.tools.length} tools.`);
      if (this.tools.some((t) => t.name === 'project_info')) {
        try { this.projectInfo = toToolOutput(await this.client.callTool({ name: 'project_info', arguments: {} })).text; }
        catch (error) { this.projectInfo = `Project inspection failed: ${error.message}`; }
        this.log('project', this.projectInfo);
      }
      return this.snapshot();
    } catch (error) {
      if (this.cancelled) { this.state = 'disconnected'; this.error = null; await this.closeConnection(); return this.snapshot(); }
      this.state = 'error'; this.error = error.message || String(error); this.log('error', this.error); await this.closeConnection(); throw error;
    } finally { this.callbackWait = null; this.resolveCallback = null; this.rejectCallback = null; this.closeCallbackServer(); }
  }
  async closeConnection() {
    try { if (this.client) await this.client.close(); } catch {}
    this.client = null; this.transport = null; this.tools = [];
  }
  async disconnect(publish = true) {
    this.cancelled = true;
    if (this.pendingTool) this.pendingTool.resolve(false);
    if (this.activeAbort) this.activeAbort.abort();
    if (this.callbackServer) { try { this.rejectCallback(new Error('Connection cancelled')); } catch {} this.closeCallbackServer(); }
    await this.closeConnection(); this.activeRun = null; this.pendingTool = null; this.state = 'disconnected';
    if (publish) this.publish(); return this.snapshot();
  }
  async models() {
    const response = await fetch(DEFAULT_OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const json = await response.json(); return (json.models || []).map((m) => ({ name: m.name, size: m.size, family: m.details && m.details.family }));
  }
  approveTool(runId, approved) { if (!this.pendingTool || this.pendingTool.runId !== runId) return false; this.pendingTool.resolve(!!approved); return true; }
  stopRun() { this.cancelled = true; if (this.activeAbort) this.activeAbort.abort(); if (this.pendingTool) this.pendingTool.resolve(false); this.publish(); return true; }
  async waitApproval(call) {
    const id = crypto.randomUUID();
    this.pendingTool = { id, runId: this.activeRun, name: call.function.name, args: call.function.arguments, resolve: null };
    this.log('approval', `${call.function.name} requires your approval.`, { pending: { id, name: call.function.name, arguments: call.function.arguments, destructive: DESTRUCTIVE.has(call.function.name) } });
    this.publish();
    const approved = await new Promise((resolve) => { this.pendingTool.resolve = resolve; });
    this.pendingTool = null; this.publish(); return approved;
  }
  async ollamaChat(model, messages, tools, signal) {
    const response = await fetch(DEFAULT_OLLAMA_URL + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, tools, stream: false, think: false, keep_alive: '5m' }), signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return (await response.json()).message || {};
  }
  async run(prompt, model) {
    if (!this.client || this.state !== 'connected') throw new Error('Connect to TouchDesigner first');
    if (this.activeRun) throw new Error('A generation is already running');
    prompt = String(prompt || '').trim(); if (!prompt || prompt.length > 12000) throw new Error('Enter a prompt of 1 to 12,000 characters');
    model = String(model || this.config().ollamaModel || '').trim(); if (!model) throw new Error('Choose an installed Ollama model');
    this.saveConfig({ ollamaModel: model }); this.cancelled = false; this.activeAbort = new AbortController();
    const runId = this.activeRun = crypto.randomUUID(); this.turns = []; this.publish();
    try {
      const available = this.tools.map((t) => ({ type: 'function', function: { name: toolName(t.name), description: `${t.description || t.name} [TDMCP tool: ${t.name}]`, parameters: t.inputSchema || { type: 'object', properties: {} } } }));
      const byAI = new Map(this.tools.map((t) => [toolName(t.name), t]));
      if (!this.turns.length) this.log('user', prompt);
      const messages = [{ role: 'system', content: 'You are Lumen TouchDesigner Studio, a cautious TouchDesigner creative agent. Start by inspecting project_info and existing networks before editing. Use only the provided TDMCP tools and their declared schemas; never invent tool names or parameter names. Prefer preserving the current network and making small edits. Do not delete operators, execute code, or save the project without approval. Briefly explain your plan before tool calls. Use TouchDesigner get_help/get_docs to verify operators and parameters. Report results honestly; do not claim a render succeeded unless tool output confirms it.' }, ...this.chatHistory.slice(-16), { role: 'user', content: prompt }];
      let completed = false;
      for (let step = 0; step < 20 && !this.cancelled; step++) {
        this.log('progress', step === 0 ? `Planning with ${model}…` : 'Reviewing TouchDesigner feedback…');
        const message = await this.ollamaChat(model, messages, available, this.activeAbort.signal); messages.push(message);
        if (message.content) this.log('assistant', message.content);
        const calls = message.tool_calls || []; if (!calls.length) { this.chatHistory = [...messages.slice(-17)]; completed = true; break; }
        for (const call of calls.slice(0, 4)) {
          const name = String(call.function && call.function.name || ''), tool = byAI.get(name), args = call.function && call.function.arguments || {};
          if (!tool) { messages.push({ role: 'tool', tool_name: name, content: 'Rejected: tool is not available from the connected TDMCP server.' }); continue; }
          if (Buffer.byteLength(JSON.stringify(args)) > 64000) { messages.push({ role: 'tool', tool_name: name, content: 'Rejected: tool arguments exceeded Lumen’s 64 KB safety limit. Split this operation into smaller steps.' }); this.log('error', `${tool.name} arguments exceeded the 64 KB safety limit.`); continue; }
          const readOnly = !!(tool.annotations && tool.annotations.readOnlyHint) || READ_ONLY.has(tool.name);
          if (!readOnly && !(await this.waitApproval(call))) { messages.push({ role: 'tool', tool_name: name, content: 'User declined this operation.' }); this.log('denied', `${tool.name} declined by user.`); continue; }
          if (this.cancelled) break;
          this.log('tool', `Calling ${tool.name}`, { arguments: args });
          try {
            const result = await this.client.callTool({ name: tool.name, arguments: args }, undefined, { signal: this.activeAbort.signal, timeout: 120000 });
            const output = toToolOutput(result), content = output.text; messages.push({ role: 'tool', tool_name: name, content });
            if (output.images.length) messages.push({ role: 'user', content: 'Inspect this TouchDesigner output image and use it to assess the current network.', images: output.images.map((x) => x.data) });
            this.log('result', `${tool.name} completed${result && result.isError ? ' with a tool error' : ''}.`, { result: content.slice(0, 5000), images: output.images.map((x) => ({ mimeType: x.mimeType, data: x.data })) });
          } catch (error) { messages.push({ role: 'tool', tool_name: name, content: `Tool error: ${error.message}` }); this.log('error', `${tool.name}: ${error.message}`); }
        }
        for (const call of calls.slice(4)) messages.push({ role: 'tool', tool_name: String(call.function && call.function.name || ''), content: 'Deferred: Lumen executes at most four tool calls per planning step. Request the remaining operations in a follow-up.' });
      }
      if (this.cancelled) this.log('system', 'Generation stopped.');
      else { if (!completed) this.log('system', 'Reached the 20-step generation limit. Review the network and ask for a follow-up if needed.'); this.chatHistory = [...messages.slice(-17)]; }
      return { runId, stopped: this.cancelled };
    } catch (error) { if (!this.cancelled) this.log('error', error.message); throw error; }
    finally { this.activeRun = null; this.activeAbort = null; this.pendingTool = null; this.publish(); }
  }
}

module.exports = { TouchDesigner, DEFAULT_TD_URL, DEFAULT_OLLAMA_URL, safeEndpoint, READ_ONLY, DESTRUCTIVE, toolName, toToolOutput };
