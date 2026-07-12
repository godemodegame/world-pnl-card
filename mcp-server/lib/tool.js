// Shared tool definition, registered on both the HTTP (api/mcp.js) and stdio
// (bin/stdio.mjs) MCP servers.
import { cardShape, withDefaults } from "./card-data.js";
import { buildCardPng } from "./render.js";

export const TOOL_NAME = "render_pnl_card";

export const TOOL_META = {
  title: "Render World PnL card",
  description:
    "Render a branded World prediction-market PnL result card as a PNG. " +
    "Provide the card fields; any omitted field falls back to a sample value. " +
    "`won` controls the accent (green ✓ for a win / positive PnL, red × for a loss).",
  inputSchema: cardShape,
};

/** Register render_pnl_card on an McpServer instance. */
export function registerRenderTool(server) {
  server.registerTool(TOOL_NAME, TOOL_META, async (input) => {
    const png = await buildCardPng(withDefaults(input));
    return {
      content: [
        {
          type: "image",
          data: Buffer.from(png).toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  });
}
