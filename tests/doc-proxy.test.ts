import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../deploy/doc-proxy.mjs", import.meta.url));
const PORT = 18790 + Math.floor(Math.random() * 1000);

test("doc-proxy refuses private and loopback addresses however they are written", async (t) => {
  const proc = spawn(process.execPath, [script], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  t.after(() => proc.kill());
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const blocked = [
    "http://127.0.0.1/", "http://10.0.0.1/", "http://169.254.169.254/", "http://[::1]/", "http://[::]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/", "http://[0:0:0:0:0:ffff:a00:1]/",
    "http://[::ffff:0:7f00:1]/", "http://[::127.0.0.1]/", "http://[64:ff9b::a9fe:a9fe]/",
    "http://[fd00::1]/", "http://[fe80::1]/",
  ];
  for (const u of blocked) {
    const r = await fetch(`http://127.0.0.1:${PORT}/doc-proxy?url=${encodeURIComponent(u)}`);
    assert.equal(r.status, 403, u);
  }
});
