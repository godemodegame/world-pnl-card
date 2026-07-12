// Call the DEPLOYED endpoint over Streamable HTTP and save the PNG it returns.
//   node scripts/test-live.mjs <url> [outDir]
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
const outDir = process.argv[3] || ".";
if (!url) throw new Error("usage: node scripts/test-live.mjs <url> [outDir]");

const client = new Client({ name: "live-test", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
console.log("connected:", JSON.stringify(client.getServerVersion?.() ?? {}));

const list = await client.listTools();
console.log("tools:", list.tools.map((t) => t.name).join(", "));

const r = await client.callTool({
  name: "render_pnl_card",
  arguments: {
    won: true,
    outcomeWord: "Yes",
    marketTitle: "Deployed on Vercel",
    marketSubtitle: "rendered browserless · edge-free",
    statusLine: "Market resolved",
    pnl: 42.0,
    currency: "USDC",
    roiPercent: 128.4,
    statusLabel: "Won",
  },
});
const img = r.content.find((c) => c.type === "image");
if (!img) throw new Error("no image content: " + JSON.stringify(r).slice(0, 300));
const buf = Buffer.from(img.data, "base64");
const out = `${outDir}/live-card.png`;
writeFileSync(out, buf);
console.log(`image: ${img.mimeType}, ${(buf.length / 1024) | 0}KB -> ${out}`);
await client.close();
console.log("OK");
process.exit(0);
