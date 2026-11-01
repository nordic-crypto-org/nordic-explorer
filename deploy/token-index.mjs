// Indexes Nexa token (group) activity from our own nexad and writes the token list ranked by transaction count,
// plus the latest melts (transactions that destroy token supply).
// Usage: node token-index.mjs <state.json> <out.json>
// Env: NEXA_DATADIR (cookie location), NEXA_RPC (http://127.0.0.1:7227), ROSTRUM (127.0.0.1:20001)
import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { AUTHORITY, meltsInTx, storedQuantity } from "./melts.mjs";

const [statePath = "nexa-token-state.json", out = "nexa-tokens.json"] = process.argv.slice(2);
const datadir = process.env.NEXA_DATADIR ?? "/mnt/HC_Volume_107087011/nexa";
const rpcUrl = process.env.NEXA_RPC ?? "http://127.0.0.1:7227";
const [rHost, rPort] = (process.env.ROSTRUM ?? "127.0.0.1:20001").split(":");
const CONFIRMATIONS = 6;
const STATE_VERSION = 2; // 2: exact quantities as strings, melts list
const KEEP_MELTS = 100;
const auth = "Basic " + Buffer.from(readFileSync(`${datadir}/.cookie`, "utf8").trim()).toString("base64");

async function rpc(calls) {
  const res = await fetch(rpcUrl, { method: "POST", headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "1.0", id, method, params }))) });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  return (await res.json()).sort((a, b) => a.id - b.id).map((r) => { if (r.error) throw new Error(r.error.message); return r.result; });
}

// state: height indexed, per-token counts, live token UTXOs (outpoint -> [group, address, quantity]),
// latest melts (newest last). Quantities are exact decimal strings, or AUTHORITY for authority outputs.
const fresh = (meta = {}) => ({ version: STATE_VERSION, height: -1, tokens: {}, utxos: {}, melts: [], meta });
let s = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : fresh();
if (s.version !== STATE_VERSION) {
  // Older state rounded big quantities through JSON numbers and has no melts: walk the chain again, keep names.
  console.log(`state version ${s.version ?? 1}, reindexing from genesis`);
  s = fresh(s.meta ?? {});
}
const save = () => { writeFileSync(`${statePath}.tmp`, JSON.stringify(s)); renameSync(`${statePath}.tmp`, statePath); };
const isAuthority = (q) => q === AUTHORITY;

const [tip] = await rpc([["getblockcount", []]]);
const target = tip - CONFIRMATIONS;
const BATCH = 50;
let lastSave = Date.now();
for (let h = s.height + 1; h <= target; h += BATCH) {
  const heights = []; for (let i = h; i <= Math.min(target, h + BATCH - 1); i++) heights.push(i);
  const hashes = await rpc(heights.map((i) => ["getblockhash", [i]]));
  const blocks = await rpc(hashes.map((x) => ["getblock", [x, 2]]));
  for (const b of blocks) {
    for (const tx of b.tx) {
      const touched = new Set();
      const ins = [], outs = [];
      for (const vin of tx.vin) {
        const u = vin.outpoint && s.utxos[vin.outpoint];
        if (u) { touched.add(u[0]); ins.push([u[0], u[2]]); delete s.utxos[vin.outpoint]; }
      }
      for (const v of tx.vout) {
        const g = v.scriptPubKey?.group;
        if (!g) continue;
        touched.add(g);
        const q = storedQuantity(v.scriptPubKey);
        outs.push([g, q]);
        s.utxos[v.outpoint] = [g, v.scriptPubKey.addresses?.[0] ?? null, q];
        if (!s.tokens[g]) s.tokens[g] = { txs: 0, height: b.height };
      }
      for (const g of touched) if (s.tokens[g]) s.tokens[g].txs++;
      for (const m of meltsInTx(ins, outs)) s.melts.push({ txid: tx.txid, height: b.height, time: b.time ?? null, ...m });
      if (s.melts.length > KEEP_MELTS * 2) s.melts = s.melts.slice(-KEEP_MELTS);
    }
    s.height = b.height;
  }
  if (Date.now() - lastSave > 60_000) { save(); lastSave = Date.now(); console.log(`height ${s.height}/${target}`); }
}
save();

// Names and tickers from rostrum's token.genesis.info. Failed lookups are not cached and entries
// without a name or ticker are retried each run (rostrum times out on busy tokens until warm).
function electrum(method, params) {
  return new Promise((resolve, reject) => {
    const c = connect(Number(rPort), rHost, () => c.write(JSON.stringify({ id: 1, method, params }) + "\n"));
    let buf = ""; c.setTimeout(15_000, () => { c.destroy(); reject(new Error("timeout")); });
    c.on("data", (d) => { buf += d; if (buf.includes("\n")) { c.end(); const r = JSON.parse(buf); if (r.error) reject(new Error(r.error.message)); else resolve(r.result); } });
    c.on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
for (const g of Object.keys(s.tokens)) {
  const m = s.meta[g];
  if (((m?.name || m?.ticker) && m.decimals !== undefined) || g.length > 66) continue; // skip subgroups (NFTs); parent groups are 66 chars
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const i = await electrum("token.genesis.info", [g]);
      s.meta[g] = { name: i.name ?? null, ticker: i.ticker ?? null, decimals: typeof i.decimal_places === "number" ? i.decimal_places : null };
      break;
    }
    catch { if (attempt < 3) await sleep(2_000 * attempt); else failed++; } // leave uncached so the next run retries
  }
}
if (failed) console.log(`${failed} token name lookups failed, will retry next run`);
save();

const holders = {};
for (const [g, addr, q] of Object.values(s.utxos)) if (addr && !isAuthority(q)) (holders[g] ??= new Set()).add(addr);
const list = Object.entries(s.tokens).filter(([g]) => g.length <= 66)
  .map(([id, t]) => ({ id, name: s.meta[id]?.name ?? null, ticker: s.meta[id]?.ticker ?? null, txs: t.txs, holders: holders[id]?.size ?? 0 }))
  .sort((a, b) => b.txs - a.txs);
// Newest first. Ids longer than 66 chars are subgroups (NFTs): no name lookup, whole units.
const melts = s.melts.slice(-KEEP_MELTS).reverse().map((m) => {
  const sub = m.group.length > 66, meta = sub ? null : s.meta[m.group];
  return { ...m, subgroup: sub, name: meta?.name ?? null, ticker: meta?.ticker ?? null, decimals: sub ? 0 : (meta?.decimals ?? null) };
});
writeFileSync(`${out}.tmp`, JSON.stringify({ source: "nexad", fetchedAt: new Date().toISOString(), lastBlock: s.height, tokens: list, melts }));
renameSync(`${out}.tmp`, out);
console.log(`${list.length} tokens, ${s.melts.length} melts kept, block ${s.height}`);
