# World PnL Card

Generate a branded **World** "PnL result card" PNG for any [World](https://app.world.org)
prediction-market position — open or closed. The card is rendered by a small
[vinext](https://github.com/cloudflare/vinext) app (`app/page.tsx` + `app/globals.css`)
and screenshotted to a 1536×1024 @2x PNG.

<p align="center">
  <img src="docs/card-won.png" alt="World PnL card — winning position" width="49%" />
  <img src="docs/card-lost.png" alt="World PnL card — losing position" width="49%" />
</p>

## Why this exists

The World MCP connector exposes current holdings, trade tx-hashes, market
metadata, and prices — but **not PnL**. A closed position's realized profit is
never returned, and the closing trade often happens outside the connector. So
PnL is **reconstructed from the wallet's on-chain SPL balance deltas** on Solana
(cost basis in, proceeds out, remaining shares), then handed to the card
renderer. Two small Node scripts do the work:

| Script | Job |
|---|---|
| `scripts/reconstruct-pnl.mjs` | Pure on-chain math — reads Solana SPL balance deltas over a wallet's history and emits per-market cost basis, proceeds, remaining shares, PnL, and ROI. |
| `scripts/render-card.mjs` | Boots the vinext app, opens the card with the position encoded in `?data=`, waits for fonts + artwork, and screenshots the PNG. |

## Prerequisites

- **Node.js ≥ 22.13.0** — required by vinext (the dev server / renderer).
  `reconstruct-pnl.mjs` alone runs on Node ≥ 18, but `render-card.mjs` boots the
  dev server, which needs 22.
- A Solana RPC endpoint. The public `https://api.mainnet-beta.solana.com` is the
  default; set `SOLANA_RPC_URL` to a private RPC (Helius/Triton) if it rate-limits.

## Installation

```bash
git clone https://github.com/godemodegame/world-pnl-card.git
cd world-pnl-card
npm install
npx playwright install chromium   # headless browser used by render-card.mjs
```

Verify the app builds and renders a sample card:

```bash
npm run dev
# open http://localhost:<port>/  — shows a sample card (Spain beats Belgium)
```

The page is data-driven: `http://localhost:<port>/?data=<url-encoded JSON>`
renders any position. With no `data` param it falls back to a built-in sample.

## Rendering a card manually

```bash
# 1. Reconstruct on-chain flows for a wallet (caches to a JSON file)
node scripts/reconstruct-pnl.mjs <wallet-address> --json outputs/.pnl-flows.json

# 2. Build a markets.json mapping each outcome mint -> market title/side/result
#    (see .claude/skills/world-pnl-card/SKILL.md for the exact shape)

# 3. Emit card-ready position data (reuses the cached flows)
node scripts/reconstruct-pnl.mjs <wallet-address> \
  --json outputs/.pnl-flows.json --markets markets.json

# 4. Render the chosen position to a PNG
node scripts/render-card.mjs --data-file chosen.json
# -> outputs/world-pnl-card-<slug>.png
```

You can also render straight from inline JSON without the reconstruct step:

```bash
node scripts/render-card.mjs --data '{
  "won": true, "outcomeWord": "Yes",
  "marketTitle": "Spain beats Belgium",
  "marketSubtitle": "World Cup 2026 · Jul 10, 2026",
  "statusLine": "Market resolved",
  "pnl": 127.45, "currency": "USDC", "roiPercent": 28.34,
  "statusLabel": "Won"
}'
```

## Card data model

`app/page.tsx` reads a single URL-encoded JSON object from `?data=`:

| Field | Meaning |
|---|---|
| `won` | Drives the accent — green ✓ / red ×, badge, and pill |
| `outcomeWord` | Big RESULT word (`"Yes"` / `"No"` for closed; held side for open) |
| `marketTitle` / `marketSubtitle` | Market name + date under the result |
| `statusLine` | `"Market resolved"` (closed) / `"Position open"` (open) |
| `pnl` / `currency` | Signed profit, e.g. `127.45` / `"USDC"` |
| `roiPercent` | Signed ROI, e.g. `28.34` |
| `statusLabel` | `"Won"` / `"Lost"` / `"Open"` pill |

## Using the Claude Code skill

This repo ships a Claude Code skill at `.claude/skills/world-pnl-card/` that runs
the whole flow end-to-end from the [World MCP connector](https://claude.ai):
resolve the wallet → reconstruct flows → map mints to markets → price open
positions → render → deliver the PNG in chat. Ask Claude to *"make a PnL card for
my latest World bet"* and it drives the scripts above. See
[`SKILL.md`](.claude/skills/world-pnl-card/SKILL.md) for the full procedure.

## Environment variables

| Var | Used by | Default |
|---|---|---|
| `SOLANA_RPC_URL` | `reconstruct-pnl.mjs` | `https://api.mainnet-beta.solana.com` |
| `RENDER_BASE_URL` | `render-card.mjs` | *(unset)* — reuse an already-running dev server instead of spawning one (fast iteration) |
| `VINEXT_NODE_BIN` | `render-card.mjs` | *(unset)* — point at a Node ≥22 `bin` dir if auto-detection fails |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the local vinext dev server |
| `npm run build` | Build the vinext output |
| `npm test` | Build and verify the rendered card HTML |
| `npm run lint` | Lint with ESLint |

## Project layout

```
app/                       vinext app — the card UI
  page.tsx                 data-driven card (reads ?data=)
  globals.css              card styling
scripts/
  reconstruct-pnl.mjs      on-chain PnL reconstruction (Solana SPL deltas)
  render-card.mjs          Playwright screenshot of the live card
public/                    planet artwork, checkmark badge, favicon
.claude/skills/world-pnl-card/  Claude Code skill orchestrating the flow
docs/                      README preview images
```

## Notes

- USDC and CASH are both treated as $1. Buys spend USDC; redeems pay CASH.
- SOL rent/fees (~0.002 SOL) are ignored — negligible vs. position size.
- World positions are Solana SPL outcome tokens; the reconstruction is Solana-only.
