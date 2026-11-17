'use strict';
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;
const DEFAULT_URL = 'http://127.0.0.1:8188';
const MAX_OUTPUT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_JOB_BYTES = 250 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function safeComfyUrl(value) {
  const url = new URL(String(value || DEFAULT_URL));
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || /^127\./.test(url.hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (!local && url.protocol !== 'https:')) {
    throw new Error('ComfyUI must use localhost HTTP or a trusted HTTPS endpoint without embedded credentials.');
  }
  return url.origin;
}

function parseWorkflow(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_WORKFLOW_BYTES) throw new Error('Workflow JSON must be smaller than 10 MB.');
  let graph;
  try { graph = JSON.parse(raw); } catch { throw new Error('Workflow file is not valid JSON.'); }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || graph.nodes || graph.links || graph.extra) throw new Error('Use ComfyUI Workflow → Export (API), not the editor layout JSON.');
  const nodes = Object.entries(graph);
  if (!nodes.length || nodes.length > 10000) throw new Error('API workflow must contain between 1 and 10,000 nodes.');
  const ids = new Set(nodes.map(([id]) => id));
  const classes = new Set();
  for (const [id, node] of nodes) {
    if (!/^\d+$/.test(id) || !node || typeof node !== 'object' || typeof node.class_type !== 'string' || !node.class_type || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) throw new Error(`Invalid API node ${id}.`);
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /^\d+$/.test(value[0]) && Number.isInteger(value[1]) && !ids.has(value[0])) throw new Error(`Node ${id} input ${input} references missing node ${value[0]}.`);
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /^\d+$/.test(value[0]) && Number.isInteger(value[1]) && value[1] < 0) throw new Error(`Node ${id} input ${input} references an invalid output index.`);
    }
    classes.add(node.class_type);
  }
  return { graph, nodeCount: nodes.length, classes: [...classes], nodes: nodes.map(([id, node]) => ({ id, classType: node.class_type, parameters: Object.keys(node.inputs) })) };
}

function pngDimensions(data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('The selected file is not a valid PNG image.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!((width === 1280 && height === 720) || (width === 1920 && height === 1080))) throw new Error('PNG images must be exactly 1280×720 or 1920×1080.');
  return { width, height };
}

function decodePngDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Only PNG image data can be uploaded.');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_WORKFLOW_BYTES) throw new Error('PNG must be smaller than 10 MB.');
  pngDimensions(bytes);
  return bytes;
}

function inputSpec(info, node, name) {
  const spec = info && info[node.class_type] && info[node.class_type].input;
  if (!spec || typeof spec !== 'object') return null;
  for (const group of ['required', 'optional', 'hidden']) {
    if (spec[group] && Object.hasOwn(spec[group], name)) return { value: spec[group][name], group };
  }
  return null;
}

function isImageUploadSpec(spec) {
  return Array.isArray(spec) && spec[1] && typeof spec[1] === 'object' && spec[1].image_upload === true;
}

function applyBindings(graph, info, bindings = {}, assets = {}) {
  const copy = structuredClone(graph), used = new Set(), bound = [];
  for (const role of ['photo', 'mask']) {
    const filename = String(assets[role] || '');
    if (!filename) continue;
    if (filename !== path.basename(filename) || !/^[\w.-]{1,100}\.png$/i.test(filename)) throw new Error(`The uploaded ${role} filename is invalid.`);
    const target = bindings[role];
    if (!target || typeof target !== 'object') throw new Error(`Choose the ComfyUI image input for the uploaded ${role}.`);
    const nodeId = String(target.nodeId || ''), inputName = String(target.inputName || '');
    const node = copy[nodeId], spec = node && inputSpec(info, node, inputName);
    if (!node || !spec || !isImageUploadSpec(spec.value)) throw new Error(`The selected ${role} target is not an image-upload input in the installed ComfyUI schema.`);
    const key = `${nodeId}:${inputName}`;
    if (used.has(key)) throw new Error('The base photo and surface mask must use separate ComfyUI image inputs.');
    used.add(key); node.inputs[inputName] = filename; bound.push({ role, nodeId, inputName, filename });
  }
  return { graph: copy, bound };
}

function validateAgainstInfo(parsed, info) {
  const issues = [], imageInputs = [];
  for (const [id, node] of Object.entries(parsed.graph)) {
    const schema = info[node.class_type];
    if (!schema || typeof schema !== 'object') continue;
    const inputGroups = schema.input || {};
    if (!inputGroups || typeof inputGroups !== 'object' || !Object.keys(inputGroups).length) continue;
    for (const [name, spec] of Object.entries(inputGroups.required || {})) {
      if (!Object.hasOwn(node.inputs, name)) issues.push(`Node ${id} (${node.class_type}) is missing required input “${name}”.`);
      if (isImageUploadSpec(spec)) imageInputs.push({ nodeId: id, classType: node.class_type, inputName: name, currentName: typeof node.inputs[name] === 'string' ? node.inputs[name] : '' });
    }
    for (const [name, spec] of Object.entries(inputGroups.optional || {})) {
      if (isImageUploadSpec(spec)) imageInputs.push({ nodeId: id, classType: node.class_type, inputName: name, currentName: typeof node.inputs[name] === 'string' ? node.inputs[name] : '' });
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      const found = inputSpec(info, node, name);
      if (!found) { issues.push(`Node ${id} (${node.class_type}) has unknown input “${name}”.`); continue; }
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && /^\d+$/.test(value[0]) && Number.isInteger(value[1])) {
        const source = parsed.graph[value[0]], outputs = info[source.class_type] && info[source.class_type].output;
        if (Array.isArray(outputs) && value[1] >= outputs.length) issues.push(`Node ${id} input “${name}” links to an output that does not exist on node ${value[0]}.`);
        else if (Array.isArray(outputs) && typeof outputs[value[1]] === 'string') {
          const declared = found.value, targetType = Array.isArray(declared) ? declared[0] : declared, sourceType = outputs[value[1]];
          if (typeof targetType === 'string' && targetType !== '*' && sourceType !== '*' && targetType !== sourceType) issues.push(`Node ${id} input “${name}” expects ${targetType} but node ${value[0]} provides ${sourceType}.`);
        }
        continue;
      }
      const declared = found.value, type = Array.isArray(declared) ? declared[0] : declared;
      if (Array.isArray(type) && !type.some((option) => option === value)) {
        const label = /(?:ckpt|checkpoint|model|vae|lora)/i.test(name) ? 'model selection' : 'selection';
        issues.push(`Node ${id} input “${name}” has a ${label} not available in ComfyUI.`);
      } else if (type === 'INT' && (!Number.isInteger(value))) issues.push(`Node ${id} input “${name}” must be a whole number.`);
      else if (type === 'FLOAT' && (typeof value !== 'number' || !Number.isFinite(value))) issues.push(`Node ${id} input “${name}” must be a number.`);
      else if (type === 'BOOLEAN' && typeof value !== 'boolean') issues.push(`Node ${id} input “${name}” must be true or false.`);
      else if (type === 'STRING' && typeof value !== 'string') issues.push(`Node ${id} input “${name}” must be text.`);
    }
  }
  const unique = new Map(imageInputs.map((x) => [`${x.nodeId}:${x.inputName}`, x]));
  return { issues: [...new Set(issues)], imageInputs: [...unique.values()] };
}

function buildScanWorkflow(info, { photoName, maskName, prompt = '' } = {}) {
  const required = (classType, name) => {
    const schema = info && info[classType], spec = schema && schema.input && schema.input.required && schema.input.required[name];
    if (!spec) throw new Error(`ComfyUI cannot build the scan workflow: ${classType}.${name} is unavailable.`);
    return spec;
  };
  const choice = (classType, name, preferred) => {
    const spec = required(classType, name), values = Array.isArray(spec) && spec[0];
    if (!Array.isArray(values) || !values.length) throw new Error(`ComfyUI does not report an installed ${name} choice for ${classType}.`);
    const available = values.filter((value) => value !== 'None' && value !== '' && value != null);
    if (!available.length) throw new Error(`ComfyUI has no installed ${name} choice for ${classType}.`);
    return available.includes(preferred) ? preferred : available[0];
  };
  for (const classType of ['CheckpointLoaderSimple', 'LoadImage', 'LoadImageMask', 'CLIPTextEncode', 'InpaintModelConditioning', 'KSampler', 'VAEDecode', 'SaveImage']) {
    if (!info || !info[classType]) throw new Error(`ComfyUI is missing the built-in ${classType} node needed for automatic scan inpainting.`);
  }
  for (const [classType, input] of [['LoadImage', 'image'], ['LoadImageMask', 'image']]) {
    if (!isImageUploadSpec(required(classType, input))) throw new Error(`ComfyUI ${classType}.${input} is not an image-upload input.`);
  }
  if (!photoName || !maskName) throw new Error('The automatic scan workflow needs both the rendered photo and surface mask.');
  const defaultPrompt = 'Create a projection-mapped visual treatment for the scanned subject. Preserve its recognizable silhouette and proportions; add vivid luminous color, rich surface detail and cinematic lighting. Keep all important detail within the scanned surface mask.';
  const safePrompt = String(prompt || '').trim().slice(0, 2000) || defaultPrompt;
  const graph = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: choice('CheckpointLoaderSimple', 'ckpt_name') } },
    '2': { class_type: 'LoadImage', inputs: { image: path.basename(photoName) } },
    '3': { class_type: 'LoadImageMask', inputs: { image: path.basename(maskName), channel: choice('LoadImageMask', 'channel', 'red') } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: safePrompt, clip: ['1', 1] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark, logo, border, cropped subject, distorted geometry, low detail', clip: ['1', 1] } },
    '6': { class_type: 'InpaintModelConditioning', inputs: { positive: ['4', 0], negative: ['5', 0], vae: ['1', 2], pixels: ['2', 0], mask: ['3', 0], noise_mask: true } },
    '7': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['6', 0], negative: ['6', 1], latent_image: ['6', 2], seed: Math.floor(Math.random() * 0x100000000), steps: 24, cfg: 6.5, sampler_name: choice('KSampler', 'sampler_name'), scheduler: choice('KSampler', 'scheduler'), denoise: 0.72 } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'lumen_projection' } },
  };
  const issues = validateAgainstInfo({ graph }, info).issues;
  if (issues.length) throw new Error(`ComfyUI's installed nodes cannot run the automatic inpainting workflow: ${issues.slice(0, 4).join(' ')}`);
  return { raw: JSON.stringify(graph), bindings: { photo: { nodeId: '2', inputName: 'image' }, mask: { nodeId: '3', inputName: 'image' } }, nodeCount: Object.keys(graph).length };
}

async function createScanWorkflow(urlValue, photoName, maskName, prompt) {
  const info = await request(safeComfyUrl(urlValue), '/object_info');
  return buildScanWorkflow(info, { photoName, maskName, prompt });
}

async function request(url, path, options = {}) {
  const response = await fetch(url + path, { ...options, signal: AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(15000)]) });
  const body = await response.text();
  if (!response.ok) throw new Error(`ComfyUI returned HTTP ${response.status}: ${body.slice(0, 1000)}`);
  try { return JSON.parse(body); } catch { throw new Error('ComfyUI returned an unreadable response.'); }
}

async function inspect(urlValue) {
  const url = safeComfyUrl(urlValue);
  const [objectInfo, queue] = await Promise.all([request(url, '/object_info'), request(url, '/queue')]);
  return { nodeClasses: Object.keys(objectInfo), queue: { running: (queue.queue_running || []).length, pending: (queue.queue_pending || []).length } };
}

async function validateAgainstServer(urlValue, raw, options = {}) {
  const parsed = parseWorkflow(raw), url = safeComfyUrl(urlValue);
  const [info, queue] = await Promise.all([request(url, '/object_info'), request(url, '/queue')]);
  const missing = parsed.classes.filter((name) => !Object.hasOwn(info, name));
  let bindings = { graph: parsed.graph, bound: [] }, bindingIssue = '';
  try { bindings = applyBindings(parsed.graph, info, options.bindings, options.assets); }
  catch (error) { bindingIssue = error.message; }
  const validation = validateAgainstInfo({ graph: bindings.graph }, info);
  return { nodeCount: parsed.nodeCount, classes: parsed.classes, missing, issues: [...(bindingIssue ? [bindingIssue] : []), ...validation.issues], imageInputs: validation.imageInputs, bound: bindings.bound, queue: { running: (queue.queue_running || []).length, pending: (queue.queue_pending || []).length } };
}

async function queueWorkflow(urlValue, raw, options = {}) {
  const url = safeComfyUrl(urlValue), { graph, classes, nodeCount } = parseWorkflow(raw);
  const available = await request(url, '/object_info', options);
  const missing = classes.filter((name) => !Object.hasOwn(available, name));
  if (missing.length) throw new Error(`ComfyUI is missing required node types: ${missing.join(', ')}`);
  const { graph: boundGraph, bound } = applyBindings(graph, available, options.bindings, options.assets);
  const issues = validateAgainstInfo({ graph: boundGraph }, available).issues;
  if (issues.length) throw new Error(`Workflow does not match the installed ComfyUI inputs: ${issues.slice(0, 6).join(' ')}`);
  const clientId = randomUUID();
  const result = await request(url, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: boundGraph, client_id: clientId }), signal: options.signal });
  if (result.node_errors && Object.keys(result.node_errors).length) throw new Error(`ComfyUI rejected workflow nodes: ${JSON.stringify(result.node_errors).slice(0, 2000)}`);
  if (!result.prompt_id) throw new Error('ComfyUI did not return a prompt ID.');
  return { promptId: result.prompt_id, clientId, nodeCount, bound };
}

async function uploadPng(urlValue, filename, dataUrl, options = {}) {
  const url = safeComfyUrl(urlValue);
  filename = String(filename || '');
  if (filename !== filename.split(/[\\/]/).pop() || !/^[\w.-]{1,100}\.png$/i.test(filename) || filename === '.' || filename === '..') throw new Error('Choose a PNG file with a simple filename.');
  const bytes = decodePngDataUrl(dataUrl);
  const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/png' }), filename); form.append('overwrite', 'true');
  const response = await fetch(url + '/upload/image', { method: 'POST', body: form, signal: AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(30000)]) });
  const body = await response.text();
  if (!response.ok) throw new Error(`ComfyUI image upload failed (HTTP ${response.status}): ${body.slice(0, 1000)}`);
  let result; try { result = JSON.parse(body); } catch { throw new Error('ComfyUI returned an unreadable image-upload response.'); }
  if (!result.name) throw new Error('ComfyUI did not confirm the uploaded image name.');
  return { name: result.name, subfolder: result.subfolder || '', type: result.type || 'input' };
}

async function history(urlValue, promptId) {
  if (!/^[a-f0-9-]{16,64}$/i.test(String(promptId))) throw new Error('Invalid ComfyUI prompt ID.');
  const result = await request(safeComfyUrl(urlValue), `/history/${encodeURIComponent(promptId)}`);
  return result[promptId] || null;
}

function mediaItems(entry) {
  const seen = new Set(), items = [];
  for (const outputs of Object.values(entry && entry.outputs || {})) {
    if (!outputs || typeof outputs !== 'object') continue;
    for (const key of ['images', 'gifs', 'videos']) for (const item of Array.isArray(outputs[key]) ? outputs[key] : []) {
      if (!item || typeof item !== 'object' || typeof item.filename !== 'string') continue;
      if (item.filename !== path.basename(item.filename) || !/^[\w.-]{1,180}$/.test(item.filename)) continue;
      const ext = path.extname(item.filename).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov'].includes(ext)) continue;
      const type = item.type || 'output', subfolder = String(item.subfolder || '');
      if (!['output', 'temp'].includes(type) || (subfolder && subfolder.split(/[\\/]/).some((part) => !/^[\w .-]{1,80}$/.test(part) || part === '..' || part === '.'))) continue;
      const key = `${type}:${subfolder}:${item.filename}`;
      if (!seen.has(key)) { seen.add(key); items.push({ filename: item.filename, subfolder, type }); }
    }
  }
  return items.slice(0, 40);
}

function mediaSignature(name, data) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.subarray(12, 16).toString('ascii') === 'IHDR' && data.readUInt32BE(16) > 0 && data.readUInt32BE(20) > 0;
  if (['.jpg', '.jpeg'].includes(ext)) return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9;
  if (ext === '.webp') return data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (ext === '.gif') return data.subarray(0, 6).toString('ascii').startsWith('GIF8');
  if (['.mp4', '.mov'].includes(ext)) return data.length >= 12 && data.subarray(4, 8).toString('ascii') === 'ftyp';
  if (ext === '.webm') return data.length >= 4 && data.subarray(0, 4).toString('hex') === '1a45dfa3';
  return false;
}

async function downloadMedia(url, item, signal) {
  const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: item.type });
  const response = await fetch(`${url}/view?${query}`, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(60000)]) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`ComfyUI output download failed (HTTP ${response.status}).`); }
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_OUTPUT_FILE_BYTES) { await response.body?.cancel(); throw new Error('A generated file exceeds the 100 MB save limit.'); }
  const reader = response.body && response.body.getReader();
  if (!reader) throw new Error('ComfyUI returned an empty output.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_OUTPUT_FILE_BYTES) { await reader.cancel(); throw new Error('A generated file exceeds the 100 MB save limit.'); }
    chunks.push(Buffer.from(value));
  }
  const data = Buffer.concat(chunks, size);
  if (!mediaSignature(item.filename, data)) throw new Error(`ComfyUI output ${item.filename} has an unexpected or invalid media format.`);
  return data;
}

async function saveOutputs(urlValue, promptId, directory, projectId, options = {}) {
  if (!/^[a-f0-9-]{16,64}$/i.test(String(promptId))) throw new Error('Invalid ComfyUI prompt ID.');
  projectId = String(projectId || '');
  if (!/^[\w-]{1,40}$/.test(projectId)) throw new Error('Open a saved Projection Studio project before saving generated media.');
  const url = safeComfyUrl(urlValue), entry = await history(url, promptId), items = mediaItems(entry);
  if (!entry || !items.length) return { saved: [], status: entry ? 'No supported image or video outputs are available yet.' : 'The workflow is still queued or running.' };
  const root = path.resolve(directory, 'projection-generated', projectId, promptId);
  await fs.promises.mkdir(root, { recursive: true });
  const saved = [], created = []; let total = 0;
  try {
    for (const [index, item] of items.entries()) {
      const filename = path.basename(item.filename).replace(/[^\w.-]/g, '_').slice(0, 120);
      if (!filename || filename === '.' || filename === '..') continue;
      const finalName = `${String(index + 1).padStart(2, '0')}-${filename}`, target = path.join(root, finalName);
      let data;
      if (fs.existsSync(target)) data = await fs.promises.readFile(target);
      else {
        data = await downloadMedia(url, item, options.signal);
        total += data.length; if (total > MAX_OUTPUT_JOB_BYTES) throw new Error('Generated media for this workflow exceeds the 250 MB total save limit.');
        await fs.promises.writeFile(target, data, { flag: 'wx' });
        created.push(target);
      }
      if (data.length > MAX_OUTPUT_FILE_BYTES) throw new Error(`Saved output ${filename} exceeds the 100 MB limit.`);
      if (!mediaSignature(finalName, data)) throw new Error(`Saved output ${filename} has an unexpected or invalid media format.`);
      saved.push({ filename: finalName, path: target, size: data.length, mediaType: /\.(?:mp4|webm|mov)$/i.test(finalName) ? 'video' : 'image', promptId, projectId });
    }
  } catch (error) {
    await Promise.all(created.map((file) => fs.promises.unlink(file).catch(() => {})));
    throw error;
  }
  return { saved, status: saved.length ? `Saved ${saved.length} generated file${saved.length === 1 ? '' : 's'}.` : 'No supported output files could be saved.' };
}

module.exports = { DEFAULT_URL, MAX_WORKFLOW_BYTES, MAX_OUTPUT_FILE_BYTES, safeComfyUrl, parseWorkflow, pngDimensions, decodePngDataUrl, validateAgainstInfo, buildScanWorkflow, createScanWorkflow, applyBindings, inspect, validateAgainstServer, queueWorkflow, uploadPng, history, mediaItems, saveOutputs };
