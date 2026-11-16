'use strict';
const assert = require('assert');
const http = require('http');
const { randomUUID } = require('crypto');
const { TouchDesigner, safeEndpoint, DEFAULT_TD_URL, toolName, toToolOutput } = require('../src/main/touchdesigner');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

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
  assert.strictEqual(safeEndpoint('').toString(), DEFAULT_TD_URL, 'uses the documented TDMCP IPv4 loopback default');
  assert.throws(() => safeEndpoint('http://192.168.1.4:13316/mcp'), /HTTPS/, 'refuses unauthenticated plain HTTP to remote hosts');
  assert.throws(() => safeEndpoint('http://user:pass@127.0.0.1/mcp'), /credentials/, 'refuses credentials embedded in endpoint URL');
  assert.strictEqual(toolName('project_info'), 'td_project_info', 'creates stable Ollama tool identifiers');
  const output = toToolOutput({ content: [{ type: 'text', text: 'Project: demo' }, { type: 'image', mimeType: 'image/png', data: 'cG5n' }] });
  assert(output.text.includes('Project: demo') && output.images[0].data === 'cG5n', 'keeps text and image feedback from MCP results');

  const store = { data: { settings: {} }, save() {}, getSecret() { return undefined; }, setSecret() {} };
  const td = new TouchDesigner({ store, openExternal: async () => {} });
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
