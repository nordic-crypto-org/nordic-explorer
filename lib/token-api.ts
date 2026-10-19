import type { SubgroupRow } from "./types";

// Bitcoin Unlimited token API (Otoplo TokenApi). CORS is open (*); no documented rate limit.
const TOKEN_API = "https://tokenapi.bitcoinunlimited.info/api/v1/tokens/";
export const TOKEN_API_DOCS = "https://tokenapi.bitcoinunlimited.info/swagger-ui/index.html";
const HOUR = 3600_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (typeof v === "string" && /^-?\d+$/.test(v) ? v : typeof v === "number" && Number.isInteger(v) ? String(v) : null);

function stored(path: string, ttl: number): unknown {
  try {
    const hit = JSON.parse(localStorage.getItem(`tokenapi:${path}`) ?? "null") as { at: number; v: unknown } | null;
    return hit && Date.now() - hit.at < ttl ? hit.v : undefined;
  } catch {
    return undefined;
  }
}

// Replies are kept in memory for `ttl`; metadata (persist) also in localStorage. Failures are not cached.
export function tokenApiGet<T>(path: string, ttl = 5 * 60_000, persist = false): Promise<T> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const saved = persist ? stored(path, ttl) : undefined;
  const value =
    saved !== undefined
      ? Promise.resolve(saved)
      : fetch(TOKEN_API + path, { signal: AbortSignal.timeout(8000), credentials: "omit" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  memo.set(path, { at: Date.now(), value });
  value.then(
    (v) => {
      if (!persist || saved !== undefined) return;
      try {
        localStorage.setItem(`tokenapi:${path}`, JSON.stringify({ at: Date.now(), v }));
      } catch {}
    },
    () => memo.delete(path),
  );
  return value as Promise<T>;
}

export type ApiToken = {
  id: string;
  group: string;
  name: string | null;
  ticker: string | null;
  decimals: number | null;
  documentUrl: string | null;
  documentHash: string | null;
  txid: string | null;
  height: number | null;
  icon: string | null;
  parent: string | null;
  doc: string | null;
};

export function mapApiToken(raw: unknown, iconUrl?: unknown, jsonDoc?: unknown): ApiToken | null {
  const t = (raw ?? {}) as Raw;
  const id = s(t.tokenIdHex);
  if (!id) return null;
  return {
    id,
    group: s(t.token) ?? id,
    name: s(t.name),
    ticker: s(t.ticker),
    decimals: n(t.decimals),
    documentUrl: s(t.documentUrl),
    documentHash: s(t.documentHash),
    txid: s(t.genesisTxIdem) ?? s(t.genesisTxId),
    height: n(t.blockHeight),
    icon: s(iconUrl),
    parent: s(t.parentGroup),
    doc: s(jsonDoc),
  };
}

export async function apiToken(id: string): Promise<ApiToken> {
  const raw = await tokenApiGet<Raw>(`${encodeURIComponent(id)}/metadata`, 24 * HOUR, true);
  const token = mapApiToken(raw?.tokenInfo, raw?.iconUrl, raw?.jsonDoc);
  if (!token) throw new Error("No token");
  return token;
}

/** Name, ticker and icon for display; an unnamed subgroup (NFT) borrows its parent's. */
export async function apiTokenLabel(id: string): Promise<ApiToken> {
  const token = await apiToken(id);
  if (token.name || token.ticker || !token.parent) return token;
  const parent = await apiToken(token.parent).catch(() => null);
  return parent ? { ...token, name: parent.name, ticker: parent.ticker, icon: token.icon ?? parent.icon } : token;
}

export type ApiTokenStats = { supply: string | null; holders: number | null; txs: number | null };

export async function apiTokenStats(id: string): Promise<ApiTokenStats> {
  const t = encodeURIComponent(id);
  const [supply, holders, txs] = await Promise.all([
    tokenApiGet<Raw>(`${t}/supply`).catch(() => null),
    tokenApiGet<Raw>(`${t}/holders`).catch(() => null),
    tokenApiGet<Raw>(`${t}/transactions?page=1&size=1`).catch(() => null),
  ]);
  if (!supply && !holders && !txs) throw new Error("Token API unavailable");
  return { supply: int(supply?.rawSupply), holders: n(holders?.total), txs: n(txs?.total) };
}

export async function apiRichList(id: string, max = 10): Promise<{ address: string; amount: string }[]> {
  const rows = await tokenApiGet<Raw[]>(`${encodeURIComponent(id)}/richlist?max=${max}`);
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const address = s(r.address);
    const amount = int(r.amount);
    return address && amount ? [{ address, amount }] : [];
  });
}

export type ApiTokenTx = { txid: string; operation: string; height: number | null };

export async function apiTokenTxs(id: string, page = 1, size = 10): Promise<{ total: number; rows: ApiTokenTx[] }> {
  const raw = await tokenApiGet<Raw>(`${encodeURIComponent(id)}/transactions?page=${page}&size=${size}&orderDirection=DESC`);
  const list = Array.isArray(raw?.transactions) ? (raw.transactions as Raw[]) : [];
  const rows = list.flatMap((r) => {
    const txid = s(r.txIdem) ?? s(r.txId);
    return txid ? [{ txid, operation: (s(r.operation) ?? "").toLowerCase(), height: n(r.blockHeight) }] : [];
  });
  return { total: n(raw?.total) ?? rows.length, rows };
}

export async function apiSubgroups(id: string, page = 1, size = 25): Promise<{ total: number; rows: SubgroupRow[] }> {
  const raw = await tokenApiGet<Raw>(`${encodeURIComponent(id)}/subgroups?page=${page}&size=${size}`, HOUR);
  const list = Array.isArray(raw?.tokens) ? (raw.tokens as Raw[]) : [];
  const rows = list.flatMap((r) => {
    const t = mapApiToken(r);
    return t ? [{ group: t.group, txid: t.txid, height: t.height }] : [];
  });
  return { total: n(raw?.total) ?? rows.length, rows };
}

export type ApiAuthority = { txid: string; address: string | null; flags: string[] };

export async function apiAuthorities(id: string): Promise<ApiAuthority[]> {
  const rows = await tokenApiGet<Raw[]>(`${encodeURIComponent(id)}/authorities`);
  return (Array.isArray(rows) ? rows : []).flatMap((r) => {
    const utxo = (r.utxo ?? {}) as Raw;
    const txid = s(utxo.txIdem) ?? s(utxo.txId);
    const flags = Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === "string" && f !== "AUTHORITY" && f !== "NONE").map((f) => f.toLowerCase()) : [];
    return txid ? [{ txid, address: s(utxo.address), flags }] : [];
  });
}
