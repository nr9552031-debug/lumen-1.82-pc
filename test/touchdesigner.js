'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { TouchDesigner, safeEndpoint, DEFAULT_TD_URL, toolName, toToolOutput, COMFY_TD_WORKFLOW, verifyComfyWorkflowJson } = require('../src/main/touchdesigner');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const Comfy = require('../src/main/comfyui');
const { createApi } = require('../src/main/api');

async function testComfyHttpLifecycle() {
  const promptId = randomUUID(); let received = null;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/object_info') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ LoadImage: {}, SaveImage: {} }));
    if (req.url === '/prompt') {
      let body = ''; for await (const chunk of req) body += chunk; received = JSON.parse(body);
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ prompt_id: promptId, node_errors: {} }));
    }
    if (req.url === `/history/${promptId}`) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ [promptId]: { status: { completed: true }, outputs: { '2': { images: [{ filename: 'keyframe.png' }] } } } }));
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const workflow = JSON.stringify({ '1': { class_type: 'LoadImage', inputs: { image: 'base.png' } }, '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'keyframe' } } });
    const queued = await Comfy.queueWorkflow(url, workflow);
    assert.strictEqual(queued.promptId, promptId, 'queues graph and returns ComfyUI prompt ID');
    assert.deepStrictEqual(received.prompt, JSON.parse(workflow), 'submits the imported graph unchanged');
    assert.strictEqual((await Comfy.history(url, promptId)).outputs['2'].images[0].filename, 'keyframe.png', 'retrieves completed output metadata');
    await assert.rejects(Comfy.queueWorkflow(url, JSON.stringify({ '4': { class_type: 'MissingNodePack', inputs: {} } })), /missing required node types/, 'reports missing custom node classes');
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

function testComfyScanWorkflowBuilder() {
  const input = (type, options = {}) => [type, options];
  const info = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['installed.safetensors'], {}] } }, output: ['MODEL', 'CLIP', 'VAE'] },
    LoadImage: { input: { required: { image: input('STRING', { image_upload: true }) } }, output: ['IMAGE', 'MASK'] },
    LoadImageMask: { input: { required: { image: input('STRING', { image_upload: true }), channel: [['red', 'green', 'blue', 'alpha'], {}] } }, output: ['MASK'] },
    CLIPTextEncode: { input: { required: { text: input('STRING'), clip: input('CLIP') } }, output: ['CONDITIONING'] },
    InpaintModelConditioning: { input: { required: { positive: input('CONDITIONING'), negative: input('CONDITIONING'), vae: input('VAE'), pixels: input('IMAGE'), mask: input('MASK'), noise_mask: input('BOOLEAN') } }, output: ['CONDITIONING', 'CONDITIONING', 'LATENT'] },
    KSampler: { input: { required: { model: input('MODEL'), positive: input('CONDITIONING'), negative: input('CONDITIONING'), latent_image: input('LATENT'), seed: input('INT'), steps: input('INT'), cfg: input('FLOAT'), sampler_name: [['euler', 'dpmpp_2m'], {}], scheduler: [['normal', 'karras'], {}], denoise: input('FLOAT') } }, output: ['LATENT'] },
    VAEDecode: { input: { required: { samples: input('LATENT'), vae: input('VAE') } }, output: ['IMAGE'] },
    SaveImage: { input: { required: { images: input('IMAGE'), filename_prefix: input('STRING') } }, output: [] },
  };
  const built = Comfy.buildScanWorkflow(info, { photoName: 'scan_photo.png', maskName: 'scan_mask.png', prompt: 'luminous leaves' });
  const parsed = Comfy.parseWorkflow(built.raw);
  assert.strictEqual(parsed.nodeCount, 9, 'builds the scan inpainting workflow from installed ComfyUI schemas');
  assert.strictEqual(parsed.graph['1'].inputs.ckpt_name, 'installed.safetensors', 'selects a checkpoint reported by ComfyUI');
  assert.strictEqual(parsed.graph['4'].inputs.text, 'luminous leaves', 'uses the saved scan prompt');
  assert.deepStrictEqual(built.bindings, { photo: { nodeId: '2', inputName: 'image' }, mask: { nodeId: '3', inputName: 'image' } }, 'binds generated photo and surface mask to separate image nodes');
  assert.throws(() => Comfy.buildScanWorkflow({ ...info, InpaintModelConditioning: undefined }, { photoName: 'scan.png', maskName: 'mask.png' }), /InpaintModelConditioning/, 'reports when installed ComfyUI nodes cannot support automatic scan inpainting');
}

async function testComfyProjectionHandoff() {
  const promptId = randomUUID(), savedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-comfy-output-'));
  const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(1280, 16); png.writeUInt32BE(720, 20);
  const info = {
    LoadImage: { input: { required: { image: ['COMBO', { image_upload: true }] }, optional: {} }, output: ['IMAGE', 'MASK'] },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['available.safetensors']] } }, output: ['MODEL'] },
    SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } }, output: [] },
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/object_info') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(info));
    if (req.url === '/queue') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ queue_running: [], queue_pending: [] }));
    if (req.url === '/upload/image') { for await (const _chunk of req) {} return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'room.png', subfolder: '', type: 'input' })); }
    if (req.url === '/prompt') {
      let body = ''; for await (const chunk of req) body += chunk; const prompt = JSON.parse(body).prompt;
      assert.strictEqual(prompt['1'].inputs.image, 'room.png', 'queues an image-bound graph copy');
      assert.strictEqual(prompt['2'].inputs.ckpt_name, 'available.safetensors', 'keeps installed model choice unchanged');
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ prompt_id: promptId }));
    }
    if (req.url === `/history/${promptId}`) {
      const result = { [promptId]: { status: { completed: true, status_str: 'success' }, outputs: { '3': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } } } };
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    }
    if (req.url.startsWith('/view?')) return res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length }).end(png);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const store = { dir: savedDir, data: { settings: {}, projections: [{ id: 'proj-test' }, { id: 'proj-other' }], layouts: [], schedules: [], projectionScans: [] }, save() {} };
    const manager = { providers: { wiz: {}, hubspace: {}, cync: {} }, devices: new Map(), _meta: () => ({}), _normalize: (_d, value) => value, _emit() {} };
    const api = createApi({ manager, store, fx: { active: false, stop: async () => {} }, automation: {}, diag: { redact: String, dump: () => '', log() {} }, platform: { userDataDir: savedDir, projectDir: savedDir, version: 'test' } });
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const uploadedAsset = await api['comfy:upload-png'](url, 'room.png', dataUrl, 'mask', 'proj-test');
    assert.strictEqual(uploadedAsset.localPath, path.join(savedDir, 'projection-inputs', 'proj-test', 'mask-room.png'), 'stores the mapped mask inside project-scoped app data');
    assert.deepStrictEqual(fs.readFileSync(uploadedAsset.localPath), png, 'keeps the original mask available for TouchDesigner mapping');
    assert.strictEqual(api['comfy:input-assets']('proj-test')[0].role, 'mask', 'lists saved photo and mask assets by project');
    const projectWorkflow = { url, raw: '{"1":{"class_type":"LoadImage","inputs":{"image":"room.png"}}}', bindings: { photo: { nodeId: '1', inputName: 'image' } }, prompt: '', autoWorkflow: false, promptId, promptUrl: url };
    await api['comfy:project-config:save']('proj-test', projectWorkflow);
    const loadedWorkflow = await api['comfy:project-config:get']('proj-test');
    assert.deepStrictEqual(loadedWorkflow, projectWorkflow, 'persists workflow, input bindings and the in-flight prompt per project');
    await api['comfy:project-config:save']('proj-other', { url: 'http://127.0.0.1:8188', raw: '', bindings: {} });
    assert.strictEqual((await api['comfy:project-config:get']('proj-other')).raw, '', 'keeps separate project workflows from leaking across layouts');
    await assert.rejects(api['comfy:project-config:get']('../proj-test'), /Invalid Projection Studio project ID/, 'rejects traversal in project-scoped workflow storage');
    await assert.rejects(api['comfy:project-config:save']('proj-other', { url: 'http://192.168.1.2:8188' }), /localhost HTTP/, 'does not persist an insecure remote ComfyUI address');
    await assert.rejects(api['comfy:project-config:save']('proj-other', { raw: 'x'.repeat(Comfy.MAX_WORKFLOW_BYTES + 1) }), /10 MB/, 'bounds persisted imported workflows');
    const graph = { '1': { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } }, '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'available.safetensors' } }, '3': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'projection' } } };
    const raw = JSON.stringify(graph), target = { photo: { nodeId: '1', inputName: 'image' } };
    const check = await Comfy.validateAgainstServer(url, raw, { assets: { photo: 'room.png' }, bindings: target });
    assert.deepStrictEqual(check.missing, [], 'finds installed workflow classes');
    assert.deepStrictEqual(check.issues, [], 'checks required inputs and installed model choices');
    assert.strictEqual(check.imageInputs[0].nodeId, '1', 'discovers image-upload sockets from the installed schema');
    const queued = await Comfy.queueWorkflow(url, raw, { assets: { photo: 'room.png' }, bindings: target });
    assert.strictEqual(queued.promptId, promptId);
    assert.strictEqual(graph['1'].inputs.image, 'placeholder.png', 'leaves the imported workflow JSON unchanged');
    assert.deepStrictEqual(Comfy.pngDimensions(png), { width: 1280, height: 720 }, 'validates PNG signature and exact input dimensions');
    const badGraph = JSON.stringify({ ...graph, '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'missing.safetensors' } } });
    const bad = await Comfy.validateAgainstServer(url, badGraph);
    assert(bad.issues.some((x) => /model selection/.test(x)), 'reports an unavailable checkpoint choice');
    await assert.rejects(Comfy.queueWorkflow(url, badGraph), /model selection/, 'blocks queueing a model missing from this ComfyUI installation');
    const wrongPort = { ...graph, '3': { class_type: 'SaveImage', inputs: { images: ['1', 1], filename_prefix: 'projection' } } };
    assert(Comfy.validateAgainstInfo(Comfy.parseWorkflow(JSON.stringify(wrongPort)), info).issues.some((x) => /expects IMAGE but node 1 provides MASK/.test(x)), 'checks connection socket types against discovered output schemas');
    assert.throws(() => Comfy.parseWorkflow(JSON.stringify({ '1': { class_type: 'SaveImage', inputs: { images: ['1', -1] } } })), /output index/, 'rejects negative workflow output indices');
    const outputs = await Comfy.saveOutputs(url, promptId, savedDir, 'proj-test');
    assert.strictEqual(outputs.saved.length, 1, 'downloads and saves generated media from ComfyUI history');
    assert.deepStrictEqual(fs.readFileSync(outputs.saved[0].path), png, 'persists generated output bytes beneath the app data directory');
    const repeated = await Comfy.saveOutputs(url, promptId, savedDir, 'proj-test');
    assert.strictEqual(repeated.saved[0].path, outputs.saved[0].path, 'reuses a saved output on repeat retrieval');
    assert.deepStrictEqual(Comfy.mediaItems({ outputs: { '1': { images: [{ filename: '../private.png', type: 'output' }, { filename: 'ok.png', type: 'input' }] } } }), [], 'ignores unsafe paths and non-output media');
  } finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(savedDir, { recursive: true, force: true }); }
}

async function testStreamableHttpLifecycle() {
  const sessions = new Map();
  const httpServer = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const sessionId = req.headers['mcp-session-id']; let transport = sessions.get(sessionId);
      if (!transport && body.method === 'initialize') {
        const mcp = new McpServer({ name: 'mock-tdmcp', version: '1' });
        mcp.registerTool('project_info', { description: 'Read project info', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'Mock TouchDesigner project' }] }));
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: (id) => sessions.set(id, transport) });
        transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
        await mcp.connect(transport);
      }
      if (!transport) { res.writeHead(404).end(); return; }
      await transport.handleRequest(req, res, body);
    } catch (error) { if (!res.headersSent) res.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const addr = httpServer.address();
  const store = { data: { settings: {} }, save() {}, getSecret() { return undefined; }, setSecret() {} };
  const td = new TouchDesigner({ store, openExternal: async () => {} });
  td.saveConfig({ url: `http://127.0.0.1:${addr.port}/mcp` });
  const connected = await td.connect();
  assert.strictEqual(connected.state, 'connected', 'connects through the real Streamable HTTP transport');
  assert.deepStrictEqual(connected.tools.map((tool) => tool.name), ['project_info'], 'discovers tools from MCP tools/list');
  assert(connected.projectInfo.includes('Mock TouchDesigner project'), 'reads project_info after connection');
  const result = await td.client.callTool({ name: 'project_info', arguments: {} });
  assert.strictEqual(result.content[0].text, 'Mock TouchDesigner project', 'invokes a discovered MCP tool');
  await td.disconnect();
  assert.strictEqual(td.snapshot().state, 'disconnected', 'closes the transport on disconnect');
  await new Promise((resolve) => httpServer.close(resolve));
}

async function main() {
  const comfyApiWorkflow = JSON.stringify({ '1': { class_type: 'LoadImage', inputs: { image: 'base_photo.png' } }, '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'keyframe_01' } } });
  assert.strictEqual(Comfy.parseWorkflow(comfyApiWorkflow).nodeCount, 2, 'parses ComfyUI API node graphs');
  assert.throws(() => Comfy.parseWorkflow(JSON.stringify({ nodes: [], links: [] })), /Export \(API\)/, 'rejects editor graph format');
  assert.throws(() => Comfy.parseWorkflow(JSON.stringify({ '1': { class_type: 'SaveImage', inputs: { images: ['9', 0] } } })), /references missing node/, 'rejects dangling API graph connections');
  assert.throws(() => Comfy.parseWorkflow('x'.repeat(Comfy.MAX_WORKFLOW_BYTES + 1)), /10 MB/, 'bounds workflow parsing');
  assert.throws(() => Comfy.safeComfyUrl('http://192.168.1.5:8188'), /localhost HTTP/, 'rejects insecure remote ComfyUI');
  await assert.rejects(Comfy.uploadPng('http://127.0.0.1:8188', '../unsafe.png', 'data:image/png;base64,AA=='), /simple filename/, 'rejects unsafe upload filenames');
  await testComfyHttpLifecycle();
  testComfyScanWorkflowBuilder();
  await testComfyProjectionHandoff();
  const projectionUi = fs.readFileSync(path.join(__dirname, '../src/renderer/projection.js'), 'utf8');
  const tdUi = fs.readFileSync(path.join(__dirname, '../src/renderer/touchdesigner.js'), 'utf8');
  const scanPreviewUi = fs.readFileSync(path.join(__dirname, '../src/renderer/scan-preview.js'), 'utf8');
  assert(projectionUi.includes('data-comfy-binding') && projectionUi.includes('pjComfyUseScan') && projectionUi.includes('comfy:save-outputs'), 'Projection Studio wires scan-image upload, discovered input binding and output saving');
  assert(projectionUi.includes('comfy:project-config:get') && projectionUi.includes('pjFlushComfyConfig'), 'loads and saves each project workflow independently');
  assert(projectionUi.includes('lumen:td-projection') && tdUi.includes('lumen:td-projection') && tdUi.includes('${maskPath ?'), 'saved media and mask paths can be prepared for TouchDesigner Studio');
  assert(projectionUi.includes('pjRunScanProjection') && projectionUi.includes('comfy:history') && projectionUi.includes('Handed the result to TouchDesigner'), 'phone scan automation renders, runs, polls and hands off generated media');
  assert(scanPreviewUi.includes('async capture()') && scanPreviewUi.includes('scene.overrideMaterial = maskMaterial'), 'scan renderer exports a photo and a matching binary surface mask');
  assert(tdUi.includes('source.autoRun') && tdUi.includes("call('td:connect')"), 'generated scan handoff starts the local TouchDesigner flow when configured');
  assert.strictEqual(safeEndpoint('').toString(), DEFAULT_TD_URL, 'uses the documented TDMCP IPv4 loopback default');
  assert.throws(() => safeEndpoint('http://192.168.1.4:13316/mcp'), /HTTPS/, 'refuses unauthenticated plain HTTP to remote hosts');
  assert.throws(() => safeEndpoint('http://user:pass@127.0.0.1/mcp'), /credentials/, 'refuses credentials embedded in endpoint URL');
  assert.strictEqual(toolName('project_info'), 'td_project_info', 'creates stable Ollama tool identifiers');
  const output = toToolOutput({ content: [{ type: 'text', text: 'Project: demo' }, { type: 'image', mimeType: 'image/png', data: 'cG5n' }] });
  assert(output.text.includes('Project: demo') && output.images[0].data === 'cG5n', 'keeps text and image feedback from MCP results');

  assert.strictEqual(COMFY_TD_WORKFLOW.length, 4, 'includes the four ComfyUI and ComfyTD setup steps');
  const uiWorkflow = verifyComfyWorkflowJson(JSON.stringify({ nodes: [{ id: 1 }], links: [], extra: {} }));
  assert.strictEqual(uiWorkflow.valid, false, 'rejects ComfyUI editor workflow JSON');
  assert(/Export \(API\)/.test(uiWorkflow.error), 'explains the required API export');
  const apiWorkflow = verifyComfyWorkflowJson(JSON.stringify({ '3': { class_type: 'KSampler', inputs: { seed: 1, denoise: 0.8 } } }));
  assert.strictEqual(apiWorkflow.valid, true, 'accepts a ComfyUI API node object');
  assert.deepStrictEqual(apiWorkflow.exposed[0].parameters, ['seed', 'denoise'], 'identifies commonly driven parameters');
  assert.strictEqual(verifyComfyWorkflowJson('{').valid, false, 'rejects malformed JSON');

  const store = { data: { settings: {} }, save() {}, getSecret() { return undefined; }, setSecret() {} };
  const td = new TouchDesigner({ store, openExternal: async () => {} });
  td.saveConfig({ comfySteps: { 'export-api': true, unknown: true } });
  assert.strictEqual(td.snapshot().comfySteps['export-api'], true, 'persists workflow checklist progress');
  assert.strictEqual(td.snapshot().comfySteps.unknown, undefined, 'ignores unknown checklist IDs');
  assert.strictEqual(td.verifyComfyWorkflowJson('x'.repeat(10 * 1024 * 1024 + 1)).valid, false, 'rejects oversized workflow input');
  td.state = 'connected';
  td.tools = [
    { name: 'project_info', description: 'Inspect project', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'build_network', description: 'Create network', inputSchema: { type: 'object', properties: { operators: { type: 'array' } } } },
  ];
  const invoked = [];
  td.client = { callTool: async (tool) => { invoked.push(tool); return { content: [{ type: 'text', text: 'ok' }] }; } };
  let step = 0;
  td.ollamaChat = async () => {
    step++;
    if (step === 1) return { role: 'assistant', content: 'I will inspect first.', tool_calls: [{ function: { name: 'td_project_info', arguments: {} } }] };
    if (step === 2) return { role: 'assistant', content: 'I propose a small network.', tool_calls: [{ function: { name: 'td_build_network', arguments: { operators: [] } } }] };
    return { role: 'assistant', content: 'Build complete.' };
  };
  const task = td.run('Create a simple visual', 'test-model');
  for (let n = 0; n < 100 && !td.pendingTool; n++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert(td.pendingTool, 'waits for approval before mutating TouchDesigner');
  assert.deepStrictEqual(invoked.map((x) => x.name), ['project_info'], 'runs only the read-only inspection automatically');
  assert.strictEqual(td.approveTool(td.activeRun, true), true, 'accepts approval for the current run');
  await task;
  assert.deepStrictEqual(invoked.map((x) => x.name), ['project_info', 'build_network'], 'runs the approved mutating tool');
  assert(td.snapshot().turns.some((x) => x.text === 'Build complete.'), 'keeps the final agent response in session history');
  await testStreamableHttpLifecycle();
  console.log('TouchDesigner/ComfyUI: endpoint security, MCP lifecycle/tools, schema-aware image binding, model validation, output saving and write approval passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
