// Local fidelity check — renders sample cards to PNG with no browser/server.
//   node scripts/test-render.mjs [outDir]
import { writeFileSync } from "node:fs";
import { buildCardPng } from "../lib/render.js";
import { withDefaults, DEFAULT_SAMPLE } from "../lib/card-data.js";

const outDir = process.argv[2] || ".";

const cases = {
  won: DEFAULT_SAMPLE,
  lost: {
    won: false,
    outcomeWord: "No",
    marketTitle: "Spain beats Belgium",
    marketSubtitle: "World Cup 2026 · Jul 10, 2026",
    statusLine: "Market resolved",
    pnl: -4.8,
    currency: "USDC",
    roiPercent: -24.0,
    statusLabel: "Lost",
  },
  open: {
    won: true,
    outcomeWord: "Yes",
    marketTitle: "Will BTC top $100k in 2026?",
    marketSubtitle: "Crypto · open position",
    statusLine: "Position open",
    pnl: 12.34,
    currency: "USDC",
    roiPercent: 8.7,
    statusLabel: "Open",
  },
};

for (const [name, d] of Object.entries(cases)) {
  const png = await buildCardPng(withDefaults(d));
  const out = `${outDir}/card-${name}.png`;
  writeFileSync(out, png);
  console.log(out, ((png.length / 1024) | 0) + "KB");
}
