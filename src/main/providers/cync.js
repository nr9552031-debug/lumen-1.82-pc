'use strict';
// GE Cync: controlled through Cync's CLOUD. HTTPS lists your homes/bulbs, then a persistent socket to the
// relay cm.gelighting.com (the one the phone app uses) carries commands, acknowledgements and state.
// Protocol follows Kinachi249/pycync (the library behind Home Assistant's Cync integration), checked against
// nikshriv/cync_lights and unixpickle/cbyge.
// The password is never stored; only the tokens are kept, encrypted with Windows DPAPI.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { clamp } = require('../util');
const diag = require('../diag');

const CORP_ID = '1007d2ad150c4000';
// cm-sec.gelighting.com:23779 is the TLS relay the app and pycync use (cm.gelighting.com is the old plain-TCP host).
const DEFAULTS = { api: 'https://api.gelighting.com/v2', host: 'cm-sec.gelighting.com', port: 23779, tls: true, ackWait: 600, ackTries: 4, pingMs: 20000 };
// deviceType -> capability, from the cync_lights reference table.
const S = (a) => new Set(a);
const TYPES = {
  ONOFF: S([1,5,6,7,8,9,10,11,13,14,15,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,47,48,49,51,52,53,54,55,56,57,58,59,61,62,63,64,65,66,67,68,80,81,82,83,85,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,158,159,160,161,162,163,164,165,166,169,170,171,172]),
  BRIGHTNESS: S([1,5,6,7,8,9,10,11,13,14,15,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,47,48,49,55,56,80,81,82,83,85,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,158,159,160,161,162,163,164,165,166,169,170,171]),
  COLORTEMP: S([5,6,7,8,10,11,14,15,19,20,21,22,23,25,26,28,29,30,31,32,33,34,35,47,80,82,83,85,129,130,131,132,133,135,136,137,138,139,140,141,142,143,144,145,146,147,153,154,155,156,158,159,160,161,162,163,164,165,166,169,170,171]),
  RGB: S([6,7,8,21,22,23,30,31,32,33,34,35,47,131,132,133,137,138,139,140,141,142,143,146,147,153,154,155,156,158,159,160,161,162,163,164,165,166,169,170,171]),
  WIFI: S([36,37,38,39,40,47,48,49,51,52,53,54,55,56,57,58,59,61,62,63,64,65,66,67,68,80,81,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,158,159,160,161,162,163,164,165,166,169,170,171,172]),
};
// Everything needed to compare a failed sign-in with the reference clients, with secrets masked (diag redacts again):
// request field NAMES (never values), the reply's JSON with token fields masked, or the start of a non-JSON body, and header names.
const SECRET_KEYS = /token|authorize|password|code$/i;
function maskBody(j) { try { return JSON.stringify(j, (k, v) => (SECRET_KEYS.test(k) && typeof v === 'string' ? `<${v.length} chars>` : v)).slice(0, 400); } catch { return ''; } }
const detail = (r, sent) => ` sent=[${Object.keys(sent || {}).join(',')}] body=${r && r.json && Object.keys(r.json).length ? maskBody(r.json) : JSON.stringify(String((r && r.text) || '').slice(0, 160))} headers=[${((r && r.headers) || []).join(',')}]`;
const errText = (r) => { const e = r && r.json && r.json.error; const m = e && (e.msg || e.message); return m ? `: ${String(m).slice(0, 120)}` : ''; };
// The "resource" sent with the emailed code is a label the CLIENT picks for its session; the service never
// issues one. Like cbyge, use 16 random lowercase letters per sign-in.
const randomResource = () => [...crypto.randomBytes(16)].map((b) => String.fromCharCode(97 + (b % 26))).join('');

// Cync locks sign-in after repeated failures ("...try again after 1 hours" / "after 59 minutes"). Every attempt during a
// lock can restart it, so Lumen remembers the end time and sends nothing until then.
function lockMinutes(msg) { const m = /try again after (\d+)\s*(hour|minute)/i.exec(String(msg || '')); return m ? +m[1] * (/hour/i.test(m[2]) ? 60 : 1) : 0; }

class CyncProvider {
  constructor({ store, opts } = {}) {
    this.brand = 'cync';
    this.store = store;
    this.o = { ...DEFAULTS, ...(opts || {}) };
    this.sock = null; this.seq = 1; this.loggedIn = false; this.ka = null;
    this.pending2fa = null;
    this.acks = new Map();        // seq -> resolve
    this.meshMap = new Map();     // `${homeId}:${meshIndex}` -> deviceID
    this.switchHome = new Map();  // controller switchID -> homeId
    this.states = new Map();      // deviceID -> last state reported by the relay
    this.onState = null;          // set by the manager
    this.relayMode = null;
  }
  get connected() { return !!this.store.getSecret('cync_auth'); }

  async _post(path, body) {
    let r;
    try { r = await fetch(`${this.o.api}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
    catch (e) { diag.log('cync', `POST ${path} failed: ${e.cause ? e.cause.code || e.cause.message : e.message}`); throw new Error('Could not reach the Cync cloud (api.gelighting.com). Check this PC\'s internet connection.'); }
    let txt = ''; try { txt = await r.text(); } catch {}
    let j = {}; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, json: j, text: txt, headers: [...r.headers.keys()] };
  }
  _auth() { try { return JSON.parse(this.store.getSecret('cync_auth')); } catch { return null; } }
  async _get(path, retried) {
    let a = this._auth();
    if (!a) throw new Error('Cync is not connected');
    if (!retried && a.expires && a.expires - Date.now() < 3600e3) { try { await this._refresh(); a = this._auth(); } catch (e) { if (e.authExpired) throw e; } }
    let r; try { r = await fetch(`${this.o.api}${path}`, { headers: { 'Access-Token': a.access_token }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { diag.log('cync', `GET failed: ${e.cause ? e.cause.code || e.cause.message : e.name}`); throw new Error('Could not reach the Cync cloud (api.gelighting.com).'); }
    diag.log('cync', `GET ${path.replace(/\d{4,}/g, '#')} -> ${r.status}`);
    if ((r.status === 401 || r.status === 403) && !retried) { await this._refresh(); return this._get(path, true); }
    if (r.status === 401 || r.status === 403) throw this._expired();
    if (!r.ok) throw new Error(`Cync API ${r.status}`);
    return r.json();
  }
  _expired() { const e = new Error('Cync sign-in expired. Disconnect and connect again.'); e.authExpired = true; return e; }
  // Refresh endpoint and body as in pycync.
  _refresh() {
    if (!this._refreshP) this._refreshP = (async () => {
      const a = this._auth();
      if (!a || !a.refresh_token) throw this._expired();
      const r = await this._post('/user/token/refresh', { refresh_token: a.refresh_token });
      diag.log('cync', `token refresh -> ${r.status}`);
      if (!(r.json && r.json.access_token)) throw this._expired();
      this.store.setSecret('cync_auth', JSON.stringify({ ...a, access_token: r.json.access_token, refresh_token: r.json.refresh_token || a.refresh_token, expires: r.json.expire_in ? Date.now() + r.json.expire_in * 1000 : a.expires || null }));
    })().finally(() => { this._refreshP = null; });
    return this._refreshP;
  }
  // Returns { needs2fa: true } when Cync emails a verification code.
  _lockCheck() {
    const until = (this.store.data && this.store.data.settings && this.store.data.settings.cyncLockUntil) || 0;
    if (until > Date.now()) { const at = new Date(until); throw new Error(`Cync has temporarily locked sign-in for this account after too many attempts. Lumen will not try again until ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, because any attempt before then restarts the lock. Don't sign in from the Cync app or elsewhere until then either.`); }
  }
  _lockFrom(r) {
    const min = lockMinutes(r && r.json && r.json.error && (r.json.error.msg || r.json.error.message));
    if (!min) return false;
    if (this.store.data && this.store.data.settings) { this.store.data.settings.cyncLockUntil = Date.now() + (min + 1) * 60000; if (this.store.save) this.store.save(); }
    this.pending2fa = null; diag.log('cync', `account locked by Cync for ${min} min; no sign-in attempts until then`);
    return true;
  }
  async login(email, password) {
    email = String(email || '').trim(); password = String(password || '');
    this._lockCheck();
    if (!email || !password) throw new Error('Enter both your Cync email and password.');
    if (this._loginBusy) throw new Error('A Cync sign-in is already in progress.');
    this._loginBusy = true;
    try { return await this._login(email, password); } finally { this._loginBusy = false; }
  }
  async _login(email, password) {
    const body = { corp_id: CORP_ID, email, password };
    const r = await this._post('/user_auth', body);
    diag.log('cync', `user_auth -> ${r.status}${errText(r)}${r.json && r.json.access_token ? '' : detail(r, body)}`);
    if (this._lockFrom(r)) this._lockCheck();
    if (r.json && r.json.access_token) return this._saveAuth(r.json);
    // As in the reference clients: HTTP 400 from user_auth means "verification code required".
    if (r.status === 400) {
      const vbody = { corp_id: CORP_ID, email, local_lang: 'en-us' };
      const sent = await this._post('/two_factor/email/verifycode', vbody);
      diag.log('cync', `request email code -> ${sent.status}${errText(sent)}${detail(sent, vbody)}`);
      if (sent.status !== 200) throw new Error(`Cync could not send the verification email (HTTP ${sent.status}${errText(sent)}). Check the email address.`);
      this.pending2fa = { email, password };
      return { needs2fa: true };
    }
    throw new Error(`Cync rejected the sign-in (HTTP ${r.status}${errText(r)})`);
  }
  async verify2fa(code) {
    if (!this.pending2fa) throw new Error('No Cync sign-in in progress. Click Connect Cync again.');
    const { email, password } = this.pending2fa, clean = String(code || '').replace(/[^0-9A-Za-z]/g, '');
    if (clean.length < 4 || clean.length > 10) throw new Error('Type the code from the newest Cync email (usually 6 digits).');
    this._lockCheck();
    if (this._lastFail && Date.now() - this._lastFail < 4000) throw new Error('Please wait a few seconds before trying the code again.');
    if (this._loginBusy) throw new Error('A Cync sign-in is already in progress.');
    this._loginBusy = true;
    const tbody = { corp_id: CORP_ID, email, password, two_factor: clean, resource: randomResource() };
    let r; try { r = await this._post('/user_auth/two_factor', tbody); } finally { this._loginBusy = false; }
    diag.log('cync', `two_factor (code length ${clean.length}, digits only: ${/^\d+$/.test(clean)}) -> ${r.status}${errText(r)}${r.json && r.json.access_token ? ` fields=[${Object.keys(r.json).join(',')}]` : detail(r, tbody)}`);
    if (this._lockFrom(r)) this._lockCheck();
    if (!(r.json && r.json.access_token)) this._lastFail = Date.now();
    if (!(r.json && r.json.access_token)) throw new Error(`Cync says that code is wrong (HTTP ${r.status}${errText(r)}). Each time you click Connect Cync a NEW code is emailed and older ones stop working: wait for the newest email, type that code, and click Verify (don't click Connect again).`);
    this.pending2fa = null;
    return this._saveAuth(r.json);
  }
  _saveAuth(j) {
    if (!j.authorize || !j.user_id) diag.log('cync', `sign-in reply is missing ${!j.authorize ? 'authorize' : 'user_id'}; the relay will not accept it`);
    this.store.setSecret('cync_auth', JSON.stringify({ access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user_id, authorize: j.authorize, expires: j.expire_in ? Date.now() + j.expire_in * 1000 : null }));
    this._drop(); // a new sign-in means a new relay session
    return { ok: true };
  }

  async discover() {
    const a = this._auth();
    if (!a) throw new Error('Cync is not connected');
    const homes = await this._get(`/user/${a.user_id}/subscribe/devices`);
    diag.log('cync', `homes: ${Array.isArray(homes) ? homes.length : typeof homes}`);
    if (!Array.isArray(homes)) throw new Error('Cync returned an unexpected home list');
    const out = [];
    let failed = 0, lastErr = null;
    this.meshMap.clear(); this.switchHome.clear();
    for (const h of homes) {
      let prop; try { prop = await this._get(`/product/${h.product_id}/device/${h.id}/property`); } catch (e) { if (e.authExpired) throw e; failed++; lastErr = e; continue; }
      const bulbs = prop.bulbsArray || [];
      // A "controller" is a Wi-Fi Cync device; every command is routed through one (Bluetooth-only bulbs ride on it).
      const isCtl = (b) => Number(b.switchID) > 0 && (b.deviceType === undefined || !TYPES.ONOFF.has(b.deviceType) || TYPES.WIFI.has(b.deviceType));
      const controllers = bulbs.filter(isCtl).map((b) => Number(b.switchID));
      diag.log('cync', `home: ${bulbs.length} device(s), ${controllers.length} Wi-Fi controller(s), deviceTypes=[${bulbs.map((b) => b.deviceType).join(',')}]`);
      for (const c of controllers) this.switchHome.set(c, String(h.id));
      for (const b of bulbs) {
        const t = b.deviceType, known = t !== undefined && TYPES.ONOFF.has(t);
        const deviceID = String(b.deviceID);
        const mesh = meshIndex(deviceID, h.id);
        this.meshMap.set(`${h.id}:${mesh.id}`, deviceID);
        const switchId = isCtl(b) ? Number(b.switchID) : (controllers[0] || 0);
        out.push({
          id: `cync:${deviceID}`, brand: 'cync',
          native: { switchId, mesh: mesh.id, group: mesh.group, deviceID, homeId: String(h.id), deviceType: t, controllers },
          name: b.displayName || `Cync ${deviceID.slice(-4)}`,
          // Known device types use the reference capability table; unknown (newer) types offer everything, editable per bulb.
          caps: known ? { dim: TYPES.BRIGHTNESS.has(t), color: TYPES.RGB.has(t), temp: TYPES.COLORTEMP.has(t) } : { dim: true, color: true, temp: true },
          kelvinRange: [2000, 7000], online: switchId > 0,
          on: false, brightness: 100, mode: 'white', kelvin: 2700,
        });
      }
    }
    if (failed && failed === homes.length) throw lastErr;
    // Connect in the background so the relay starts reporting real bulb state.
    if (out.some((d) => d.native.switchId)) this._connect().then(() => this._requestState()).catch((e) => diag.log('cync', `relay: ${e.message}`));
    return out;
  }

  // ---- cloud relay socket ----
  // Cync allows one relay session per account, so concurrent commands (scenes, "all on") must share ONE login.
  _connect() {
    if (this.sock && this.loggedIn) return Promise.resolve();
    if (!this._connecting) this._connecting = this._open().finally(() => { this._connecting = null; });
    return this._connecting;
  }
  async _open() {
    const a = this._auth();
    if (!a || !a.authorize) throw this._expired();
    // The relay connection is TLS with normal certificate verification. The reference clients fall back to an
    // unverified connection because the relay's certificate does not always validate; Lumen only does that if the
    // user has explicitly allowed it in Control Panel (off by default). Plain TCP is never used outside the tests.
    const modes = this.o.tls === false ? ['plain'] : this.o.allowUnverified ? ['verified', 'pinned'] : ['verified'];
    let last = null;
    for (const mode of modes) {
      try { await this._dial(a, mode); this.relayMode = mode; last = null; diag.log('cync', `relay connected (${mode})`); break; }
      catch (e) { last = e; diag.log('cync', `relay ${mode} failed: ${e.code || e.message}`); }
    }
    if (last) {
      if (!this.o.allowUnverified && /certificate|self.signed|CERT_|issuer|altname/i.test(String(last.code) + ' ' + last.message)) {
        const e = new Error("Signed in, but Cync's relay server uses an expired certificate that Windows can't verify, so Lumen won't control the lights yet. To allow it, tick \"Trust the Cync relay's certificate\" under Control Panel → Accounts → GE Cync. Lumen then remembers that exact certificate and refuses any other."); e.certUntrusted = true; throw e;
      }
      throw last;
    }
    this.backoff = 0; this._requestState(); // fresh session: ask for every bulb's current state
    clearInterval(this.ka);
    this.ka = setInterval(() => { try { this.sock.write(Buffer.from('d300000000', 'hex')); } catch {} }, this.o.pingMs);
    this.ka.unref && this.ka.unref();
  }
  _dial(a, mode) {
    return new Promise((resolve, reject) => {
      let sock, buf = Buffer.alloc(0);
      const to = setTimeout(() => { this._dropSock(sock); reject(new Error('Cync relay timed out')); }, 8000);
      const onConnect = () => {
        const auth = Buffer.from(a.authorize, 'utf8');
        sock.write(Buffer.concat([
          Buffer.from('13000000', 'hex'), Buffer.from([auth.length + 10]), Buffer.from('03', 'hex'),
          u32(a.user_id), u16(auth.length), auth, Buffer.from('00001e', 'hex'),
        ]));
      };
      const onSecure = () => {
        if (mode !== 'pinned') return onConnect();
        // Certificate pinning: the relay's certificate can't pass normal checks (expired, wrong name), so instead
        // Lumen accepts only the exact certificate the user approved. First approved connection records it.
        const cert = sock.getPeerCertificate(), fp = cert && cert.fingerprint256;
        const pin = this.store.getSecret('cync_relay_pin');
        if (!fp) { this._dropSock(sock); clearTimeout(to); return reject(new Error('Cync relay sent no certificate')); }
        if (pin && pin !== fp) { diag.log('cync', 'relay certificate changed; refusing (pinned certificate does not match)'); this._dropSock(sock); clearTimeout(to); const e = new Error("Cync's relay presented a different certificate from the one you approved, so Lumen did not connect. If Cync changed its server, untick and re-tick \"Trust the Cync relay's certificate\" in Control Panel → Accounts."); e.certUntrusted = true; return reject(e); }
        if (!pin) { this.store.setSecret('cync_relay_pin', fp); diag.log('cync', `relay certificate pinned (valid to ${cert.valid_to})`); }
        onConnect();
      };
      sock = this.sock = mode === 'plain'
        ? net.connect({ host: this.o.host, port: this.o.port }, onConnect)
        : tls.connect({ host: this.o.host, port: this.o.port, servername: this.o.host, rejectUnauthorized: mode === 'verified' }, onSecure);
      sock.on('data', (d) => {
        if (this.sock !== sock) return;
        // The first packet back must be the login reply (message type 1). Type 14 (disconnect) means the relay refused the sign-in.
        if (!this.loggedIn) {
          const mt = d[0] >> 4; diag.log('cync', `relay login reply type=0x${d[0].toString(16)} bytes=${d.length}`);
          if (mt === 14) { clearTimeout(to); this._dropSock(sock); const e = new Error('The Cync relay refused this sign-in. Disconnect Cync and sign in again.'); e.authExpired = true; return reject(e); }
          this.loggedIn = true; clearTimeout(to); resolve();
          if (mt !== 1) return; // not a login reply; it will be parsed below with the rest
        }
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 5) {
          const len = buf.readUInt32BE(1);
          if (len > 8192) { buf = Buffer.alloc(0); break; }
          if (buf.length < 5 + len) break;
          const type = buf[0], p = buf.subarray(5, 5 + len); buf = buf.subarray(5 + len);
          try { this._onPacket(type, p, sock); } catch (e) { diag.log('cync', `packet 0x${type.toString(16)} parse error: ${e.message}`); }
        }
      });
      sock.on('error', (e) => { clearTimeout(to); this._dropSock(sock); reject(e); });
      sock.on('close', () => {
        clearTimeout(to);
        if (this.sock === sock && this.loggedIn) { diag.log('cync', 'relay closed the connection (the Cync phone app may have taken the session)'); this._reconnectLater(); }
        this._dropSock(sock); reject(new Error('Cync relay closed the connection'));
      });
    });
  }
  // Incoming relay packets, decoded as in the cync_lights reference.
  _onPacket(type, p, sock) {
    if (type === 0x7b && p.length >= 6) { // command acknowledged
      const f = this.acks.get(p.readUInt16BE(4));
      if (f) f(true);
      return;
    }
    if ((type === 0x73 || type === 0x83) && p.length >= 6) {
      const sw = p.readUInt32BE(0), home = this.switchHome.get(sw);
      if (type === 0x73) sock.write(Buffer.concat([Buffer.from('7300000007', 'hex'), u32(sw), p.subarray(4, 6), Buffer.from([0])]));
      if (!home) return;
      if (p.length >= 33 && p[13] === 219) this._state(home, p[21], { on: p[27] > 0, bri: p[28] });
      else if (type === 0x73 && p.length > 51 && p[13] === 82) {
        for (let q = p.subarray(22); q.length > 24; q = q.subarray(24)) this._state(home, q[0], { on: q[8] > 0, bri: q[12], tone: q[16], rgb: [q[20], q[21], q[22]] });
      }
      return;
    }
    if (type === 0x43 && p.length >= 26 && p[4] === 1 && p[5] === 1 && p[6] === 6) {
      const home = this.switchHome.get(p.readUInt32BE(0)); if (!home) return;
      for (let q = p.subarray(7); q.length >= 19; q = q.subarray(19)) this._state(home, q[3], { on: q[4] > 0, bri: q[5], tone: q[6], rgb: [q[7], q[8], q[9]] });
    }
  }
  _state(home, idx, s) {
    const id = this.meshMap.get(`${home}:${idx}`); if (!id) return;
    const st = { on: s.on, online: true };
    if (s.on && s.bri) st.brightness = clamp(s.bri, 1, 100);
    if (s.tone === 254 && s.rgb) { st.mode = 'color'; st.rgb = s.rgb; }
    else if (s.tone !== undefined && s.tone <= 100) { st.mode = 'white'; st.kelvin = Math.round(2000 + s.tone * 50); }
    this.states.set(id, st);
    if (this.onState) this.onState(`cync:${id}`, st);
  }
  // Network drop or relay restart: reconnect in the background (10 s, doubling to 5 min) so state reports resume.
  _reconnectLater() {
    if (this._rt || !this.connected) return;
    const wait = this.backoff = Math.min(300000, this.backoff ? this.backoff * 2 : 10000);
    this._rt = setTimeout(() => { this._rt = null; if (this.sock || !this.connected) return; this._connect().catch((e) => { diag.log('cync', `reconnect failed: ${e.message}`); if (!e.authExpired && !e.certUntrusted) this._reconnectLater(); }); }, wait);
    if (this._rt.unref) this._rt.unref();
  }
  _requestState() {
    const perHome = new Map(); for (const [sw, home] of this.switchHome) if (!perHome.has(home)) perHome.set(home, sw);
    for (const sw of perHome.values()) {
      try { this.sock.write(this._frame(null, 0x52, Buffer.from('0000ffff0000', 'hex'), sw, false)); } catch {}
    }
  }
  // Only tear down shared state if `sock` is still the active socket (a late close of an old one must not kill the new one).
  _dropSock(sock) { try { sock && sock.destroy(); } catch {} if (this.sock === sock) { this.loggedIn = false; clearInterval(this.ka); this.sock = null; } }
  _drop() { this.loggedIn = false; clearInterval(this.ka); try { this.sock && this.sock.destroy(); } catch {} this.sock = null; }

  _seq() { return (this.seq = (this.seq % 65535) + 1); }
  _iseq() { this.iseq = this.iseq && this.iseq < 0xfffffff0 ? this.iseq + 1 : 257; const b = Buffer.alloc(4); b.writeUInt32LE(this.iseq); return b; }
  // Outer frame: 0x73 (PIPE, protocol 3), payload length, Wi-Fi controller id, sequence, 0x00, then the inner frame
  // 0x7e [seq(4 LE) 0xf8 cmd len(2 LE) args checksum] 0x7e, with any 0x7e inside escaped as 0x7d 0x5e (pycync).
  _frame(dev, cmd, args, ctl, ctlCmd = true) {
    const seq = this._iseq(), a2 = ctlCmd ? Buffer.concat([seq, args]) : args, body = Buffer.concat([Buffer.from([cmd]), u16le(a2.length), a2]);
    let sum = 0; for (const x of body) sum = (sum + x) & 0xff;
    const inner = Buffer.concat([seq, Buffer.from([0xf8]), body, Buffer.from([sum])]), esc = [];
    for (const x of inner) { if (x === 0x7e) esc.push(0x7d, 0x5e); else esc.push(x); }
    const payload = Buffer.concat([u32(ctl || (dev && dev.native.switchId)), u16(this._seq()), Buffer.from([0, 0x7e]), Buffer.from(esc), Buffer.from([0x7e])]);
    return Buffer.concat([Buffer.from([0x73]), u32(payload.length), payload]);
  }
  _mesh2(dev) { return u16le(dev.native.mesh); }
  _power(dev, on, ctl) { return this._frame(dev, 0xd0, Buffer.from([0, dev.native.mesh & 0xff, (dev.native.group || 0) & 0xff, 0xd0, 0x11, 0x02, on ? 1 : 0, 0, 0]), ctl); }
  _combo(dev, on, bri, tone, rgb, ctl) { return this._frame(dev, 0xf0, Buffer.concat([Buffer.from([0]), this._mesh2(dev), Buffer.from([0xf0, 0x11, 0x02, on, bri, tone, rgb[0], rgb[1], rgb[2]])]), ctl); }
  _temp(dev, tone, ctl) { return this._frame(dev, 0xe2, Buffer.concat([Buffer.from([0]), this._mesh2(dev), Buffer.from([0xe2, 0x11, 0x02, 0x05, tone])]), ctl); }
  _packets(dev, p, ctl) {
    const bri = clamp(Math.round(p.brightness !== undefined ? p.brightness : (dev.brightness || 100)), 1, 100);
    const [lo, hi] = dev.kelvinRange;
    const toneOf = (k) => clamp(Math.round(((k - lo) / (hi - lo)) * 100), 0, 100);
    if (p.on === false) return [this._power(dev, false, ctl)];
    if (p.rgb) return [this._combo(dev, 1, bri, 254, p.rgb.map((v) => clamp(Math.round(v), 0, 255)), ctl)];
    if (p.kelvin) return [this._combo(dev, 1, bri, toneOf(p.kelvin), [0, 0, 0], ctl)];
    if (p.brightness === undefined) return [this._power(dev, true, ctl)];
    return [this._combo(dev, 1, bri, 255, [0, 0, 0], ctl)]; // tone 255 = change brightness only, keep the current colour
  }
  _waitAck(seqs, ms) {
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(t); for (const s of seqs) this.acks.delete(s); resolve(v); };
      const t = setTimeout(() => done(false), ms);
      for (const s of seqs) this.acks.set(s, done);
    });
  }
  // Resolves { confirmed: true } only when the relay acknowledges the command (packet 0x7b); otherwise it is
  // re-sent a few times and finally reported as unconfirmed. Never claims a delivery the service did not confirm.
  async setState(dev, p) {
    if (!dev.native.switchId) throw new Error('This Cync bulb is Bluetooth-only and its Cync home has no Wi-Fi Cync device, so the cloud cannot reach it.');
    let connFails = 0;
    for (let attempt = 0; attempt < this.o.ackTries;) {
      try { await this._connect(); }
      catch (e) {
        this._drop();
        if (e.authExpired || e.certUntrusted) throw e;
        if (++connFails >= 2) throw new Error('Cync relay unreachable: ' + e.message);
        continue;
      }
      const ctls = dev.native.controllers && dev.native.controllers.length ? dev.native.controllers : [dev.native.switchId];
      const ctl = ctls[attempt % ctls.length]; // no answer through one Wi-Fi Cync device: try the next one in the home
      const packets = this._packets(dev, p, ctl);
      const acked = this._waitAck(packets.map((pk) => pk.readUInt16BE(9)), this.o.ackWait);
      try { for (const pk of packets) this.sock.write(pk); } catch { this._drop(); }
      attempt++;
      if (await acked) return { confirmed: true };
    }
    diag.log('cync', `no acknowledgement from relay after ${this.o.ackTries} tries (deviceType=${dev.native.deviceType} mesh=${dev.native.mesh})`);
    return { confirmed: false };
  }
  async refresh(dev) { return this.states.get(dev.native.deviceID) || {}; }
  disconnect() { clearTimeout(this._rt); this._rt = null; this.store.setSecret('cync_auth', null); this.store.setSecret('cync_relay_pin', null); this._drop(); this.states.clear(); this.pending2fa = null; }
}
// Mesh index of a bulb inside its home, exactly as the reference cync_lights client derives it.
// Mesh address of a bulb inside its home (pycync): r = deviceID mod homeID; id = r mod 1000, group = r div 1000.
function meshIndex(deviceID, homeId) {
  try { const r = Number(BigInt(deviceID) % BigInt(homeId)); return { id: r % 1000, group: Math.floor(r / 1000) }; }
  catch { return { id: parseInt(String(deviceID).slice(-3), 10) || 0, group: 0 }; }
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(Number(n) >>> 0); return b; }
function u16le(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; }
module.exports = { CyncProvider };
