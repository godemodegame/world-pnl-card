---
name: world-pnl-card
description: Generate a branded World "PnL result card" PNG for a World prediction-market position (open or closed). Use when the user asks to make/render a PnL card, share a World bet result, or visualize a World position's profit/loss. Pulls the position from the World MCP connector, reconstructs realized/unrealized PnL from on-chain Solana data, and renders the card via the repo's vinext app.
---

# World PnL Card

Turn a World prediction-market position into the branded landscape result card
(`app/page.tsx` + `app/globals.css`) exported as a PNG.

Run everything from the repo root (`world-pnl-card/`).

## Why this is not a one-liner

The World MCP connector **does not expose PnL**. It gives current holdings
(`world_positions`), this connector's trade tx-hashes (`list_requests` /
`get_request`), market metadata (`world_filter_outcome_mints`,
`world_get_market`), and prices (`world_orderbook`). A **closed** position's
realized PnL is not returned — and the closing trade often happens outside this
connector, so it is not even in `list_requests`. PnL is therefore reconstructed
from the wallet's **on-chain SPL balance deltas** (`scripts/reconstruct-pnl.mjs`,
public Solana RPC). The script does the pure on-chain math; you supply the
mint→market mapping (from MCP) as `markets.json`.

## One-time setup

- `npm install` (installs `playwright`, already in devDependencies).
- `npx playwright install chromium` (downloads the headless browser).
- **Node ≥22 for the renderer.** vinext requires Node ≥22 (`node:fs/promises`
  `glob`). `reconstruct-pnl.mjs` runs fine on Node ≥18; only the dev server
  (`render-card.mjs` → `npm run dev`) needs 22. `render-card.mjs` auto-detects a
  working ≥22 node — it checks `~/.cache/world-pnl-card/node-v22*` first, then
  Homebrew (`node@22`, `node`), and **skips a broken binary** (Homebrew's node
  can fail with `Library not loaded: libicui18n.NN.dylib` after an `icu4c`
  upgrade). If none works, provision a self-contained one (non-invasive):
  ```
  mkdir -p ~/.cache/world-pnl-card
  curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-arm64.tar.gz \
    | tar -xz -C ~/.cache/world-pnl-card
  ```
  Or point `VINEXT_NODE_BIN` at any working `node`-≥22 `bin` dir.
- Optional: set `SOLANA_RPC_URL` to a private RPC (Helius/Triton) if the public
  endpoint rate-limits. Default: `https://api.mainnet-beta.solana.com`.

## Procedure

### 1. Resolve the wallet
Call `mcp__claude_ai_world__list_credentials`. Take the Solana `wallet`-kind
credential's `metadata.address` (e.g. `GQbCgAnYLqGS1vVPViebVjoTi8ZYRacx7EhnQdTSQ8Vp`).

### 2. Reconstruct on-chain flows (pass 1)
```
node scripts/reconstruct-pnl.mjs <wallet> --json outputs/.pnl-flows.json
```
This prints `candidateMints` (outcome-token mints the wallet ever held) and
per-mint `flows` (`costBasis`, `proceeds`, `remainingShares`, `sigs`). It also
caches the flows to `outputs/.pnl-flows.json` so pass 2 needs no re-fetch.

### 3. Map mints → markets (MCP)
Call `mcp__claude_ai_world__world_filter_outcome_mints` with `candidateMints`.
For each returned market build one entry of `markets.json`, keyed by the mint:

```jsonc
{
  "<outcome-mint>": {
    "side": "yes" | "no",          // "yes" if mint == market.accounts.*.yesMint, else "no"
    "marketTitle": "Spain beats Belgium",
    "marketSubtitle": "World Cup 2026 · Jul 10, 2026",
    "status": "finalized",         // market.status
    "result": "yes",               // market.result (null if unresolved)
    "markUsd": 1.0                 // only needed for OPEN positions (see step 4)
  }
}
```
- **side**: match the candidate mint against each market's `accounts.<ledger>.yesMint` / `noMint`.
- **marketTitle / marketSubtitle**: craft a clean, human title from the market's
  `title`, `subtitle`, and `rulesPrimary.tokens` (e.g. sports markets expose
  `team_a`, `team_b`, `tournament`, `kickoff` → `"{team_a} beats {team_b}"` and
  `"{tournament} · {date}"`). Keep the title short — it must fit the card's left column.

### 4. Mark open positions (only if `remainingShares > 0`)
A position is **open** when its flow's `remainingShares > 0`. Price the remainder:
- If the market is `active`/`initialized`: call `mcp__claude_ai_world__world_orderbook`
  (by the outcome mint, `by_mint: true`) and set `markUsd` to the mid of the held
  side `((bid + ask) / 2)`.
- If `determined`/`finalized`: set `markUsd` to the held side's redemption value
  (`yesRedemptionValue / 10000` for a YES holding; `1 - yesRedemptionValue/10000`
  for NO) — usually `1` for the winning side, `0` for the losing side.
Closed positions (`remainingShares == 0`) ignore `markUsd`.

### 5. Build card data (pass 2)
```
node scripts/reconstruct-pnl.mjs <wallet> --json outputs/.pnl-flows.json --markets markets.json
```
Outputs `positions[]`, each already shaped as the card data model:
`{ won, outcomeWord, marketTitle, marketSubtitle, statusLine, pnl, currency, roiPercent, statusLabel }`
plus diagnostics (`costBasis`, `proceeds`, `remainingShares`).

### 6. Pick the position
If the user named a market ("my Spain bet", "latest closed"), select it.
Otherwise show the list (title · PnL · ROI · Won/Lost/Open) and default to the
most recent (`positions[0]`). Write the chosen position object to a temp JSON.

### 7. Render the PNG
```
node scripts/render-card.mjs --data-file <chosen>.json
```
Boots `npm run dev`, screenshots a 1536×1024 @2x viewport, and writes
`outputs/world-pnl-card-<slug>.png` (printed on stdout). Set `RENDER_BASE_URL`
to reuse an already-running dev server for faster iteration.

### 8. Deliver — show the card in chat
Display the card inline: call `SendUserFile` with `display: "render"` (and
`status: "normal"`). This is required — the card must be visible in the chat,
not merely written to disk.

## Response style
Keep the skill's reply **very short**: a single line — `marketTitle · ±pnl currency ·
±roi% · statusLabel` — plus the rendered card. No preamble, no procedure recap, no
file paths, no bullet lists. The card is the answer.

## Card data model (what drives the render)
`app/page.tsx` reads `?data=<url-encoded JSON>`:
| field | meaning |
|---|---|
| `won` | drives accent (green ✓ / red ×), badge, and pill |
| `outcomeWord` | big RESULT word — `won ? "Yes" : "No"` for closed; held side for open |
| `marketTitle` / `marketSubtitle` | market name + date under the result |
| `statusLine` | `"Market resolved"` (closed) / `"Position open"` (open) |
| `pnl` / `currency` | signed profit, USDC |
| `roiPercent` | signed ROI |
| `statusLabel` | `"Won"` / `"Lost"` / `"Open"` pill |

## Notes
- USDC (`EPjFW…`) and CASH (`CASHx9KJU…`) are both treated as $1. Buys spend USDC;
  redeems (`RedeemOutcomeForUser`) pay CASH.
- SOL rent/fees (~0.002 SOL) are ignored — negligible vs position size.
- World positions are Solana SPL outcome tokens; this skill is Solana-only.
