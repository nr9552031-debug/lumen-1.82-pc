'use strict';
// Hubspace (Home Depot) runs on Afero's CLOUD. There is no public local API, so this talks to the
// same HTTPS endpoints the Hubspace phone app uses. We never store your password: after sign-in only a
// refresh token is kept, encrypted with Windows DPAPI.
//
// Protocol notes (matched against the maintained open-source clients aioafero / hubspace-py):
//  - login is a Keycloak PKCE form flow; accounts may require an emailed one-time code (kc-otp-login-form)
//  - the API bearer is the OIDC *id_token*, not the access_token
//  - API calls carry a Host header of semantics2.afero.net even though they connect to api2.afero.net
//  - state is written with PUT .../metadevices/{id}/state  { metadeviceId, values:[{functionClass, functionInstance, value, lastUpdateTime}] }
//  - colour temperature is written as "3000K" (unless the function is declared numeric) and must be one of the device's supported values
const crypto = require('crypto');
const { clamp } = require('../util');
const { request, Jar } = require('../http');

const DEFAULT_URLS = {
  auth: 'https://accounts.hubspaceconnect.com/auth/realms/thd/protocol/openid-connect',
  api: 'https://api2.afero.net',
  apiAlt: 'https://semantics2.afero.net',
  dataHost: 'semantics2.afero.net',
};
const CLIENT_ID = 'hubspace_android';
const REDIRECT = 'hubspace-app://loginredirect';
// Same Android-WebView style user agent the maintained aioafero client sends on every request (sign-in pages, token and API).
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 15; lumen Build/test; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.63 Mobile Safari/537.36';
const APP_UA = BROWSER_UA;
const diag = require('../diag');
const kcError = (html) => { const m = /class="[^"]*kc-feedback-text[^"]*"[^>]*>([^<]{1,160})</.exec(String(html)) || /id="input-error[^"]*"[^>]*>\s*([^<]{1,160})</.exec(String(html)); return m ? m[1].trim() : ''; };
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"');

// Pull the Keycloak session parameters out of a login page. Prefers the <form id="..."> action URL, then any
// form whose action carries a session_code, then a plain regex over the page.
function formParams(html, formId) {
  const forms = [...String(html).matchAll(/<form\b[^>]*>/gi)].map((m) => m[0]);
  const action = (tag) => { const m = /\baction\s*=\s*"([^"]*)"/i.exec(tag) || /\baction\s*=\s*'([^']*)'/i.exec(tag); return m ? decode(m[1]) : null; };
  const byId = forms.find((t) => new RegExp(`\\bid\\s*=\\s*["']${formId}["']`, 'i').test(t));
  const candidates = [byId, ...forms.filter((t) => t !== byId)].filter(Boolean).map(action).filter((a) => a && /session_code=/.test(a));
  let q = null;
  if (candidates.length) { try { q = new URL(candidates[0], 'http://x').searchParams; } catch { q = null; } }
  const get = (k) => (q && q.get(k)) || (() => { const m = new RegExp(k + '=([^&"\'\\s<]+)').exec(decode(html)); return m && m[1]; })();
  const p = { session_code: get('session_code'), execution: get('execution'), tab_id: get('tab_id') };
  return p.session_code && p.execution && p.tab_id ? p : null;
}
const codeFrom = (loc) => { const m = /[?&]code=([^&]+)/.exec(loc || ''); return m ? decodeURIComponent(m[1]) : null; };

class HubspaceProvider {
  constructor({ store, urls } = {}) {
    this.brand = 'hubspace';
    this.store = store;
    this.urls = { ...DEFAULT_URLS, ...(urls || {}) };
    this.bases = [
      { base: this.urls.api, host: this.urls.dataHost },
      { base: this.urls.apiAlt, host: new URL(this.urls.apiAlt).host },
    ];
    this.apiIdx = 0;
    this.token = null; this.tokenExp = 0; this.accountId = null;
    this.pending = null; this._tokenP = null; this._listP = null; this._listAt = 0;
  }
  get connected() { return !!this.store.getSecret('hubspace_refresh'); }

  // ---- sign-in ----
  _submit(params, data, jar) {
    const q = new URLSearchParams({ session_code: params.session_code, execution: params.execution, client_id: CLIENT_ID, tab_id: params.tab_id });
    // Keycloak's form endpoint lives directly under the realm (…/realms/thd/login-actions/authenticate), NOT under
    // …/protocol/openid-connect like the auth and token endpoints. Posting to the wrong one returns HTTP 405.
    const realm = this.urls.auth.replace(/\/protocol\/openid-connect\/?$/, '');
    return request('POST', `${realm}/login-actions/authenticate?${q}`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'io.afero.partner.hubspace', 'user-agent': BROWSER_UA, 'accept-encoding': 'gzip', cookie: jar.header() },
      body: new URLSearchParams(data).toString(),
    }).then((r) => { jar.add(r.setCookie); return r; });
  }
  // Resolves to { ok:true } when signed in, or { needs2fa:true } when Hubspace emailed a verification code.
  async login(email, password) {
    email = String(email || '').trim();
    this.pending = null; this.accountId = null; this.token = null;
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const q = new URLSearchParams({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid offline_access',
    });
    const jar = new Jar();
    const r1 = await request('GET', `${this.urls.auth}/auth?${q}`, { headers: { 'user-agent': BROWSER_UA, 'accept-encoding': 'gzip' } });
    jar.add(r1.setCookie);
    diag.log('hubspace', `sign-in page -> ${r1.status}, login form ${/kc-form-login/.test(r1.text) ? 'found' : 'NOT found'}, ${r1.text.length} bytes`);
    let code = null;
    if (r1.status === 302) code = codeFrom(r1.headers.location); // an existing session already signed in
    if (!code) {
      if (r1.status === 403) throw new Error('Hubspace blocked the sign-in page (HTTP 403). This usually clears after a few minutes; a VPN can also cause it.');
      if (r1.status !== 200) throw new Error(`Hubspace sign-in page returned HTTP ${r1.status}`);
      const params = formParams(r1.text, 'kc-form-login');
      if (!params) throw new Error('Hubspace sign-in page changed; could not start login');
      const r2 = await this._submit(params, { username: email, password, credentialId: '' }, jar);
      diag.log('hubspace', `credentials -> ${r2.status}, code form ${/kc-otp-login-form/.test(r2.text) ? 'shown' : 'not shown'}${kcError(r2.text) ? ', page says: ' + kcError(r2.text) : ''}`);
      if (r2.status === 302) {
        code = codeFrom(r2.headers.location);
        if (!code) throw new Error('Hubspace asked for an extra sign-in step. Sign in once in the Hubspace app, then try again.');
      } else if (/kc-otp-login-form/.test(r2.text)) {
        const op = formParams(r2.text, 'kc-otp-login-form');
        if (!op) throw new Error('Hubspace verification page changed; could not continue login');
        this.pending = { params: op, jar, verifier };
        return { needs2fa: true };
      } else if (r2.status === 403) throw new Error('Hubspace blocked the sign-in (HTTP 403). Wait a few minutes and try again.');
      else if (r2.status === 200) throw new Error(`Hubspace did not accept the email or password${kcError(r2.text) ? ' (' + kcError(r2.text) + ')' : ''}`);
      else throw new Error(`Hubspace sign-in failed (HTTP ${r2.status})`);
    }
    await this._finish(code, verifier);
    return { ok: true };
  }
  async verifyOtp(otp) {
    const p = this.pending;
    if (!p) throw new Error('No Hubspace sign-in in progress. Connect again.');
    const r = await this._submit(p.params, { action: 'submit', flowName: 'doLogIn', emailCode: String(otp || '').trim() }, p.jar);
    const code = r.status === 302 ? codeFrom(r.headers.location) : null;
    diag.log('hubspace', `email code -> ${r.status}${kcError(r.text) ? ', page says: ' + kcError(r.text) : ''}`);
    if (!code) {
      const np = formParams(r.text, 'kc-otp-login-form'); if (np) p.params = np; // Keycloak rotates session_code on a bad attempt
      throw new Error(`Hubspace did not accept that code${kcError(r.text) ? ' (' + kcError(r.text) + ')' : ''}. Use the newest email and try again.`);
    }
    this.pending = null;
    await this._finish(code, p.verifier);
    return { ok: true };
  }
  async _finish(code, verifier) {
    const tok = await this._token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: CLIENT_ID });
    if (!tok.refresh_token) throw new Error('Hubspace did not return a sign-in token');
    this.store.setSecret('hubspace_refresh', tok.refresh_token);
    this._setToken(tok);
    await this._account();
  }
  async _token(params) {
    const r = await request('POST', `${this.urls.auth}/token`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': APP_UA, 'accept-encoding': 'gzip', host: new URL(this.urls.auth).host },
      body: new URLSearchParams(params).toString(),
    });
    let j = {}; try { j = JSON.parse(r.text); } catch {}
    diag.log('hubspace', `token (${params.grant_type}) -> ${r.status}${j.error ? ' ' + j.error : ''} fields=[${Object.keys(j).filter((k) => /token|expires/.test(k)).join(',')}]`);
    if (r.status < 200 || r.status >= 300) {
      if (j.error === 'invalid_grant') { const e = new Error('Hubspace sign-in expired. Disconnect and connect again.'); e.authExpired = true; throw e; }
      throw new Error(`Hubspace token error (${r.status})`);
    }
    return j;
  }
  _setToken(t) {
    // The API wants the OIDC id_token as its bearer; fall back to access_token for servers that only return that.
    this.token = t.id_token || t.access_token;
    this.tokenExp = Date.now() + Math.max(10, Number(t.expires_in || 118) - 5) * 1000;
    if (t.refresh_token) this.store.setSecret('hubspace_refresh', t.refresh_token);
  }
  async _auth() {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    if (!this._tokenP) {
      this._tokenP = (async () => {
        const rt = this.store.getSecret('hubspace_refresh');
        if (!rt) throw new Error('Hubspace is not connected');
        this._setToken(await this._token({ grant_type: 'refresh_token', refresh_token: rt, scope: 'openid email offline_access profile', client_id: CLIENT_ID }));
        return this.token;
      })().finally(() => { this._tokenP = null; });
    }
    return this._tokenP;
  }

  // ---- API ----
  async _call(method, url, body, host, retried) {
    const token = await this._auth();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8', accept: 'application/json', 'user-agent': APP_UA, 'accept-encoding': 'gzip' };
    if (host) headers.host = host;
    const r = await request(method, url, { headers, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retried) { this.token = null; return this._call(method, url, body, host, true); }
    if (r.status < 200 || r.status >= 300) { diag.log('hubspace', `${method} ${new URL(url).pathname.replace(/[0-9a-f-]{16,}/gi, '#')} -> ${r.status} ${r.text.slice(0, 120)}`); const e = new Error(`Hubspace API returned HTTP ${r.status}`); e.status = r.status; throw e; }
    return r.text ? JSON.parse(r.text) : {};
  }
  // Try the primary Afero host, then the alternate one if the primary is unreachable / erroring.
  async _data(method, path, body) {
    let last;
    for (let i = 0; i < 2; i++) {
      const idx = (this.apiIdx + i) % 2, b = this.bases[idx];
      try { const r = await this._call(method, b.base + path, body, b.host); this.apiIdx = idx; return r; }
      catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 403 && e.status !== 404) throw e; }
    }
    throw last;
  }
  async _account() {
    if (this.accountId) return this.accountId;
    const me = await this._call('GET', `${this.bases[0].base}/v1/users/me`, null, null);
    const id = me && me.accountAccess && me.accountAccess[0] && me.accountAccess[0].account && me.accountAccess[0].account.accountId;
    if (!id) throw new Error('Hubspace account has no home attached');
    return (this.accountId = id);
  }
  async _metadevices() { const id = await this._account(); return this._data('GET', `/v1/accounts/${id}/metadevices?expansions=state,capabilities,semantics`); }
  // refresh() is called once per light every few seconds; share one list request between them.
  _list() {
    if (this._listP && Date.now() - this._listAt < 3000) return this._listP;
    this._listAt = Date.now();
    this._listP = this._metadevices().catch((e) => { this._listP = null; throw e; });
    return this._listP;
  }

  _val(values, fc) { const v = values.find((x) => x.functionClass === fc); return v ? v.value : undefined; }
  // What kelvin values may be written, and how (with or without the trailing "K").
  _tempSpec(m, values) {
    const fn = ((m.description && m.description.functions) || []).find((f) => f.functionClass === 'color-temperature');
    const spec = { list: null, min: null, max: null, step: 1, suffix: false };
    const num = (v) => parseInt(String(v), 10);
    if (fn && Array.isArray(fn.values) && fn.values.length) {
      spec.suffix = fn.type !== 'numeric';
      if (fn.values.length > 1) spec.list = fn.values.map((v) => num(v.name)).filter((n) => n > 1000).sort((a, b) => a - b);
      else {
        const v = fn.values[0], r = v.range || v;
        if (Number.isFinite(Number(r.min)) && Number.isFinite(Number(r.max))) { spec.min = Number(r.min); spec.max = Number(r.max); spec.step = Number(r.step) > 0 ? Number(r.step) : 1; }
        else if (num(v.name) > 1000) spec.list = [num(v.name)];
      }
    } else {
      const cur = this._val(values, 'color-temperature');
      spec.suffix = typeof cur === 'string' && /k$/i.test(cur);
    }
    if (spec.list && !spec.list.length) spec.list = null;
    return spec;
  }
  _toDevice(m) {
    const values = (m.state && m.state.values) || [];
    const has = (fc) => values.some((v) => v.functionClass === fc);
    const inst = {};
    for (const v of values) if (!(v.functionClass in inst)) inst[v.functionClass] = v.functionInstance === undefined ? null : v.functionInstance;
    const temp = this._tempSpec(m, values);
    const dev = {
      id: `hubspace:${m.id}`, brand: 'hubspace',
      native: { id: m.id, powerInstance: inst.power === undefined ? null : inst.power, inst, temp },
      name: m.friendlyName || m.defaultName || 'Hubspace light',
      caps: { dim: has('brightness'), color: has('color-rgb'), temp: has('color-temperature') },
      kelvinRange: [2200, 6500], online: true,
    };
    if (temp.list) dev.kelvinRange = [temp.list[0], temp.list[temp.list.length - 1]];
    else if (temp.min !== null) dev.kelvinRange = [temp.min, temp.max];
    Object.assign(dev, this._parseState(values));
    return dev;
  }
  _parseState(values) {
    const s = {};
    const p = this._val(values, 'power'); if (p !== undefined) s.on = p === 'on';
    const b = this._val(values, 'brightness'); if (b !== undefined && !isNaN(Number(b))) s.brightness = clamp(Math.round(Number(b)), 1, 100);
    const t = this._val(values, 'color-temperature'); if (t !== undefined && !isNaN(parseInt(t, 10))) s.kelvin = parseInt(t, 10);
    const c = this._val(values, 'color-rgb');
    if (c && c['color-rgb']) s.rgb = [c['color-rgb'].r, c['color-rgb'].g, c['color-rgb'].b];
    const mode = this._val(values, 'color-mode'); if (mode) s.mode = mode === 'color' ? 'color' : 'white';
    const av = this._val(values, 'available'); if (av !== undefined) s.online = av === true || av === 'true';
    return s;
  }
  async discover() {
    const list = await this._metadevices();
    if (!Array.isArray(list)) throw new Error('Hubspace returned an unexpected device list');
    const classes = {}; for (const m of list) { const c = (m.typeId === 'metadevice.device' && m.description && m.description.device && m.description.device.deviceClass) || m.typeId; classes[c] = (classes[c] || 0) + 1; }
    diag.log('hubspace', `account lists ${list.length} item(s): ${JSON.stringify(classes)}`);
    return list
      .filter((m) => m.typeId === 'metadevice.device' && m.description && m.description.device && m.description.device.deviceClass === 'light')
      .map((m) => this._toDevice(m));
  }
  async refresh(dev) {
    const list = await this._list();
    const m = list.find((x) => x.id === dev.native.id);
    if (!m) return { online: false };
    return { online: true, ...this._parseState((m.state && m.state.values) || []) };
  }
  _snapTemp(dev, k) {
    const spec = dev.native.temp;
    if (!spec) return clamp(Math.round(k), dev.kelvinRange[0], dev.kelvinRange[1]);
    let v;
    if (spec.list) v = spec.list.reduce((best, x) => (Math.abs(x - k) < Math.abs(best - k) ? x : best), spec.list[0]);
    else if (spec.min !== null) v = clamp(spec.min + Math.round((k - spec.min) / spec.step) * spec.step, spec.min, spec.max);
    else v = clamp(Math.round(k), dev.kelvinRange[0], dev.kelvinRange[1]);
    return spec.suffix ? `${v}K` : v;
  }
  async setState(dev, p) {
    const inst = dev.native.inst || {};
    const vals = [];
    const add = (functionClass, value) => vals.push({ functionClass, functionInstance: inst[functionClass] === undefined ? null : inst[functionClass], value, lastUpdateTime: Date.now() });
    if (p.on === false) add('power', 'off');
    else {
      add('power', 'on');
      if (p.brightness !== undefined && dev.caps.dim) add('brightness', clamp(Math.round(p.brightness), 1, 100));
      const hasMode = 'color-mode' in inst; // white-only bulbs have no colour-mode function
      if (p.rgb && dev.caps.color) { if (hasMode) add('color-mode', 'color'); add('color-rgb', { 'color-rgb': { r: p.rgb[0], g: p.rgb[1], b: p.rgb[2] } }); }
      else if (p.kelvin && dev.caps.temp) { if (hasMode) add('color-mode', 'white'); add('color-temperature', this._snapTemp(dev, p.kelvin)); }
    }
    const id = await this._account();
    await this._data('PUT', `/v1/accounts/${id}/metadevices/${dev.native.id}/state`, { metadeviceId: String(dev.native.id), values: vals });
    this._listAt = 0; // next refresh must see the change
  }
  disconnect() { this.store.setSecret('hubspace_refresh', null); this.token = null; this.accountId = null; this.pending = null; this._listP = null; }
}
module.exports = { HubspaceProvider };
