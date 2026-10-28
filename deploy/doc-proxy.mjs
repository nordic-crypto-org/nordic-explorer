// Pass-through proxy for token metadata documents: GET /doc-proxy?url=<http(s) url>.
// Lets the explorer show a token's document when its host sends no CORS headers.
// Stores nothing. Limits: http(s) only, public IPs only (checked on the resolved address
// that is actually dialled), 256 KB, 8 s, no redirects, no cookies or auth forwarded.
// Run: node doc-proxy.mjs (listens on 127.0.0.1:8790, or PORT). Node 18+, no dependencies.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

const PORT = Number(process.env.PORT ?? 8790);
const MAX = 256 * 1024;
const TIMEOUT = 8000;
// Test-only: sandboxes that map every host to 198.18.0.0/15 can set this. Never set in production.
const ALLOW_198_18 = process.env.DOC_PROXY_TEST_ALLOW_198_18 === "1";

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (!ALLOW_198_18 && a === 198 && (b === 18 || b === 19));
  }
  if (!net.isIPv6(ip)) return true;
  const g = ipv6Groups(ip);
  const v4 = (h, l) => `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
  // IPv4 inside IPv6 (mapped ::ffff:0:0/96, translated ::ffff:0:0:0/96, compatible ::/96, NAT64 64:ff9b::/96)
  // is checked as the IPv4 address it carries, whichever way it is written.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g[5] === 0 && g[6] === 0 ? true : privateIp(v4(g[6], g[7]));
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return privateIp(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return privateIp(v4(g[6], g[7]));
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}

// "::ffff:127.0.0.1" or "::ffff:7f00:1" -> eight 16-bit numbers.
function ipv6Groups(ip) {
  let v = ip.toLowerCase().split("%")[0];
  const m = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const [a, b, c, d] = m[2].split(".").map(Number);
    v = `${m[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

// Resolve, refuse private addresses, and pin the connection to the checked address.
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.find((a) => !privateIp(a.address));
    if (!ok || addrs.some((a) => privateIp(a.address))) return cb(new Error("blocked address"));
    if (opts && opts.all) return cb(null, [ok]);
    cb(null, ok.address, ok.family);
  });
}

function fail(res, code, msg) {
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(msg);
}

http.createServer((req, res) => {
  if (req.method !== "GET") return fail(res, 405, "GET only");
  let target;
  try {
    target = new URL(new URL(req.url, "http://x").searchParams.get("url") ?? "");
  } catch {
    return fail(res, 400, "bad url");
  }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return fail(res, 400, "http(s) only");
  if (net.isIP(target.hostname.replace(/^\[|\]$/g, "")) && privateIp(target.hostname.replace(/^\[|\]$/g, ""))) return fail(res, 403, "blocked");
  const lib = target.protocol === "https:" ? https : http;
  const up = lib.get(target, { lookup: safeLookup, timeout: TIMEOUT, headers: { "user-agent": "NordicCryptoExplorer-doc-proxy", accept: "application/json,text/plain,*/*" } }, (r) => {
    if (r.statusCode !== 200) { r.resume(); return fail(res, 502, `upstream ${r.statusCode}`); }
    if (Number(r.headers["content-length"] ?? 0) > MAX) { r.destroy(); return fail(res, 413, "too large"); }
    const chunks = [];
    let size = 0;
    r.on("data", (c) => {
      size += c.length;
      if (size > MAX) { r.destroy(); if (!res.headersSent) fail(res, 413, "too large"); return; }
      chunks.push(c);
    });
    r.on("end", () => {
      if (res.headersSent) return;
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8", // never rendered as HTML
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      res.end(Buffer.concat(chunks));
    });
    r.on("error", () => { if (!res.headersSent) fail(res, 502, "upstream error"); });
  });
  up.on("timeout", () => up.destroy(new Error("timeout")));
  up.on("error", (e) => { if (!res.headersSent) fail(res, e.message === "blocked address" ? 403 : 502, e.message === "blocked address" ? "blocked" : "fetch failed"); });
}).listen(PORT, "127.0.0.1");
