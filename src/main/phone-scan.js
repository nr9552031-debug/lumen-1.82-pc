'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAX_FILE = 100 * 1024 * 1024;
const MAX_FILES = 32;
const EXTENSIONS = new Set(['.obj', '.mtl', '.glb', '.gltf', '.ply', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);

function safeName(value) {
  const name = path.basename(String(value || '')).replace(/[\x00-\x1f]/g, '').trim();
  if (!name || name.length > 180 || !EXTENSIONS.has(path.extname(name).toLowerCase())) throw new Error('Use OBJ, MTL, GLB, GLTF, PLY, BIN, PNG, JPG, WEBP or TIFF files.');
  return name;
}

function lanAddresses() {
  const all = Object.values(os.networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && !x.internal).map((x) => x.address);
  return [...new Set(all)];
}

function validateScanFile(name, data) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.glb' && (data.length < 20 || data.subarray(0, 4).toString() !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) > data.length)) throw new Error('This GLB file does not have a valid glTF 2.0 header.');
  if (ext === '.gltf') { try { const j = JSON.parse(data.toString('utf8')); if (!j.asset || !String(j.asset.version || '').startsWith('2')) throw new Error(); } catch { throw new Error('This GLTF file is not valid glTF 2.0 JSON.'); } }
  if (ext === '.obj') { const t = data.subarray(0, 2 * 1024 * 1024).toString('utf8'); if (!/^\s*(?:v|#|mtllib|o|g)\s/m.test(t) || !/^\s*f\s/m.test(t)) throw new Error('This OBJ file must contain vertices and faces.'); }
  if (ext === '.ply' && !/^ply\s+[\s\S]{0,4096}?end_header\s/m.test(data.subarray(0, 8192).toString('ascii'))) throw new Error('This PLY file has no valid header.');
  if (ext === '.png' && (data.length < 8 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')) throw new Error('This PNG file has an invalid signature.');
  if (['.jpg', '.jpeg'].includes(ext) && (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9)) throw new Error('This JPEG file has an invalid signature.');
  if (ext === '.webp' && (data.subarray(0, 4).toString() !== 'RIFF' || data.subarray(8, 12).toString() !== 'WEBP')) throw new Error('This WEBP file has an invalid signature.');
  if (['.tif', '.tiff'].includes(ext) && !['49492a00', '4d4d002a', '49492b00', '4d4d002b'].includes(data.subarray(0, 4).toString('hex'))) throw new Error('This TIFF file has an invalid signature.');
}

function localResourceName(uri) {
  if (typeof uri !== 'string' || !uri || /^data:/i.test(uri)) return null;
  let decoded;
  try { decoded = decodeURIComponent(uri.split(/[?#]/, 1)[0]); } catch { throw new Error('The model references an invalid linked filename.'); }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('/') || decoded.startsWith('\\')) throw new Error('Only files included in this scan can be used as model dependencies.');
  const name = path.basename(decoded.replace(/\\/g, '/'));
  return safeName(name);
}

class PhoneScanReceiver extends EventEmitter {
  constructor({ directory, onScan }) {
    super(); this.directory = directory; this.onScan = onScan; this.server = null; this.code = null; this.expires = 0; this.scan = null; this.failures = new Map();
  }
  async start(projectId = '') {
    if (this.server) return this.snapshot();
    this.code = String(crypto.randomInt(0, 100000000)).padStart(8, '0'); this.expires = Date.now() + 10 * 60 * 1000;
    this.scan = { id: `scan-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, projectId: /^[\w-]{1,40}$/.test(String(projectId)) ? String(projectId) : '', createdAt: new Date().toISOString(), files: [] };
    this.server = http.createServer((req, res) => this._handle(req, res));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '0.0.0.0', resolve); });
    this.server.removeAllListeners('error');
    this.emit('status', this.snapshot()); return this.snapshot();
  }
  snapshot() {
    const address = this.server && this.server.address();
    return { active: !!this.server, code: this.server ? this.code : null, expiresAt: this.server ? new Date(this.expires).toISOString() : null, port: address && address.port, addresses: this.server ? lanAddresses() : [], scan: this.scan ? { id: this.scan.id, projectId: this.scan.projectId, createdAt: this.scan.createdAt, files: this.scan.files.slice() } : null };
  }
  stop() {
    const s = this.server; this.server = null; this.code = null; this.expires = 0;
    if (s) s.close();
    if (this.scan && this.scan.files.length && this.onScan) this.onScan(this.scan);
    this.emit('status', this.snapshot()); return this.snapshot();
  }
  read(scanId, name) {
    if (!/^scan-[a-z0-9-]{1,48}$/i.test(String(scanId || ''))) throw new Error('Invalid scan ID.');
    name = safeName(name);
    const file = path.join(this.directory, scanId, name), root = path.resolve(this.directory, scanId) + path.sep;
    if (!path.resolve(file).startsWith(root)) throw new Error('Invalid scan file path.');
    const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('Scan file is missing or exceeds the preview limit.');
    const data = fs.readFileSync(file); validateScanFile(name, data);
    return { name, type: path.extname(name).toLowerCase(), data: data.toString('base64') };
  }
  dependencies(scanId, modelName) {
    if (!/^scan-[a-z0-9-]{1,48}$/i.test(String(scanId || ''))) throw new Error('Invalid scan ID.');
    modelName = safeName(modelName);
    const dir = path.join(this.directory, scanId), diskNames = fs.readdirSync(dir), byLower = new Map(diskNames.map((name) => [name.toLowerCase(), name]));
    const readText = (uri) => {
      const name = localResourceName(uri); if (!name) return null;
      const actual = byLower.get(name.toLowerCase());
      if (!actual) throw new Error(`The scan is missing linked file “${name}”. Upload the model and its linked files together.`);
      const full = path.join(dir, actual), stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE) throw new Error(`Linked file “${name}” exceeds the preview limit.`);
      return { name: actual, text: fs.readFileSync(full).subarray(0, 2 * 1024 * 1024).toString('utf8') };
    };
    const dependencies = new Map(), ext = path.extname(modelName).toLowerCase();
    if (ext === '.gltf') {
      let gltf; try { gltf = JSON.parse(Buffer.from(this.read(scanId, modelName).data, 'base64').toString('utf8')); } catch { throw new Error('This GLTF file is not valid JSON.'); }
      if (!gltf || typeof gltf !== 'object') throw new Error('This GLTF file is not valid JSON.');
      for (const resource of [...(Array.isArray(gltf.buffers) ? gltf.buffers : []), ...(Array.isArray(gltf.images) ? gltf.images : [])]) {
        if (!resource || !resource.uri) continue;
        const name = localResourceName(resource.uri);
        if (!name) continue;
        const actual = byLower.get(name.toLowerCase());
        if (!actual) throw new Error(`The scan is missing linked file “${name}”. Upload the model and its linked files together.`);
        const stat = fs.statSync(path.join(dir, actual)); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error(`Linked file “${name}” exceeds the preview limit.`);
        dependencies.set(actual.toLowerCase(), { name: actual, size: stat.size });
      }
    } else if (ext === '.obj') {
      const obj = this.read(scanId, modelName), text = Buffer.from(obj.data, 'base64').subarray(0, 2 * 1024 * 1024).toString('utf8');
      const materialUris = [...text.matchAll(/^\s*mtllib\s+(.+)$/gm)].flatMap((match) => match[1].trim().split(/\s+/));
      for (const uri of materialUris) {
        const material = readText(uri); if (!material) continue;
        dependencies.set(material.name.toLowerCase(), { name: material.name, size: fs.statSync(path.join(dir, material.name)).size });
        for (const line of material.text.split(/\r?\n/)) {
          const tokens = line.trim().split(/\s+/); if (!/^(?:map_|bump$|norm$|disp$|decal$|refl$)/i.test(tokens[0]) || tokens.length < 2) continue;
          const image = readText(tokens[tokens.length - 1]); if (!image) continue;
          dependencies.set(image.name.toLowerCase(), { name: image.name, size: fs.statSync(path.join(dir, image.name)).size });
        }
      }
    }
    return [...dependencies.values()];
  }
  async _handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Send scan to Lumen</title><style>body{font:17px system-ui;max-width:620px;margin:10vh auto;padding:24px;background:#111827;color:#eef}button,input{font:inherit;padding:12px;margin:8px 0}button{background:#53a7ff;border:0;border-radius:8px}small{color:#bbc}</style><h1>Send scan to Lumen</h1><p>Select your scan model, textures, or photos. Keep related files together in the selection.</p><input id="files" type="file" multiple accept=".obj,.mtl,.glb,.gltf,.ply,.bin,.png,.jpg,.jpeg,.webp,.tif,.tiff"><br><button id="send">Upload selected files</button><p id="s"></p><small>Files go directly to Lumen on your local network and are saved with this Projection Studio project.</small><script>const code=new URLSearchParams(location.search).get('code');document.querySelector('#send').onclick=async()=>{let fs=[...document.querySelector('#files').files],s=document.querySelector('#s');if(!fs.length)return s.textContent='Choose at least one file.';if(fs.length>32)return s.textContent='Choose no more than 32 files.';for(let i=0;i<fs.length;i++){s.textContent='Uploading '+(i+1)+' of '+fs.length+'…';let f=fs[i],r=await fetch('/upload?code='+encodeURIComponent(code)+'&name='+encodeURIComponent(f.name),{method:'PUT',body:f});let j=await r.json();if(!r.ok)return s.textContent=j.error||'Upload failed.'}s.textContent='Saving scan and starting the automatic projection pipeline…';let done=await fetch('/complete?code='+encodeURIComponent(code),{method:'POST'}),j=await done.json();s.textContent=done.ok?'Upload complete. Lumen is processing your scan; return to the app.':j.error||'Upload completed, but Lumen could not close the pairing session.'};</script>`;
    const reply = (status, data, type = 'application/json') => { res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(type === 'text/html' ? data : JSON.stringify(data)); };
    if (req.method === 'GET' && url.pathname === '/') return reply(200, page, 'text/html');
    if (req.method === 'POST' && url.pathname === '/complete') {
      const ip = req.socket.remoteAddress || 'unknown', failures = this.failures.get(ip) || 0;
      if (failures >= 12) return reply(429, { error: 'Too many invalid codes. Restart phone pairing from Lumen.' });
      if (!this.server || Date.now() > this.expires || url.searchParams.get('code') !== this.code) { this.failures.set(ip, failures + 1); return reply(401, { error: 'Pairing code is incorrect or expired.' }); }
      if (!this.scan || !this.scan.files.length) return reply(400, { error: 'Upload at least one scan file before completing the upload.' });
      reply(200, { ok: true }); setTimeout(() => this.stop(), 50); return;
    }
    if (req.method !== 'PUT' || url.pathname !== '/upload') return reply(404, { error: 'Not found.' });
    const ip = req.socket.remoteAddress || 'unknown', failures = this.failures.get(ip) || 0;
    if (failures >= 12) return reply(429, { error: 'Too many invalid codes. Restart phone pairing from Lumen.' });
    if (!this.server || Date.now() > this.expires || url.searchParams.get('code') !== this.code) { this.failures.set(ip, failures + 1); return reply(401, { error: 'Pairing code is incorrect or expired.' }); }
    let name;
    try { name = safeName(url.searchParams.get('name')); } catch (e) { return reply(400, { error: e.message }); }
    if (this.scan.files.length >= MAX_FILES) return reply(413, { error: `A scan can contain at most ${MAX_FILES} files.` });
    if (Number(req.headers['content-length'] || 0) > MAX_FILE) return reply(413, { error: 'Each file must be smaller than 100 MB.' });
    const chunks = []; let size = 0;
    try {
      for await (const chunk of req) { size += chunk.length; if (size > MAX_FILE) throw new Error('Each file must be smaller than 100 MB.'); chunks.push(chunk); }
      const data = Buffer.concat(chunks); if (!data.length) return reply(400, { error: 'The selected file is empty.' });
      const ext = path.extname(name).toLowerCase();
      try { validateScanFile(name, data); } catch (e) { return reply(400, { error: e.message }); }
      const targetDir = path.join(this.directory, this.scan.id); fs.mkdirSync(targetDir, { recursive: true });
      let finalName = name, n = 1; while (fs.existsSync(path.join(targetDir, finalName))) { const parsed = path.parse(name); finalName = `${parsed.name}-${n++}${parsed.ext}`; }
      fs.writeFileSync(path.join(targetDir, finalName), data, { flag: 'wx' });
      const file = { name: finalName, size, type: ['.obj', '.glb', '.gltf', '.ply'].includes(ext) ? 'model' : 'texture-or-photo' };
      this.scan.files.push(file); this.emit('status', this.snapshot());
      reply(200, { ok: true, file });
    } catch (e) { reply(e.message.includes('100 MB') ? 413 : 500, { error: e.message }); }
  }
}

module.exports = { PhoneScanReceiver, safeName, validateScanFile, lanAddresses, MAX_FILE, MAX_FILES };
