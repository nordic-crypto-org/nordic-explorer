// Melt detection for deploy/token-index.mjs. Kept apart so tests can import it without an RPC cookie.
// Deployed next to token-index.mjs (/opt/explorer-token-stats/).

const AUTHORITY_BIT = 1n << 63n;
/** Stored in place of a quantity for authority UTXOs (they carry flags, not supply). */
export const AUTHORITY = -1;

/** Raw little-endian group quantity from a grouped output script (push group id, push 2/4/8 byte quantity), or null. */
export function rawGroupQuantity(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const b = Buffer.from(hex, "hex");
  let i = 0;
  const op = b[i++];
  let len;
  if (op >= 1 && op <= 75) len = op;
  else if (op === 0x4c) len = b[i++];
  else if (op === 0x4d) { len = b[i] | (b[i + 1] << 8); i += 2; }
  else return null;
  if (!(len >= 32)) return null;
  i += len;
  const qlen = b[i++];
  if ((qlen !== 2 && qlen !== 4 && qlen !== 8) || i + qlen > b.length) return null;
  let q = 0n;
  for (let k = qlen - 1; k >= 0; k--) q = (q << 8n) | BigInt(b[i + k]);
  return q;
}

/**
 * The quantity kept in state for a grouped nexad output: AUTHORITY, or the exact amount as a decimal string.
 * nexad's groupQuantity is a JSON number and loses precision above 2^53, so the script is read when it is there.
 */
export function storedQuantity(scriptPubKey) {
  const raw = rawGroupQuantity(scriptPubKey?.hex);
  if (raw != null) return raw & AUTHORITY_BIT ? AUTHORITY : raw.toString();
  const q = scriptPubKey?.groupQuantity;
  if (typeof q !== "number" || !Number.isFinite(q)) return null;
  return q < 0 ? AUTHORITY : BigInt(Math.round(q)).toString();
}

/**
 * Supply destroyed per group in one transaction: token inputs minus token outputs, authorities left out.
 * Nexa consensus only lets inputs exceed outputs when a melt authority is spent, so a positive difference is a melt.
 * @param {Array<[string, string|number|null]>} inputs  [group, stored quantity] of each spent token UTXO
 * @param {Array<[string, string|number|null]>} outputs [group, stored quantity] of each grouped output
 * @returns {Array<{ group: string, amount: string }>}
 */
export function meltsInTx(inputs, outputs) {
  const net = new Map();
  const add = (g, q, sign) => {
    if (typeof q !== "string") return; // authority or unknown
    net.set(g, (net.get(g) ?? 0n) + sign * BigInt(q));
  };
  for (const [g, q] of inputs) add(g, q, 1n);
  for (const [g, q] of outputs) add(g, q, -1n);
  return [...net].filter(([, d]) => d > 0n).map(([group, d]) => ({ group, amount: d.toString() }));
}
