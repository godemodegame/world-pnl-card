// Smoke test the stdio server (bin/stdio.mjs).  node scripts/test-stdio.mjs
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: ["bin/stdio.mjs"],
  cwd: root,
});
const client = new Client({ name: "stdio-smoke", version: "0.0.0" });
await client.connect(transport);
const list = await client.listTools();
console.log("stdio tools:", list.tools.map((t) => t.name).join(", "));
const r = await client.callTool({
  name: "render_pnl_card",
  arguments: { won: false, outcomeWord: "No", pnl: -3.21, roiPercent: -15.5, statusLabel: "Lost", marketTitle: "stdio test" },
});
const img = r.content.find((c) => c.type === "image");
console.log("content:", r.content.map((c) => c.type).join(","), "png bytes:", Buffer.from(img.data, "base64").length);
await client.close();
console.log("OK");
process.exit(0);
