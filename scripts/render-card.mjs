#!/usr/bin/env node
// Render the World PnL card to a PNG by driving the live vinext app.
//
// It boots `npm run dev`, opens the page with the card data encoded in the
// query string (?data=<url-encoded JSON>), waits for fonts + artwork, and
// screenshots a fixed 1536x1024 viewport at 2x -> outputs/world-pnl-card-*.png.
//
// Usage:
//   node scripts/render-card.mjs --data-file card.json [--out out.png] [--slug name]
//   node scripts/render-card.mjs --data '<json>'
//
// Env:
//   RENDER_BASE_URL   If set, render against this already-running server and do
//                     NOT spawn/kill a dev server (fast iteration).

import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { chromium } from "playwright";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWPORT = { width: 1536, height: 1024 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// vinext requires Node >= 22 (uses node:fs/promises `glob`). This script itself
// may run under an older node, and the spawned `npm run dev` inherits PATH — so
// find a >=22 node and prepend its bin dir to the dev server's PATH. Override
// with VINEXT_NODE_BIN=/path/to/bin.
function node22BinDir() {
  if (process.env.VINEXT_NODE_BIN) return process.env.VINEXT_NODE_BIN;
  if (Number(process.versions.node.split(".")[0]) >= 22) return null;
  const candidates = [
    "/opt/homebrew/opt/node@22/bin",
    "/opt/homebrew/opt/node/bin",
    "/usr/local/opt/node@22/bin",
    "/usr/local/opt/node/bin",
  ];
  // Self-contained Node 22 provisioned under ~/.cache/world-pnl-card (see SKILL.md).
  const cache = join(homedir(), ".cache", "world-pnl-card");
  try {
    for (const d of readdirSync(cache))
      if (/^node-v2[2-9].*-darwin/.test(d)) candidates.unshift(join(cache, d, "bin"));
  } catch {}
  // Verify the candidate's node actually runs (Homebrew's node can be broken by
  // an icu4c major-version bump).
  for (const c of candidates) {
    if (!existsSync(join(c, "node"))) continue;
    try {
      execFileSync(join(c, "node"), ["-v"], { stdio: ["ignore", "ignore", "ignore"] });
      return c;
    } catch {}
  }
  return null;
}

function parseArgs(argv) {
  const a = { dataFile: null, data: null, out: null, slug: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--data-file") a.dataFile = argv[++i];
    else if (k === "--data") a.data = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--slug") a.slug = argv[++i];
  }
  return a;
}

function slugify(s) {
  return (
    String(s || "card")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "card"
  );
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
      // Poll until the root route answers.
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
        buf = ""; // avoid re-matching the same URL repeatedly
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = args.dataFile ? readFileSync(args.dataFile, "utf8") : args.data;
  if (!raw) {
    console.error("provide --data-file <path> or --data '<json>'");
    process.exit(1);
  }
  const data = JSON.parse(raw);

  const outDir = resolve(REPO, "outputs");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out =
    args.out ||
    resolve(outDir, `world-pnl-card-${slugify(args.slug || data.marketTitle)}.png`);

  let child = null;
  let baseUrl = process.env.RENDER_BASE_URL;
  try {
    if (!baseUrl) {
      const binDir = node22BinDir();
      const childEnv = { ...process.env };
      if (binDir) {
        childEnv.PATH = `${binDir}:${childEnv.PATH}`;
        console.error(`[render] using Node from ${binDir} for the dev server`);
      }
      console.error("[render] starting dev server (npm run dev)…");
      child = spawn("npm", ["run", "dev"], {
        cwd: REPO,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      });
      baseUrl = await waitForServerReady(child);
    }
    console.error(`[render] server ready at ${baseUrl}`);

    const url = `${baseUrl}/?data=${encodeURIComponent(JSON.stringify(data))}`;
    const browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    // Wait for web fonts and card artwork to be fully painted.
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

    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    await browser.close();
    console.error(`[render] wrote ${out}`);
    console.log(out);
  } finally {
    killTree(child);
  }
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
