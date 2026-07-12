#!/usr/bin/env node
// Local MCP server over stdio — same render_pnl_card tool, no hosting needed.
// Wire into a client, e.g.:
//   claude mcp add world-pnl-card -- node /abs/path/mcp-server/bin/stdio.mjs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRenderTool } from "../lib/tool.js";

const server = new McpServer({ name: "world-pnl-card", version: "0.1.0" });
registerRenderTool(server);
await server.connect(new StdioServerTransport());
