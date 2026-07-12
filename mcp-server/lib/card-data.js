// The card data contract — ported verbatim from the vinext app (app/page.tsx)
// so the MCP renderer produces the same card the skill does.
import { z } from "zod";

/** @typedef {{won:boolean,outcomeWord:string,marketTitle:string,marketSubtitle:string,statusLine:string,pnl:number,currency:string,roiPercent:number,statusLabel:string}} CardData */

/** @type {CardData} */
export const DEFAULT_SAMPLE = {
  won: true,
  outcomeWord: "Yes",
  marketTitle: "Spain beats Belgium",
  marketSubtitle: "World Cup 2026 · Jul 10, 2026",
  statusLine: "Market resolved",
  pnl: 6.52,
  currency: "USDC",
  roiPercent: 32.6,
  statusLabel: "Won",
};

// Raw zod shape for mcp-handler's tool input schema. Every field optional and
// merged over DEFAULT_SAMPLE (mirrors parseData in app/page.tsx) so a partial
// call still renders a complete card.
export const cardShape = {
  won: z
    .boolean()
    .optional()
    .describe("true = win / positive PnL (green accent, ✓); false = loss (red accent, ×)"),
  outcomeWord: z.string().optional().describe('Big RESULT word, e.g. "Yes" / "No"'),
  marketTitle: z.string().optional().describe("Market name (keep short — fits the left column)"),
  marketSubtitle: z.string().optional().describe("Subtitle / date line under the title"),
  statusLine: z
    .string()
    .optional()
    .describe('"Market resolved" (closed) or "Position open" (open)'),
  pnl: z.number().optional().describe("Signed profit/loss amount"),
  currency: z.string().optional().describe('Currency label, e.g. "USDC"'),
  roiPercent: z.number().optional().describe("Signed ROI percentage"),
  statusLabel: z.string().optional().describe('Pill text: "Won" / "Lost" / "Open"'),
};

export const CardDataSchema = z.object(cardShape);

/** Merge partial input over the sample defaults. @returns {CardData} */
export function withDefaults(input) {
  const parsed = CardDataSchema.parse(input ?? {});
  return { ...DEFAULT_SAMPLE, ...parsed };
}

export function fmtPnl(n) {
  return (n >= 0 ? "+" : "") + Number(n).toFixed(2);
}

export function fmtRoi(n) {
  return (n >= 0 ? "+" : "") + Number(n).toFixed(1) + "%";
}
