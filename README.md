# World PnL Card

A [Claude Code](https://claude.com/claude-code) skill that generates a branded
**World** "PnL result card" PNG for any [World](https://app.world.org)
prediction-market position — open or closed. Ask Claude *"make a PnL card for my
latest World bet"* and it pulls the position from the World MCP connector,
reconstructs realized/unrealized PnL from on-chain Solana data, and renders the
card.

<p align="center">
  <img src="docs/card-won.png" alt="World PnL card — winning position" width="49%" />
  <img src="docs/card-lost.png" alt="World PnL card — losing position" width="49%" />
</p>

## Prerequisites

- **Node.js ≥ 22.13.0** — required by the card renderer.
- **Claude Code** with the **World MCP connector** enabled.

## Install

Clone the repo and install its dependencies. The skill lives at
`.claude/skills/world-pnl-card/` and Claude Code loads it automatically when you
work inside the repo.

```bash
git clone https://github.com/godemodegame/world-pnl-card.git
cd world-pnl-card
npm install
npx playwright install chromium   # headless browser used to render the PNG
```

That's it. Open the repo in Claude Code and the `world-pnl-card` skill is
available.

To use the skill from any directory, symlink it into your global skills folder:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/world-pnl-card" ~/.claude/skills/world-pnl-card
```

(The skill still shells out to this repo's scripts, so keep the clone in place.)

## Use

In Claude Code, just ask:

> make a PnL card for my latest World bet

Claude resolves your wallet, reconstructs the flows, maps markets, renders the
PNG, and shows it in chat. See
[`SKILL.md`](.claude/skills/world-pnl-card/SKILL.md) for the full procedure and
the two scripts it drives (`scripts/reconstruct-pnl.mjs`, `scripts/render-card.mjs`).

## Environment variables (optional)

| Var | Purpose | Default |
|---|---|---|
| `SOLANA_RPC_URL` | Private Solana RPC if the public one rate-limits | `https://api.mainnet-beta.solana.com` |
| `RENDER_BASE_URL` | Reuse an already-running dev server for faster renders | *(unset)* |
| `VINEXT_NODE_BIN` | Point at a Node ≥22 `bin` dir if auto-detection fails | *(unset)* |

## Notes

- USDC and CASH are both treated as $1. Buys spend USDC; redeems pay CASH.
- SOL rent/fees (~0.002 SOL) are ignored — negligible vs. position size.
- World positions are Solana SPL outcome tokens; reconstruction is Solana-only.
