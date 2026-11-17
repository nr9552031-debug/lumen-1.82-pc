'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PhoneScanReceiver, safeName, validateScanFile } = require('../src/main/phone-scan');

function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

async function main() {
  assert.strictEqual(safeName('leaf.obj'), 'leaf.obj');
  assert.throws(() => safeName('../secret.txt'), /OBJ/);
  assert.throws(() => validateScanFile('broken.gltf', Buffer.from('{}')), /glTF 2.0/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-phone-scan-')); let saved = null;
  const receiver = new PhoneScanReceiver({ directory: dir, onScan: (s) => { saved = s; } });
  try {
    const s = await receiver.start('scan-project'), address = `http://127.0.0.1:${s.port}`;
    assert.strictEqual(s.scan.projectId, 'scan-project', 'keeps phone uploads associated with their Projection Studio project');
    const page = await request(address); assert.strictEqual(page.status, 200); assert(page.body.includes('Send scan to Lumen')); assert(page.body.includes('/complete?code='), 'phone upload page closes pairing when all selected files finish uploading');
    assert.strictEqual((await request(`${address}/complete?code=${s.code}`, { method: 'POST' })).status, 400, 'does not complete a scan before any files arrive');
    const obj = Buffer.from('o leaf\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    const denied = await request(`${address}/upload?code=00000000&name=leaf.obj`, { method: 'PUT', body: obj }); assert.strictEqual(denied.status, 401, 'rejects incorrect pairing codes');
    const uploaded = await request(`${address}/upload?code=${s.code}&name=leaf.obj`, { method: 'PUT', body: obj });
    assert.strictEqual(uploaded.status, 200); assert.deepStrictEqual(fs.readFileSync(path.join(dir, s.scan.id, 'leaf.obj')), obj);
    const badModel = await request(`${address}/upload?code=${s.code}&name=bad.glb`, { method: 'PUT', body: Buffer.from('invalid') }); assert.strictEqual(badModel.status, 400, 'rejects invalid GLB signatures');
    const photo = Buffer.from('89504e470d0a1a0a', 'hex');
    const uploadedPhoto = await request(`${address}/upload?code=${s.code}&name=leaf.png`, { method: 'PUT', body: photo }); assert.strictEqual(uploadedPhoto.status, 200);
    const gltf = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }], images: [{ uri: 'leaf.png' }] }));
    const uploadedGltf = await request(`${address}/upload?code=${s.code}&name=scene.gltf`, { method: 'PUT', body: gltf }); assert.strictEqual(uploadedGltf.status, 200);
    const uploadedBin = await request(`${address}/upload?code=${s.code}&name=mesh.bin`, { method: 'PUT', body: Buffer.from([1, 2, 3, 4]) }); assert.strictEqual(uploadedBin.status, 200, 'accepts standard external glTF binary buffers');
    const plantObj = Buffer.from('mtllib plant.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    assert.strictEqual((await request(`${address}/upload?code=${s.code}&name=plant.obj`, { method: 'PUT', body: plantObj })).status, 200);
    assert.strictEqual((await request(`${address}/upload?code=${s.code}&name=plant.mtl`, { method: 'PUT', body: Buffer.from('newmtl leaf\nmap_Kd leaf.png\n') })).status, 200);
    assert.deepStrictEqual(receiver.dependencies(s.scan.id, 'scene.gltf').map((x) => x.name).sort(), ['leaf.png', 'mesh.bin'], 'discovers glTF external buffers and texture assets');
    assert.deepStrictEqual(receiver.dependencies(s.scan.id, 'plant.obj').map((x) => x.name).sort(), ['leaf.png', 'plant.mtl'], 'discovers OBJ material libraries and their textures');
    const remoteGltf = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.invalid/mesh.bin' }] }));
    fs.writeFileSync(path.join(dir, s.scan.id, 'remote.gltf'), remoteGltf);
    assert.throws(() => receiver.dependencies(s.scan.id, 'remote.gltf'), /Only files included/, 'refuses remote model dependencies');
    const deniedComplete = await request(`${address}/complete?code=00000000`, { method: 'POST' }); assert.strictEqual(deniedComplete.status, 401, 'requires the pairing code to close the session');
    const complete = await request(`${address}/complete?code=${s.code}`, { method: 'POST' }); assert.strictEqual(complete.status, 200, 'accepts completion after the full phone upload');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(receiver.snapshot().active, false, 'automatically closes pairing after phone upload completion');
    assert.strictEqual(saved.files.length, 6, 'persists all uploaded scan models, buffers and textures on automatic completion');
  } finally { receiver.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('Phone scan checks passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
