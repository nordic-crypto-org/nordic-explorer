import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatTokenUnits } from "../lib/format";
import { apiAuthorities, apiTokenLabel, mapApiToken } from "../lib/token-api";

// Real replies from tokenapi.bitcoinunlimited.info (2026-10-19).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const NCSHLD = "69bb784cf1c07d48c737cd082f6bd145ab5d7d70edfc346af71aef2957540000";
const GROUP = "nexa:tp5mk7zv78q86jx8xlxsstmt69z6khtawrklcdr27udw722h2sqqqshrajlfj";

function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    return hit ? new Response(JSON.stringify(hit[1])) : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return calls;
}

test("token API metadata maps to name, ticker, icon and genesis txidem", () => {
  const raw = fixture("tokenapi-ncshld-metadata");
  const t = mapApiToken(raw.tokenInfo, raw.iconUrl);
  assert.equal(t?.id, NCSHLD);
  assert.equal(t?.group, GROUP);
  assert.equal(t?.ticker, "NCSHLD");
  assert.equal(t?.name, "Nordic Crypto Shield");
  assert.equal(t?.icon, "https://nft.nordiccrypto.no/ncshld.png");
  assert.equal(t?.txid, "78eeb2a52e6440a774e39f8b8e022f3dde9f83f69654d1968a372ee6a379d679");
  assert.equal(mapApiToken({}), null);
});

test("an unnamed NCSHLD subgroup (minted in 727f5b…1c66) borrows the parent's ticker, once per id", async () => {
  const calls = mockFetch({ [`${NCSHLD}0d00000000000000/metadata`]: fixture("tokenapi-ncshld-13-metadata"), [`${encodeURIComponent(GROUP)}/metadata`]: fixture("tokenapi-ncshld-metadata") });
  const t = await apiTokenLabel(`${NCSHLD}0d00000000000000`);
  assert.equal(t.ticker, "NCSHLD");
  assert.equal(t.decimals, null);
  assert.equal(t.txid, "727f5b270373d56bb1c7242c0ec9304af4b7f7b4fc69d1b0ed950cd1f05b1c66");
  await apiTokenLabel(`${NCSHLD}0d00000000000000`);
  assert.equal(calls.length, 2);
  assert.equal(formatTokenUnits("1", t.decimals), "1");
});

test("failed lookups reject and are retried, not cached", async () => {
  const calls = mockFetch({});
  await assert.rejects(apiTokenLabel("nexa:missing"));
  await assert.rejects(apiTokenLabel("nexa:missing"));
  assert.equal(calls.length, 2);
});

test("authority UTXOs list their flags without the AUTHORITY marker", async () => {
  mockFetch({ [`${NCSHLD}/authorities`]: fixture("tokenapi-ncshld-authorities") });
  const [a] = await apiAuthorities(NCSHLD);
  assert.deepEqual(a.flags, ["mint", "melt", "baton", "rescript", "subgroup"]);
  assert.equal(a.address, "nexa:nqtsq5g5sx7jkjql4kexx7m6rlfrlqk9rqp8hfxrcl75lfsl");
});

test("token amounts are shifted by decimals exactly", () => {
  assert.equal(formatTokenUnits("1250000000", 4), "125,000");
  assert.equal(formatTokenUnits("6640826866534438586", 2), "66,408,268,665,344,385.86");
  assert.equal(formatTokenUnits("5", 4), "0.0005");
  assert.equal(formatTokenUnits("400001", null), "400,001");
});
