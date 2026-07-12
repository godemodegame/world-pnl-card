// Streamable-HTTP MCP endpoint (Vercel function at /api/mcp).
// Stateless — no Redis needed. Exposes one tool: render_pnl_card.
import { createMcpHandler } from "mcp-handler";
import { registerRenderTool } from "../lib/tool.js";

const handler = createMcpHandler(
  (server) => {
    registerRenderTool(server);
  },
  {
    serverInfo: { name: "world-pnl-card", version: "0.1.0" },
  },
  {
    // Endpoint resolves to `${basePath}/mcp` = /api/mcp (matches this file's route).
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

// Optional shared-secret guard: if MCP_TOKEN is set, require a matching bearer.
async function guarded(request) {
  const token = process.env.MCP_TOKEN;
  if (token) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  return handler(request);
}

export { guarded as GET, guarded as POST, guarded as DELETE, guarded as OPTIONS };

// Runs on Vercel's Node.js runtime (default for .js functions — required because
// @resvg/resvg-js is a native module). Duration/memory are set in vercel.json.
