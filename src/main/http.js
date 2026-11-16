'use strict';
// Minimal HTTP(S) client on node:http(s). Used instead of fetch() because the Hubspace/Afero cloud expects a
// custom Host header on API calls, and fetch() (undici) silently ignores that header.
const http = require('http');
const https = require('https');
const zlib = require('zlib');

function request(method, url, { headers = {}, body, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const h = { ...headers };
    let payload = null;
    if (body !== undefined && body !== null) { payload = Buffer.from(String(body)); h['content-length'] = payload.length; }
    const req = lib.request({ method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        try {
          const enc = res.headers['content-encoding'];
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch { /* leave as is */ }
        resolve({ status: res.statusCode, headers: res.headers, setCookie: res.headers['set-cookie'] || [], text: buf.toString('utf8') });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Tiny cookie jar (name=value only; enough for a single Keycloak login session).
class Jar {
  constructor() { this.c = new Map(); }
  add(setCookie) { for (const s of setCookie || []) { const [kv] = s.split(';'); const i = kv.indexOf('='); if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

module.exports = { request, Jar };
