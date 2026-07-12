# World PnL Card — MCP server

A tiny, **free-hostable** [Model Context Protocol](https://modelcontextprotocol.io)
server that renders the branded World prediction-market **PnL result card** as a PNG —
with **no browser** at runtime, so it runs on any free serverless host.

One tool:

| tool | input | output |
|---|---|---|
| `render_pnl_card` | card fields (all optional, see below) | PNG `image` content |

```jsonc
// render_pnl_card arguments (any subset; omitted fields fall back to a sample)
{
  "won": true,                 // green ✓ / positive, or false = red ×
  "outcomeWord": "Yes",        // big RESULT word
  "marketTitle": "Spain beats Belgium",
  "marketSubtitle": "World Cup 2026 · Jul 10, 2026",
  "statusLine": "Market resolved",   // or "Position open"
  "pnl": 6.52,                 // signed
  "currency": "USDC",
  "roiPercent": 32.6,          // signed
  "statusLabel": "Won"         // "Won" | "Lost" | "Open"
}
```

## How it works (browserless)

The original skill screenshots a live vinext page with Playwright — impossible on
free serverless. Instead this server composites two layers:

```
baked background JPEG (all decorative chrome: gradients, glows, blur, 3D grid,
  planet, border, pill shell — one per won/lost variant)
        +  satori text layer (only the dynamic values + badge, placed from a
           layout manifest measured off the real Chromium render)
        ->  resvg  ->  PNG
```

Everything satori can't do (blur, inset shadows, 3D, the planet) lives in the baked
layer, so fidelity is preserved. All assets (backgrounds, badge, Geist fonts) are
base64-embedded in `lib/generated.js` — the server loads **zero files at runtime**,
so it's portable to any host.

```
api/mcp.js        Streamable-HTTP endpoint (mcp-handler)  ->  /api/mcp
bin/stdio.mjs     same tool over stdio (local, no hosting)
lib/render.js     satori + @resvg/resvg-js compositor
lib/card-data.js  zod schema + defaults + formatters (ported from app/page.tsx)
lib/tool.js       shared render_pnl_card registration
lib/generated.js  AUTO-GENERATED: layout manifest + base64 assets
```

## Local dev

```bash
npm install
npm run test:render   # writes card-{won,lost,open}.png (no server, no browser)
npm run test:mcp      # runs the full MCP protocol over HTTP against the tool
node scripts/test-stdio.mjs   # same over stdio
```

## Deploy to Vercel (free / hobby)

The endpoint runs on Vercel's **Node.js** runtime (resvg is a native module).

```bash
npm i -g vercel
cd mcp-server
vercel            # first run links/creates the project
vercel --prod     # deploy
```

- Set the Vercel project **Root Directory** to `mcp-server` (it deploys independently
  of the vinext card app in the repo root).
- Your endpoint: `https://<project>.vercel.app/api/mcp`
- Optional: set an env var `MCP_TOKEN=<secret>` to require `Authorization: Bearer <secret>`
  on every call (keeps the public endpoint from being an open render farm).

It's plain ESM + a couple of deps, so it also runs on any Node host (Render, Fly,
Railway) — point that host at `mcp-server/` and serve `api/mcp.js`.

## Wire it into a client

Live endpoint: **`https://world-pnl-card.vercel.app/api/mcp`**

Streamable-HTTP (remote):

```bash
claude mcp add --transport http world-pnl-card https://world-pnl-card.vercel.app/api/mcp
# with a token (if you set MCP_TOKEN on the project):
claude mcp add --transport http world-pnl-card https://world-pnl-card.vercel.app/api/mcp \
  --header "Authorization: Bearer <secret>"
```

stdio (local, no hosting):

```bash
claude mcp add world-pnl-card -- node /abs/path/to/mcp-server/bin/stdio.mjs
```

Then ask the client to “render a World PnL card” with your numbers.

## Re-baking after a design change

`lib/generated.js` and `lib/layout.json` are produced from the vinext app. If you
change `app/page.tsx` or `app/globals.css`, regenerate them from the repo root:

```bash
node scripts/bake-card.mjs
```

(That step needs the dev server + Playwright — it's dev-time only and never runs on
the host.)
