#!/usr/bin/env node
// Dev-time baker for the serverless MCP renderer (mcp-server/).
//
// The hosted MCP server can't run a browser, so it composites the card as:
//   baked background PNG (all the decorative chrome + static text)  +
//   a satori text layer (only the DYNAMIC values), positioned from a layout
//   manifest measured here.
//
// This script drives the SAME vinext app + Playwright pipeline as
// scripts/render-card.mjs. For each variant (won / lost) it:
//   1. renders /?data=<sample> at 1536x1024 @2x,
//   2. MEASURES the dynamic nodes (rect + font styles) -> mcp-server/lib/layout.json,
//   3. HIDES those nodes and screenshots -> mcp-server/assets/{won,lost}-bg.png.
//
// Re-run this whenever app/page.tsx or app/globals.css changes.
//
//   node scripts/bake-card.mjs
//   RENDER_BASE_URL=http://localhost:xxxx node scripts/bake-card.mjs   # reuse a server

import { spawn, execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { chromium } from "playwright";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT = { width: 1536, height: 1024 };
const DSF = 2; // deviceScaleFactor -> baked PNGs and coords are 3072x2048
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSETS = resolve(REPO, "mcp-server", "assets");
const LIB = resolve(REPO, "mcp-server", "lib");

// The dynamic values the satori layer will draw. Everything else (brand,
// eyebrows, divider, planet, glows, grid, pill shell + dot) is baked.
const SAMPLES = {
  won: {
    won: true,
    outcomeWord: "Yes",
    marketTitle: "Spain beats Belgium",
    marketSubtitle: "World Cup 2026 · Jul 10, 2026",
    statusLine: "Market resolved",
    pnl: 6.52,
    currency: "USDC",
    roiPercent: 32.6,
    statusLabel: "Won",
  },
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
};

// Nodes hidden before the background screenshot (their pixels move to the
// satori layer). Everything not listed stays baked into the PNG.
const HIDE = [
  ".result-line strong",
  ".check",
  ".market-title",
  ".market-sub",
  ".muted",
  ".pnl-value",
  ".roi",
  ".status-pill span:last-child",
];

// --- dev-server boot (copied from scripts/render-card.mjs) --------------------

function node22BinDir() {
  if (process.env.VINEXT_NODE_BIN) return process.env.VINEXT_NODE_BIN;
  if (Number(process.versions.node.split(".")[0]) >= 22) return null;
  const candidates = [
    "/opt/homebrew/opt/node@22/bin",
    "/opt/homebrew/opt/node/bin",
    "/usr/local/opt/node@22/bin",
    "/usr/local/opt/node/bin",
  ];
  const cache = join(homedir(), ".cache", "world-pnl-card");
  try {
    for (const d of readdirSync(cache))
      if (/^node-v2[2-9].*-darwin/.test(d)) candidates.unshift(join(cache, d, "bin"));
  } catch {}
  for (const c of candidates) {
    if (!existsSync(join(c, "node"))) continue;
    try {
      execFileSync(join(c, "node"), ["-v"], { stdio: ["ignore", "ignore", "ignore"] });
      return c;
    } catch {}
  }
  return null;
}

async function waitForServerReady(child, timeoutMs = 120000) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let buf = "";
    const urlRe = /(https?:\/\/(?:localhost|127\.0\.0\.1):(\d+))/;
    const deadline = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("dev server did not become ready in time"));
      }
    }, timeoutMs);
    async function tryUrl(url) {
      for (let i = 0; i < 60 && !settled; i++) {
        try {
          const res = await fetch(url, { redirect: "manual" });
          if (res.status < 500) {
            if (!settled) {
              settled = true;
              clearTimeout(deadline);
              resolvePromise(url.replace(/\/$/, ""));
            }
            return;
          }
        } catch {}
        await sleep(1000);
      }
    }
    function onData(d) {
      const s = d.toString();
      buf += s;
      process.stderr.write(s);
      const m = buf.match(urlRe);
      if (m && !settled) {
        buf = "";
        tryUrl(m[1] + "/");
      }
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadline);
        reject(new Error(`dev server exited early (code ${code})`));
      }
    });
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 3000);
}

// --- measurement --------------------------------------------------------------

// Runs in the page. Returns device-px geometry (CSS px * dpr) + font styles for
// each selector, so the satori canvas (3072x2048) can place them 1:1.
// Playwright passes a single arg to evaluate(), so take one object.
function measureInPage({ selectors, dpr }) {
  const pick = (cs) => ({
    fontSize: parseFloat(cs.fontSize) * dpr,
    fontWeight: cs.fontWeight,
    color: cs.color,
    letterSpacing: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) * dpr,
    lineHeight:
      cs.lineHeight === "normal" ? parseFloat(cs.fontSize) * 1.2 * dpr : parseFloat(cs.lineHeight) * dpr,
    textTransform: cs.textTransform,
    columnGap: cs.columnGap === "normal" ? 0 : parseFloat(cs.columnGap) * dpr,
    marginRight: parseFloat(cs.marginRight || "0") * dpr,
  });
  const out = {};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) {
      out[sel] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    out[sel] = {
      rect: { x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr },
      style: pick(getComputedStyle(el)),
    };
  }
  return out;
}

const MEASURE = [
  ".result-line",
  ".result-line strong",
  ".check",
  ".market-title",
  ".market-sub",
  ".muted",
  ".pnl-block .eyebrow", // kept for reference (baked); harmless
  ".pnl-row",
  ".pnl-value",
  ".pnl-value span",
  ".roi",
  ".roi span",
  ".status-pill",
  ".status-pill span:last-child",
];

async function bakeVariant(browser, baseUrl, name, data) {
  const url = `${baseUrl}/?data=${encodeURIComponent(JSON.stringify(data))}`;
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DSF });
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(
      () => {
        const imgs = Array.from(document.images);
        return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      },
      { timeout: 15000 }
    )
    .catch(() => {});
  await sleep(400);

  // 1. measure the visible render
  const measured = await page.evaluate(measureInPage, { selectors: MEASURE, dpr: DSF });

  // 2. hide dynamic nodes, screenshot the background as JPEG (opaque, no alpha
  //    needed — the page fills the frame with #000 around the card).
  await page.addStyleTag({ content: `${HIDE.join(",")} { visibility: hidden !important; }` });
  await sleep(150);
  const bgPath = resolve(ASSETS, `${name}-bg.jpg`);
  await page.screenshot({
    path: bgPath,
    type: "jpeg",
    quality: 82,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  await page.close();
  console.error(`[bake] wrote ${bgPath}`);
  return measured;
}

// Shrink public/checkmark-badge.png (it's ~530KB) to a small overlay-sized PNG,
// keeping alpha. Uses macOS `sips` (bake is dev-time / macOS only).
function makeBadge() {
  const src = resolve(REPO, "public", "checkmark-badge.png");
  const dst = resolve(ASSETS, "checkmark-badge.png");
  try {
    execFileSync("sips", ["-Z", "220", src, "--out", dst], { stdio: "ignore" });
  } catch {
    // sips unavailable — fall back to the full-res badge.
    writeFileSync(dst, readFileSync(src));
  }
  return dst;
}

// The baked backgrounds are soft gradients/glows/planet — safe to store at a
// smaller size and let satori upscale to the 3072-wide canvas. Keeps the
// embedded bundle small. (Coordinates stay device-px @3072x2048.)
function shrinkBg(name) {
  const p = resolve(ASSETS, `${name}-bg.jpg`);
  try {
    execFileSync("sips", ["-Z", "1792", "-s", "formatOptions", "60", p], { stdio: "ignore" });
  } catch {}
}

// Emit ONE self-contained module (layout manifest + base64 assets) so the hosted
// server loads NO files at runtime and needs no JSON import assertions — works on
// any host (Node, edge, Deno, Workers). Fonts come from assets/fonts/.
function packGenerated(layout) {
  const b64 = (p) => readFileSync(p).toString("base64");
  const fontDir = resolve(ASSETS, "fonts");
  const fonts = {};
  for (const w of [400, 500, 600, 700]) {
    const f = resolve(fontDir, `Geist-${w}.woff`);
    if (existsSync(f)) fonts[w] = b64(f);
    else console.error(`[bake] WARN missing font ${f}`);
  }
  const mod =
    "// AUTO-GENERATED by scripts/bake-card.mjs — do not edit by hand.\n" +
    "// Layout manifest + base64 assets (bg JPEGs, badge PNG, Geist WOFFs).\n" +
    `export const layout = ${JSON.stringify(layout)};\n` +
    `export const bgWon = ${JSON.stringify(b64(resolve(ASSETS, "won-bg.jpg")))};\n` +
    `export const bgLost = ${JSON.stringify(b64(resolve(ASSETS, "lost-bg.jpg")))};\n` +
    `export const badge = ${JSON.stringify(b64(resolve(ASSETS, "checkmark-badge.png")))};\n` +
    `export const fonts = ${JSON.stringify(fonts)};\n`;
  const p = resolve(LIB, "generated.js");
  writeFileSync(p, mod);
  const kb = (Buffer.byteLength(mod) / 1024) | 0;
  console.error(`[bake] wrote ${p} (${kb}KB self-contained bundle)`);
}

async function main() {
  if (!existsSync(ASSETS)) mkdirSync(ASSETS, { recursive: true });
  if (!existsSync(LIB)) mkdirSync(LIB, { recursive: true });

  let child = null;
  let baseUrl = process.env.RENDER_BASE_URL;
  try {
    if (!baseUrl) {
      const binDir = node22BinDir();
      const childEnv = { ...process.env };
      if (binDir) {
        childEnv.PATH = `${binDir}:${childEnv.PATH}`;
        console.error(`[bake] using Node from ${binDir} for the dev server`);
      }
      console.error("[bake] starting dev server (npm run dev)…");
      child = spawn("npm", ["run", "dev"], {
        cwd: REPO,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
      baseUrl = await waitForServerReady(child);
    }
    console.error(`[bake] server ready at ${baseUrl}`);

    const browser = await chromium.launch();
    const layout = {
      canvas: { w: VIEWPORT.width * DSF, h: VIEWPORT.height * DSF },
      deviceScaleFactor: DSF,
      variants: {},
    };
    for (const [name, data] of Object.entries(SAMPLES)) {
      layout.variants[name] = await bakeVariant(browser, baseUrl, name, data);
    }
    await browser.close();

    const layoutPath = resolve(LIB, "layout.json");
    writeFileSync(layoutPath, JSON.stringify(layout, null, 2));
    console.error(`[bake] wrote ${layoutPath}`);

    makeBadge();
    shrinkBg("won");
    shrinkBg("lost");
    packGenerated(layout);
  } finally {
    killTree(child);
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
