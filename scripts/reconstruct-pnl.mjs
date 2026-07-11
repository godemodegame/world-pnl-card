#!/usr/bin/env node
// Reconstruct World prediction-market PnL for a Solana wallet from on-chain
// transaction history.
//
// Why on-chain? The World MCP connector exposes no PnL endpoint — only current
// holdings, this connector's trade tx-hashes, and market metadata. A closed
// position's realized PnL (and even the closing trade, if it happened outside
// this connector) is not available from MCP. It *is* fully recoverable from the
// wallet's SPL token balance deltas per transaction.
//
// This script does the pure on-chain math and has NO access to MCP. It emits
// candidate outcome-token mints + per-mint cash flows. The caller (the skill)
// resolves those mints -> markets via `world_filter_outcome_mints`, writes a
// small markets.json, and re-runs this script with `--markets markets.json` to
// get final, render-ready card data.
//
// Usage:
//   node scripts/reconstruct-pnl.mjs <wallet>                     # emit mints + flows
//   node scripts/reconstruct-pnl.mjs <wallet> --markets m.json    # emit card data
//   node scripts/reconstruct-pnl.mjs <wallet> --json flows.json   # reuse cached flows
//
// Env:
//   SOLANA_RPC_URL   RPC endpoint (default https://api.mainnet-beta.solana.com)

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

// USD-pegged tokens used to price entries/exits. Both are treated as $1.
const STABLE = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH: "CASH",
};

const EPS = 1e-6; // treat |shares| below this as zero (dust / rounding)

function parseArgs(argv) {
  const args = { wallet: null, markets: null, cache: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--markets") args.markets = argv[++i];
    else if (a === "--json" || a === "--cache") args.cache = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("--") && !args.wallet) args.wallet = a;
  }
  return args;
}

async function rpc(method, params, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch {
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    const body = await res.json();
    if (body.error) {
      // Rate-limit errors sometimes arrive in the JSON body.
      if (String(body.error.message || "").match(/rate|limit|429/i)) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result;
  }
  throw new Error(`RPC ${method} failed after ${tries} attempts`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAllSignatures(wallet, cap = 1000) {
  const sigs = [];
  let before;
  while (sigs.length < cap) {
    const batch = await rpc("getSignaturesForAddress", [
      wallet,
      { limit: 1000, ...(before ? { before } : {}) },
    ]);
    if (!batch || batch.length === 0) break;
    sigs.push(...batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < 1000) break;
  }
  return sigs;
}

// Wallet-owned SPL balance (uiAmount) per mint, from a token-balance list.
function ownedBalances(list, wallet) {
  const m = {};
  for (const b of list || []) {
    if (b.owner !== wallet) continue;
    const amt =
      b.uiTokenAmount.uiAmount ??
      Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals;
    m[b.mint] = (m[b.mint] || 0) + amt;
  }
  return m;
}

// Fetch every tx, compute per-mint deltas, and aggregate flows by outcome mint.
async function computeFlows(wallet) {
  const sigs = await getAllSignatures(wallet);
  // Oldest -> newest so "latest post balance" logic is correct.
  const ordered = [...sigs].reverse();

  const flows = {}; // mint -> aggregate
  const nowShares = {}; // mint -> current holding (latest post balance)
  const nowStable = {}; // stable mint -> current holding
  const txsScanned = [];

  // Limited-concurrency fetch preserving order.
  const results = new Array(ordered.length);
  const CONC = 4;
  let idx = 0;
  async function worker() {
    while (idx < ordered.length) {
      const i = idx++;
      const sig = ordered[i].signature;
      if (ordered[i].err) {
        results[i] = null;
        continue;
      }
      results[i] = await rpc("getTransaction", [
        sig,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  for (let i = 0; i < ordered.length; i++) {
    const tx = results[i];
    if (!tx || tx.meta?.err) continue;
    const meta = tx.meta;
    const blockTime = tx.blockTime;
    const sig = ordered[i].signature;
    const pre = ownedBalances(meta.preTokenBalances, wallet);
    const post = ownedBalances(meta.postTokenBalances, wallet);

    const mints = new Set([...Object.keys(pre), ...Object.keys(post)]);
    const delta = {};
    for (const mint of mints) delta[mint] = (post[mint] || 0) - (pre[mint] || 0);

    // Update current holdings: the latest tx touching a mint sets its balance.
    // A closed/emptied token account appears in pre but not post -> balance 0.
    for (const mint of mints) {
      const bal = post[mint] ?? 0;
      if (mint in STABLE) nowStable[mint] = bal;
      else nowShares[mint] = bal;
    }

    // Net stable movement this tx (USD terms).
    let stableDelta = 0;
    for (const mint of Object.keys(STABLE)) stableDelta += delta[mint] || 0;

    // Outcome mints that moved this tx.
    const outcomeMoved = [...mints].filter(
      (mt) => !(mt in STABLE) && Math.abs(delta[mt]) > EPS
    );
    if (outcomeMoved.length === 0) continue; // deposit/withdraw/rent only

    // Attribute the stable movement to the outcome mint(s) that moved. When one
    // mint moved (the common case) it gets all of it; otherwise split by |shares|.
    const totalAbs = outcomeMoved.reduce((s, mt) => s + Math.abs(delta[mt]), 0);
    for (const mt of outcomeMoved) {
      const share = outcomeMoved.length === 1 ? 1 : Math.abs(delta[mt]) / totalAbs;
      const f =
        flows[mt] ||
        (flows[mt] = {
          mint: mt,
          costBasis: 0,
          proceeds: 0,
          buyShares: 0,
          sellShares: 0,
          firstTs: blockTime,
          lastTs: blockTime,
          sigs: [],
        });
      const sd = stableDelta * share;
      if (delta[mt] > 0) {
        // Acquired shares: stable should be flowing out (sd < 0).
        f.costBasis += Math.max(0, -sd);
        f.buyShares += delta[mt];
      } else {
        // Disposed shares (sell or redeem): stable flows in (sd > 0).
        f.proceeds += Math.max(0, sd);
        f.sellShares += -delta[mt];
      }
      f.firstTs = Math.min(f.firstTs, blockTime);
      f.lastTs = Math.max(f.lastTs, blockTime);
      f.sigs.push(sig);
    }
    txsScanned.push(sig);
  }

  // Attach current remaining shares.
  for (const mt of Object.keys(flows)) {
    flows[mt].remainingShares = nowShares[mt] || 0;
  }

  return {
    wallet,
    rpc: RPC,
    txCount: txsScanned.length,
    candidateMints: Object.keys(flows),
    flows: Object.values(flows),
    holdings: { shares: nowShares, stable: nowStable },
  };
}

// Round to cents / one-decimal ROI for display.
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

// Merge on-chain flows with caller-supplied market metadata -> card data.
function buildPositions(flowData, markets) {
  const positions = [];
  for (const f of flowData.flows) {
    const meta = markets[f.mint];
    if (!meta) continue; // not a resolved outcome mint the caller cared about

    const remaining = f.remainingShares || 0;
    const open = remaining > EPS;
    const markUsd = typeof meta.markUsd === "number" ? meta.markUsd : 1;
    const unrealized = open ? remaining * markUsd : 0;

    const pnl = f.proceeds + unrealized - f.costBasis;
    const roiPercent = f.costBasis > EPS ? (pnl / f.costBasis) * 100 : 0;

    let won, statusLabel, statusLine, outcomeWord;
    if (open) {
      won = pnl >= 0;
      statusLabel = "Open";
      statusLine = "Position open";
      outcomeWord = meta.side === "no" ? "No" : "Yes";
    } else {
      won = pnl >= 0;
      statusLabel = won ? "Won" : "Lost";
      statusLine = "Market resolved";
      outcomeWord = won ? "Yes" : "No";
    }

    positions.push({
      mint: f.mint,
      side: meta.side || null,
      won,
      outcomeWord,
      marketTitle: meta.marketTitle || "",
      marketSubtitle: meta.marketSubtitle || "",
      statusLine,
      pnl: r2(pnl),
      currency: "USDC",
      roiPercent: r1(roiPercent),
      statusLabel,
      // diagnostics (not used by the card):
      costBasis: r2(f.costBasis),
      proceeds: r2(f.proceeds),
      remainingShares: r2(remaining),
      lastTs: f.lastTs,
      status: meta.status || null,
    });
  }
  // Newest first.
  positions.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  return positions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.wallet) {
    console.error("usage: reconstruct-pnl.mjs <wallet> [--markets m.json] [--json cache.json]");
    process.exit(1);
  }

  let flowData;
  if (args.cache && existsSync(args.cache)) {
    flowData = JSON.parse(readFileSync(args.cache, "utf8"));
  } else {
    flowData = await computeFlows(args.wallet);
    if (args.cache) writeFileSync(args.cache, JSON.stringify(flowData, null, 2));
  }

  let out;
  if (args.markets) {
    const markets = JSON.parse(readFileSync(args.markets, "utf8"));
    out = { wallet: args.wallet, positions: buildPositions(flowData, markets) };
  } else {
    out = flowData;
  }

  const text = JSON.stringify(out, null, 2);
  if (args.out) writeFileSync(args.out, text);
  console.log(text);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
