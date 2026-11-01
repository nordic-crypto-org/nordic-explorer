import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORITY, meltsInTx, rawGroupQuantity, storedQuantity } from "../deploy/melts.mjs";
import { formatBaseUnits } from "../lib/format";

const G = "nexa:tr9v70v4s9s6jfwz32ts60zqmmkp50lqv7t0ux620d50xa7dhyqqqcg6kdm6f";
const SUB = `${G}xxxxxxxxxxxxxxxx`;
// Output script of the ROTT transfer fixture: push 32-byte group, push 8-byte quantity, then the template.
const ROTT_OUT = "20f1959a42724bd9e380a3308524de40978adbd7314e397bbf7882d84013aa000008bad6a7bad9f4285c5114fccdb35a261744e2e257d64c605f427f7ba8923d";

test("exact quantities come from the script, not the rounded JSON number", () => {
  assert.equal(rawGroupQuantity(ROTT_OUT), 6640826866534438586n);
  assert.equal(storedQuantity({ hex: ROTT_OUT, groupQuantity: 6640826866534438000 }), "6640826866534438586");
  assert.equal(storedQuantity({ groupQuantity: 400001 }), "400001");
  assert.equal(storedQuantity({ groupQuantity: -288230376151706200 }), AUTHORITY);
  // authority bit (2^63) set in the script
  assert.equal(storedQuantity({ hex: `20${"00".repeat(32)}08${"0000000000000080"}51`, groupQuantity: 0 }), AUTHORITY);
  assert.equal(rawGroupQuantity("00511482495287e717fa66dec7dccb858254144c80a690"), null);
});

test("a transfer is not a melt", () => {
  assert.deepEqual(meltsInTx([[G, "1000"]], [[G, "600"], [G, "400"]]), []);
});

test("fewer tokens out than in is a melt of the difference; authorities do not count", () => {
  assert.deepEqual(meltsInTx([[G, "1000"], [G, AUTHORITY]], [[G, "250"], [G, AUTHORITY]]), [{ group: G, amount: "750" }]);
});

test("burning every token in the inputs, above 2^53, is exact", () => {
  assert.deepEqual(meltsInTx([[G, "6640826866534438586"], [G, AUTHORITY]], []), [{ group: G, amount: "6640826866534438586" }]);
});

test("a mint is not a melt, and groups are kept apart", () => {
  assert.deepEqual(meltsInTx([[G, AUTHORITY], [SUB, "1"]], [[G, AUTHORITY], [G, "5000"]]), [{ group: SUB, amount: "1" }]);
});

test("base units are shown with the token's decimals", () => {
  assert.equal(formatBaseUnits("123456789", 2), "1,234,567.89");
  assert.equal(formatBaseUnits("100", 2), "1");
  assert.equal(formatBaseUnits("5", 8), "0.00000005");
  assert.equal(formatBaseUnits("6640826866534438586", 0), "6,640,826,866,534,438,586");
  assert.equal(formatBaseUnits("1000", null), "1,000");
});
