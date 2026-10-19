"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/electrum";
import { loadSubgroups } from "@/lib/load";
import { fetchTokenDoc, safeHttpUrl, type TokenDoc } from "@/lib/token-doc";
import { useRouter } from "next/navigation";
import { chains } from "@/lib/chains";
import { authorityText, formatNumber, formatTokenUnits, shortId } from "@/lib/format";
import { knownTokenIcon } from "@/lib/known-tokens";
import { addressHref, blockHref, tokenHref, txHref } from "@/lib/routes";
import { apiAuthorities, apiRichList, apiSubgroups, apiTokenStats, apiTokenTxs, TOKEN_API_DOCS, type ApiAuthority, type ApiTokenStats, type ApiTokenTx } from "@/lib/token-api";
import type { ChainId, SubgroupRow, TokenModel } from "@/lib/types";

export function TokenLookup({ chainId }: { chainId: ChainId }) {
  const chain = chains[chainId];
  const router = useRouter();
  return (
    <>
      <p className="eyebrow">Tokens · {chain.name}</p>
      <h1>{chainId === "nexa" ? "Group tokens" : "CashTokens"}</h1>
      <p className="lead">
        {chainId === "nexa"
          ? "Nexa carries tokens in the same transaction as the coin. Paste a group id to ask the server for its genesis record, or pick one from the list below."
          : "Bitcoin Cash carries tokens as CashTokens. Paste a category id to ask the server for its genesis record. There is no list of every token."}
      </p>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const id = String(data.get("id") ?? "").trim();
          if (!id) return;
          router.push(tokenHref(chainId, id));
        }}
      >
        <label className="vh" htmlFor="token-id">
          Token id
        </label>
        <input id="token-id" name="id" placeholder="Token id" autoComplete="off" />
        <button type="submit">Look up</button>
      </form>
      {chainId === "nexa" ? <TopTokens chainId={chainId} /> : null}
    </>
  );
}

type TokenStats = {
  source: string;
  fetchedAt: string;
  lastBlock: number;
  tokens: { id: string; name: string | null; ticker: string | null; txs: number; holders: number }[];
};

function TopTokens({ chainId }: { chainId: ChainId }) {
  const [data, setData] = useState<TokenStats | null | "failed">(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    fetch(`/data/${chainId}-tokens.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: TokenStats) => setData(Array.isArray(d.tokens) ? d : "failed"))
      .catch(() => setData("failed"));
  }, [chainId]);
  if (data === null) return <p className="muted">Loading the token list…</p>;
  if (data === "failed") return <p className="muted">The token list is not available right now.</p>;
  const rows = all ? data.tokens : data.tokens.slice(0, 50);
  return (
    <section className="toptokens">
      <h2>Tokens by transfers</h2>
      <p className="muted">
        {formatNumber(data.tokens.length)} tokens, most transfers first. Indexed from our own Nexa node up to block{" "}
        {formatNumber(data.lastBlock)}, updated {new Date(data.fetchedAt).toLocaleString()}.
      </p>
      <table className="ledger">
        <thead>
          <tr>
            <th className="r">#</th>
            <th>Token</th>
            <th className="r">Transfers</th>
            <th className="r">Holders</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const icon = knownTokenIcon(chainId, t.id);
            return (
              <tr key={t.id}>
                <td className="r">{i + 1}</td>
                <td>
                  <Link href={tokenHref(chainId, t.id)} className="toptoken">
                    {icon ? <img src={icon} alt="" width={24} height={24} /> : <span className="noicon" aria-hidden="true" />}
                    <span>
                      {t.name ?? shortId(t.id, 12, 6)}
                      {t.ticker ? <span className="muted"> {t.ticker}</span> : null}
                    </span>
                  </Link>
                </td>
                <td className="r">{formatNumber(t.txs)}</td>
                <td className="r">{formatNumber(t.holders)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!all && data.tokens.length > rows.length ? (
        <button type="button" onClick={() => setAll(true)}>
          Show all {formatNumber(data.tokens.length)}
        </button>
      ) : null}
    </section>
  );
}

export function TokenView({ token }: { token: TokenModel }) {
  const chain = chains[token.chain];
  const [doc, setDoc] = useState<TokenDoc | null | "failed">(null);
  useEffect(() => {
    let live = true;
    fetchTokenDoc(token.documentUrl, token.documentHash, token.doc)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc("failed"));
    return () => {
      live = false;
    };
  }, [token.documentUrl, token.documentHash, token.doc]);
  const docIcon = doc && doc !== "failed" ? safeHttpUrl(doc.meta?.icon, doc.url) : null;
  const icon = token.icon ?? docIcon;
  return (
    <>
      <nav className="crumb" aria-label="Breadcrumb">
        <Link href={`/${token.chain}`}>{chain.name}</Link>
        <span aria-hidden="true"> · </span>
        <Link href={`/${token.chain}/tokens`}>Tokens</Link>
        <span aria-hidden="true"> · </span>
        <span>{token.ticker ?? "Token"}</span>
      </nav>
      <p className="eyebrow">Token · {chain.name}</p>
      <h1 className="token-title">
        {icon ? <img src={icon} alt="" width={48} height={48} /> : null}
        {token.name && token.ticker ? `${token.name} (${token.ticker})` : (token.ticker ?? token.name ?? shortId(token.id, 12, 6))}
      </h1>
      <p className="lead">
        {token.name ?? "The server returned a genesis record without a name."}
        {token.documentUrl ? (
          <>
            {" "}
            <a href={token.documentUrl}>Document</a>.
          </>
        ) : null}
      </p>
      <div className="hashrow">
        <code>{token.id}</code>
      </div>
      <dl className="facts">
        <div>
          <dt>Name</dt>
          <dd>{token.name ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Ticker</dt>
          <dd>{token.ticker ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Decimals</dt>
          <dd>{token.decimals == null ? "Not reported" : formatNumber(token.decimals)}</dd>
        </div>
        {token.parent ? (
          <div>
            <dt>Subgroup of</dt>
            <dd>
              <Link href={tokenHref(token.chain, token.parent)}>{shortId(token.parent, 12, 6)}</Link>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Genesis</dt>
          <dd>
            {token.txid ? <Link href={txHref(token.chain, token.txid)}>{shortId(token.txid, 12, 6)}</Link> : "Not reported"}
            {token.height != null ? (
              <>
                {" · "}
                <Link href={blockHref(token.chain, token.height)}>{formatNumber(token.height)}</Link>
              </>
            ) : null}
          </dd>
        </div>
      </dl>
      {token.chain === "nexa" ? <ApiFacts token={token} /> : null}
      {token.documentUrl ? <TokenDocument url={token.documentUrl} doc={doc} /> : null}
      {token.chain === "nexa" ? (
        <>
          <Holders token={token} />
          <TokenTxs token={token} />
          <Authorities token={token} />
          <Subgroups chainId={token.chain} group={token.group} />
          <p className="muted">
            {token.source === "token-api" ? "Token details from the " : "Genesis record from our Rostrum server; the "}
            <a href={TOKEN_API_DOCS} rel="noopener noreferrer">Bitcoin Unlimited token API</a>
            {token.source === "token-api" ? "." : " did not answer."}
          </p>
        </>
      ) : null}
    </>
  );
}

function useApi<T>(load: () => Promise<T>, key: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    load()
      .then((d) => live && setData(d))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return data;
}

function ApiFacts({ token }: { token: TokenModel }) {
  const stats = useApi<ApiTokenStats>(() => apiTokenStats(token.group), token.group);
  if (!stats || (stats.supply === "0" && !stats.holders && !stats.txs)) return null;
  return (
    <dl className="facts">
      {stats.supply && stats.supply !== "0" ? (
        <div>
          <dt>Circulating supply</dt>
          <dd>
            {formatTokenUnits(stats.supply, token.decimals)} {token.ticker}
          </dd>
        </div>
      ) : null}
      {stats.holders ? (
        <div>
          <dt>Holders</dt>
          <dd>{formatNumber(stats.holders)}</dd>
        </div>
      ) : null}
      {stats.txs != null ? (
        <div>
          <dt>Transactions</dt>
          <dd>{formatNumber(stats.txs)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function Holders({ token }: { token: TokenModel }) {
  const rows = useApi(() => apiRichList(token.group, 10), token.group);
  if (!rows?.length) return null;
  return (
    <section className="subgroups">
      <h2>Top holders</h2>
      <table>
        <thead>
          <tr>
            <th>Address</th>
            <th className="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.address}>
              <td>
                <Link href={addressHref(token.chain, row.address)}>
                  <code>{shortId(row.address, 18, 6)}</code>
                </Link>
              </td>
              <td className="r">{formatTokenUnits(row.amount, token.decimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TokenTxs({ token }: { token: TokenModel }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ApiTokenTx[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let live = true;
    apiTokenTxs(token.group, page)
      .then((r) => {
        if (!live) return;
        setRows((old) => (page === 1 ? r.rows : [...old, ...r.rows]));
        setTotal(r.total);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token.group, page]);
  if (!rows.length) return null;
  return (
    <section className="subgroups">
      <h2>Token transactions</h2>
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Operation</th>
            <th>Block</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.txid}>
              <td>
                <Link href={txHref(token.chain, row.txid)}>{shortId(row.txid, 10, 6)}</Link>
              </td>
              <td>{row.operation || "–"}</td>
              <td>{row.height != null ? <Link href={blockHref(token.chain, row.height)}>{formatNumber(row.height)}</Link> : "Mempool"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length < total ? (
        <button type="button" onClick={() => setPage((p) => p + 1)}>
          More transactions ({formatNumber(total - rows.length)} left)
        </button>
      ) : null}
    </section>
  );
}

function Authorities({ token }: { token: TokenModel }) {
  const rows = useApi<ApiAuthority[]>(() => apiAuthorities(token.group), token.group);
  if (!rows?.length) return null;
  return (
    <section className="subgroups">
      <h2>Live authorities</h2>
      <table>
        <thead>
          <tr>
            <th>Authority</th>
            <th>Held by</th>
            <th>Output of</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.txid}-${i}`}>
              <td>{authorityText(row.flags)}</td>
              <td>{row.address ? <Link href={addressHref(token.chain, row.address)}>{shortId(row.address, 14, 6)}</Link> : "–"}</td>
              <td>
                <Link href={txHref(token.chain, row.txid)}>{shortId(row.txid, 10, 6)}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Token API pages (numbers) first; Rostrum token.nft.list (opaque cursor) if the API fails.
function Subgroups({ chainId, group }: { chainId: ChainId; group: string }) {
  const [rows, setRows] = useState<SubgroupRow[]>([]);
  const [cursor, setCursor] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const more = async (from: unknown, reset = false) => {
    setBusy(true);
    try {
      const at = from as { api?: number; rostrum?: unknown } | null;
      const api = at?.rostrum === undefined ? await apiSubgroups(group, at?.api ?? 1).catch(() => null) : null;
      const n = at?.api ?? 1;
      const page = api
        ? { rows: api.rows, cursor: n * 25 < api.total ? { api: n + 1 } : null }
        : await loadSubgroups(await getSession(chainId), group, at?.rostrum ?? null).then((p) => ({ rows: p.rows, cursor: p.cursor == null ? null : { rostrum: p.cursor } }));
      setRows((old) => (reset ? page.rows : [...old, ...page.rows]));
      setCursor(page.cursor);
    } catch {
      if (reset) setRows([]);
      setCursor(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void more(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, group]);
  if (!rows.length) return null;
  return (
    <section className="subgroups">
      <h2>Subgroups</h2>
      <table>
        <thead>
          <tr>
            <th>Subgroup</th>
            <th>Minted in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.group}>
              <td>
                <Link href={tokenHref(chainId, row.group)}>
                  <code>{shortId(row.group, 14, 10)}</code>
                </Link>
              </td>
              <td>
                {row.txid ? <Link href={txHref(chainId, row.txid)}>{shortId(row.txid, 10, 6)}</Link> : "Not reported"}
                {row.height != null ? (
                  <>
                    {" · "}
                    <Link href={blockHref(chainId, row.height)}>{formatNumber(row.height)}</Link>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor != null ? (
        <button type="button" disabled={busy} onClick={() => void more(cursor)}>
          {busy ? "Loading…" : "More subgroups"}
        </button>
      ) : null}
    </section>
  );
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function linkFor(value: unknown, base: string): string | null {
  const text = str(value);
  if (!text) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`;
  return safeHttpUrl(text, base);
}

function TokenDocument({ url, doc }: { url: string; doc: TokenDoc | null | "failed" }) {
  const source = safeHttpUrl(url);
  const meta = doc && doc !== "failed" ? doc.meta : null;
  const links: { label: string; href: string }[] = [];
  if (doc && doc !== "failed" && meta) {
    const contact = meta.contact && typeof meta.contact === "object" ? (meta.contact as Record<string, unknown>) : {};
    for (const [label, value] of [["legal", meta.legal], ["website", meta.website], ["web", meta.web], ...Object.entries(contact)] as [string, unknown][]) {
      const href = linkFor(value, doc.url);
      if (href && !links.some((l) => l.href === href)) links.push({ label, href });
    }
  }
  const icon = doc && doc !== "failed" ? safeHttpUrl(meta?.icon, doc.url) : null;
  return (
    <section className="tokendoc">
      <h2>Token document</h2>
      <p className="muted">
        Source: {source ? <a href={source} rel="noopener noreferrer nofollow">{source}</a> : <code>{url}</code>}
        {doc && doc !== "failed" ? (doc.via === "proxy" ? " (fetched through the explorer proxy, not stored)" : doc.via === "token-api" ? " (copy cached by the token API)" : " (fetched by your browser)") : null}
      </p>
      {doc === null ? <p>Loading the document…</p> : null}
      {doc === "failed" ? <p>The document could not be fetched.</p> : null}
      {doc && doc !== "failed" ? (
        <>
          <p className={`dochash ${doc.hash}`}>
            {doc.hash === "match"
              ? "✓ Matches the hash recorded on chain."
              : doc.hash === "mismatch"
                ? "✗ Does not match the hash recorded on chain. The document may have changed since genesis."
                : "Hash not checked."}
          </p>
          {meta ? (
            <dl className="facts">
              {icon ? (
                <div>
                  <dt>Icon</dt>
                  <dd>
                    <img src={icon} alt="" width={64} height={64} referrerPolicy="no-referrer" />
                  </dd>
                </div>
              ) : null}
              {(["name", "ticker", "summary", "description", "creator", "category"] as const).map((key) =>
                str(meta[key]) ? (
                  <div key={key}>
                    <dt>{key[0].toUpperCase() + key.slice(1)}</dt>
                    <dd>{str(meta[key])}</dd>
                  </div>
                ) : null,
              )}
              {links.length ? (
                <div>
                  <dt>Links</dt>
                  <dd>
                    {links.map((l, i) => (
                      <span key={l.href}>
                        {i ? " · " : null}
                        <a href={l.href} rel="noopener noreferrer nofollow">{l.label}</a>
                      </span>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p>The document is not a JSON token description.</p>
          )}
          {doc.json != null ? (
            <details>
              <summary>Full document (JSON)</summary>
              <pre className="docjson">{JSON.stringify(doc.json, null, 2)}</pre>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
