import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authorityText } from "../lib/format";
import { groupQuantityFromScript, mapTokenBalances, mapTransaction, txTokens } from "../lib/protocol";

// Real Rostrum blockchain.transaction.get verbose replies (electrum-nexa.nordiccrypto.no, 2026-10-18).
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const NCSHLD = "69bb784cf1c07d48c737cd082f6bd145ab5d7d70edfc346af71aef2957540000";
const ALL = ["mint", "melt", "baton", "rescript", "subgroup"];

test("an NCSHLD mint (txidem 727f5b…1c66) shows the authority, the minted NFT and the right fee", () => {
  const tx = mapTransaction("nexa", fixture("nexa-tx-8ff9cf8f-ncshld-mint"), 1172100);
  assert.equal(tx.fee, 5.79);
  assert.deepEqual(tx.inputs[0].token, { id: NCSHLD, amount: "0", kind: "Nexa token authority", authority: ALL });
  assert.deepEqual(tx.outputs[0].token, { id: NCSHLD, amount: "0", kind: "Nexa token authority", authority: ALL });
  assert.equal(tx.outputs[0].amount, 5.46);
  assert.deepEqual(tx.outputs[1].token, { id: `${NCSHLD}0d00000000000000`, amount: "1", kind: "Nexa group token" });
  assert.ok(!JSON.stringify(tx).includes("288230376151706"), "no raw authority flags as an amount");
  assert.equal(txTokens(tx).token?.amount, "1");
  assert.equal(authorityText(ALL), "Authority (mint, melt, baton, rescript, subgroup)");
});

test("an authority-only genesis headlines the NEXA total, not the flags", () => {
  const tx = mapTransaction("nexa", fixture("nexa-tx-a3805102-ncshld-genesis"), 1172100);
  assert.equal(tx.fee, 7.56);
  assert.deepEqual(tx.outputs[1].token?.authority, ALL);
  assert.ok(!JSON.stringify(tx).includes("288230376151706"));
  const { token, authority } = txTokens(tx);
  assert.equal(token, undefined);
  assert.equal(authority?.kind, "Nexa token authority");
  assert.equal(Math.round(tx.outputs.reduce((sum, side) => sum + (side.amount ?? 0), 0) * 100) / 100, 412.44);
});

test("token quantities above 2^53 are read exactly from the output script", () => {
  const tx = mapTransaction("nexa", fixture("nexa-tx-6ab44337-rott-transfer"), 1172100);
  assert.equal(tx.outputs[0].token?.amount, "1000000000000");
  assert.equal(tx.outputs[1].token?.amount, "6640826866534438586");
  assert.equal(tx.inputs[0].token?.amount, "400001");
  assert.equal(groupQuantityFromScript("00511482495287e717fa66dec7dccb858254144c80a690"), null);
});

test("Rostrum token balances keyed by token id are listed, authorities (0) skipped", () => {
  assert.deepEqual(mapTokenBalances({ confirmed: { [NCSHLD]: 0, [`${NCSHLD}0d00000000000000`]: 1 }, cursor: null, unconfirmed: {} }), [
    { id: `${NCSHLD}0d00000000000000`, amount: "1" },
  ]);
});
