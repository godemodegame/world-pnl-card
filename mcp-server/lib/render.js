// Browserless card renderer: composite the baked background (all the decorative
// chrome) with a satori-drawn text layer, then rasterize with resvg.
//
//   baked bg JPEG  +  satori(dynamic text/badge @ measured coords)  ->  SVG  ->  PNG
//
// Everything satori can't do (blur glows, inset shadows, 3D grid, the planet)
// lives in the baked layer, so it's preserved. Satori only draws text + one
// small badge image — coordinates and font styles come from lib/generated.js
// (produced by scripts/bake-card.mjs measuring the real Chromium render).
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { layout, bgWon, bgLost, badge, fonts } from "./generated.js";
import { fmtPnl, fmtRoi } from "./card-data.js";

const { w: CANVAS_W, h: CANVAS_H } = layout.canvas;

// Satori needs static font weights; the card uses in-between weights (520, 610,
// 660, 720…) which we snap to the nearest bundled Geist weight.
const WEIGHTS = [400, 500, 600, 700];
function nearestWeight(w) {
  const n = Number(w) || 400;
  return WEIGHTS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

const SATORI_FONTS = WEIGHTS.filter((w) => fonts[w]).map((w) => ({
  name: "Geist",
  data: Buffer.from(fonts[w], "base64"),
  weight: w,
  style: "normal",
}));

// --- tiny element factory (React-element-shaped objects; no JSX/React dep) ---
function el(type, style, children) {
  return { type, props: { style, ...(children !== undefined ? { children } : {}) } };
}
function img(src, style) {
  return { type: "img", props: { src, style } };
}

// Measured computed style -> satori style.
function fontStyle(s, overrides = {}) {
  const st = {
    fontFamily: "Geist",
    fontSize: s.fontSize,
    fontWeight: nearestWeight(s.fontWeight),
    color: s.color,
    letterSpacing: s.letterSpacing || 0,
    lineHeight: s.lineHeight && s.fontSize ? s.lineHeight / s.fontSize : 1,
  };
  if (s.textTransform && s.textTransform !== "none") st.textTransform = s.textTransform;
  return { ...st, ...overrides };
}

// The ✓ badge (won): the real .check-icon is 135% of its box, centered and
// overflowing — reproduce with a centering box the size of the .check box.
function wonBadge(chk) {
  return el(
    "div",
    {
      width: chk.rect.w,
      height: chk.rect.h,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    },
    [img(`data:image/png;base64,${badge}`, { width: chk.rect.w * 1.35, height: chk.rect.h * 1.35 })]
  );
}

// The × badge (lost): a dark-red circle with a thin glyph (globals.css .check--negative).
function lostBadge(chk, accent) {
  return el(
    "div",
    {
      width: chk.rect.w,
      height: chk.rect.h,
      borderRadius: 9999,
      backgroundColor: "rgba(78,20,25,0.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Geist",
      fontWeight: 400,
      fontSize: chk.rect.h * 0.62,
      color: accent,
      paddingBottom: chk.rect.h * 0.05,
    },
    "×"
  );
}

function buildTree(data) {
  const variant = data.won ? "won" : "lost";
  const v = layout.variants[variant];
  const bg = data.won ? bgWon : bgLost;

  const rl = v[".result-line"];
  const strong = v[".result-line strong"];
  const chk = v[".check"];
  const mt = v[".market-title"];
  const ms = v[".market-sub"];
  const mut = v[".muted"];
  const pr = v[".pnl-row"];
  const pv = v[".pnl-value"];
  const pvs = v[".pnl-value span"];
  const roi = v[".roi"];
  const roiSpan = v[".roi span"];
  const pill = v[".status-pill span:last-child"];
  const accent = strong.style.color;

  const children = [
    // baked decorative background (full bleed)
    img(`data:image/jpeg;base64,${bg}`, {
      position: "absolute",
      top: 0,
      left: 0,
      width: CANVAS_W,
      height: CANVAS_H,
    }),

    // RESULT: big word + badge (flex row so the badge follows any word width)
    el(
      "div",
      {
        position: "absolute",
        left: rl.rect.x,
        top: rl.rect.y,
        height: rl.rect.h,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: rl.style.columnGap,
      },
      [
        el(
          "div",
          fontStyle(strong.style, { lineHeight: 1, whiteSpace: "nowrap" }),
          data.outcomeWord
        ),
        data.won ? wonBadge(chk) : lostBadge(chk, accent),
      ]
    ),

    // market title (wraps within the column width) + subtitle + status line
    el(
      "div",
      { position: "absolute", left: mt.rect.x, top: mt.rect.y, width: mt.rect.w, ...fontStyle(mt.style) },
      data.marketTitle
    ),
    el(
      "div",
      { position: "absolute", left: ms.rect.x, top: ms.rect.y, ...fontStyle(ms.style, { whiteSpace: "nowrap" }) },
      data.marketSubtitle
    ),
    el(
      "div",
      { position: "absolute", left: mut.rect.x, top: mut.rect.y, ...fontStyle(mut.style, { whiteSpace: "nowrap" }) },
      data.statusLine
    ),

    // PNL row: value + currency, then ROI
    el(
      "div",
      {
        position: "absolute",
        left: pr.rect.x,
        top: pr.rect.y,
        display: "flex",
        flexDirection: "row",
        alignItems: "baseline",
        gap: pr.style.columnGap,
      },
      [
        el(
          "div",
          { display: "flex", flexDirection: "row", alignItems: "baseline", gap: pv.style.fontSize * 0.22 },
          [
            el("div", fontStyle(pv.style, { whiteSpace: "nowrap" }), fmtPnl(data.pnl)),
            el("div", fontStyle(pvs.style, { whiteSpace: "nowrap" }), data.currency),
          ]
        ),
        el("div", { display: "flex", flexDirection: "row", alignItems: "baseline" }, [
          el(
            "div",
            fontStyle(roiSpan.style, { marginRight: roiSpan.style.marginRight, whiteSpace: "nowrap" }),
            "ROI"
          ),
          el("div", fontStyle(roi.style, { whiteSpace: "nowrap" }), fmtRoi(data.roiPercent)),
        ]),
      ]
    ),

    // status pill label (centered vertically in its measured box; pill shell is baked)
    el(
      "div",
      {
        position: "absolute",
        left: pill.rect.x,
        top: pill.rect.y,
        height: pill.rect.h,
        display: "flex",
        alignItems: "center",
        ...fontStyle(pill.style, { textTransform: "uppercase", whiteSpace: "nowrap" }),
      },
      data.statusLabel
    ),
  ];

  return el(
    "div",
    {
      position: "relative",
      display: "flex",
      width: CANVAS_W,
      height: CANVAS_H,
      backgroundColor: "#000000",
    },
    children
  );
}

/**
 * Render a World PnL card to a PNG buffer.
 * @param {import("./card-data.js").CardData} data
 * @returns {Promise<Buffer>}
 */
export async function buildCardPng(data) {
  const svg = await satori(buildTree(data), {
    width: CANVAS_W,
    height: CANVAS_H,
    fonts: SATORI_FONTS,
  });
  const png = new Resvg(svg, {
    background: "#000000",
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return png;
}

export const CANVAS = { width: CANVAS_W, height: CANVAS_H };
