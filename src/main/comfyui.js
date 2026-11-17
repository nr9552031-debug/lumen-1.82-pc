'use strict';
const { randomUUID } = require('crypto');

const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;
const DEFAULT_URL = 'http://127.0.0.1:8188';

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
    }
    classes.add(node.class_type);
  }
  return { graph, nodeCount: nodes.length, classes: [...classes], nodes: nodes.map(([id, node]) => ({ id, classType: node.class_type, parameters: Object.keys(node.inputs) })) };
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

async function validateAgainstServer(urlValue, raw) {
  const parsed = parseWorkflow(raw), info = await inspect(urlValue);
  const known = new Set(info.nodeClasses), missing = parsed.classes.filter((name) => !known.has(name));
  return { nodeCount: parsed.nodeCount, classes: parsed.classes, missing, queue: info.queue };
}

async function queueWorkflow(urlValue, raw, options = {}) {
  const url = safeComfyUrl(urlValue), { graph, classes, nodeCount } = parseWorkflow(raw);
  const available = await request(url, '/object_info', options);
  const missing = classes.filter((name) => !Object.hasOwn(available, name));
  if (missing.length) throw new Error(`ComfyUI is missing required node types: ${missing.join(', ')}`);
  const clientId = randomUUID();
  const result = await request(url, '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientId }), signal: options.signal });
  if (result.node_errors && Object.keys(result.node_errors).length) throw new Error(`ComfyUI rejected workflow nodes: ${JSON.stringify(result.node_errors).slice(0, 2000)}`);
  if (!result.prompt_id) throw new Error('ComfyUI did not return a prompt ID.');
  return { promptId: result.prompt_id, clientId, nodeCount };
}

async function uploadPng(urlValue, filename, dataUrl, options = {}) {
  const url = safeComfyUrl(urlValue);
  filename = String(filename || '');
  if (filename !== filename.split(/[\\/]/).pop() || !/^[\w.-]{1,100}\.png$/i.test(filename) || filename === '.' || filename === '..') throw new Error('Choose a PNG file with a simple filename.');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Only validated PNG image data can be uploaded.');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_WORKFLOW_BYTES) throw new Error('PNG must be smaller than 10 MB.');
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

module.exports = { DEFAULT_URL, MAX_WORKFLOW_BYTES, safeComfyUrl, parseWorkflow, inspect, validateAgainstServer, queueWorkflow, uploadPng, history };
