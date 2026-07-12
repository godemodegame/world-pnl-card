// End-to-end MCP smoke test: wrap the web handler in a Node http server, connect
// with the real MCP SDK client over Streamable HTTP, list + call the tool.
//   node scripts/test-mcp.mjs [outDir]
import http from "node:http";
import { writeFileSync } from "node:fs";
import { GET, POST, DELETE } from "../api/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const outDir = process.argv[2] || ".";
const PORT = 3939;
const methods = { GET, POST, DELETE, OPTIONS: GET };

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const fn = methods[req.method] || POST;
    const response = await fn(request);
    res.statusCode = response.status;
    response.headers.forEach((val, key) => res.setHeader(key, val));
    // Stream the body — mcp-handler keeps Streamable-HTTP responses open
    // (SSE-style), so we must flush chunks as they arrive, not buffer to end.
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e?.stack || e));
  }
});

await new Promise((r) => server.listen(PORT, r));

// Hard safety net so a protocol hang can't wedge the test.
const bail = setTimeout(() => {
  console.error("TIMEOUT — aborting");
  process.exit(2);
}, 45000);
bail.unref();

const client = new Client({ name: "smoke-test", version: "0.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/api/mcp`));
await client.connect(transport);
console.log("connected. server:", JSON.stringify(client.getServerVersion?.() ?? {}));

const list = await client.listTools();
console.log("tools:", list.tools.map((t) => `${t.name}`).join(", "));

const result = await client.callTool({
  name: "render_pnl_card",
  arguments: {
    won: true,
    outcomeWord: "Yes",
    marketTitle: "MCP smoke test market",
    marketSubtitle: "via Streamable HTTP",
    statusLine: "Market resolved",
    pnl: 9.99,
    currency: "USDC",
    roiPercent: 42.0,
    statusLabel: "Won",
  },
});
console.log("content types:", result.content.map((c) => c.type).join(", "));
const image = result.content.find((c) => c.type === "image");
if (!image) throw new Error("no image content returned");
const buf = Buffer.from(image.data, "base64");
const out = `${outDir}/mcp-tool.png`;
writeFileSync(out, buf);
console.log(`image: ${image.mimeType}, ${(buf.length / 1024) | 0}KB -> ${out}`);

await client.close();
server.close();
clearTimeout(bail);
console.log("OK");
process.exit(0);
