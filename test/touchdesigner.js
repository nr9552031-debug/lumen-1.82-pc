'use strict';
const assert = require('assert');
const http = require('http');
const { randomUUID } = require('crypto');
const { TouchDesigner, safeEndpoint, DEFAULT_TD_URL, toolName, toToolOutput, COMFY_TD_WORKFLOW, verifyComfyWorkflowJson } = require('../src/main/touchdesigner');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const Comfy = require('../src/main/comfyui');

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
  console.log('TouchDesigner: endpoint security, MCP Streamable HTTP lifecycle/tools, local agent loop and write approval passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
