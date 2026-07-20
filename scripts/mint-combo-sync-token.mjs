#!/usr/bin/env node
/**
 * Mint a Combo Platform sync token for extension Cloud vault pack testing.
 *
 * Usage:
 *   node scripts/mint-combo-sync-token.mjs you@example.com
 *   COMBO_MAGIC_EMAIL=you@example.com node scripts/mint-combo-sync-token.mjs
 *   COMBO_API_BASE=http://192.168.1.10:8050 node scripts/mint-combo-sync-token.mjs you@local.test
 *
 * If the API returns magic_token (EXPOSE_MAGIC_TOKEN), consumes immediately.
 * Otherwise prints instructions to paste the email link token.
 *
 * Writes COMBO_SYNC_TOKEN (+ COMBO_API_BASE when set) to portfolio ../.env when possible.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE =
  process.env.COMBO_API_BASE?.replace(/\/$/, "") ||
  "https://api.combo.nextsolutions.studio";
const email =
  process.argv[2]?.trim() ||
  process.env.COMBO_MAGIC_EMAIL?.trim() ||
  process.env.COMBO_TEST_EMAIL?.trim();

if (!email) {
  console.error("Usage: node scripts/mint-combo-sync-token.mjs <email>");
  process.exit(1);
}

const deviceId = crypto.randomUUID();

async function main() {
  console.log(`API: ${BASE}`);
  console.log(`Email: ${email}`);
  const startRes = await fetch(`${BASE}/v1/auth/magic/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const start = await startRes.json();
  if (!startRes.ok || start.ok === false) {
    console.error("magic/start failed:", start);
    process.exit(1);
  }
  let token = start.magic_token;
  if (!token) {
    console.log("No magic_token in response (mail delivery). Check inbox, then:");
    console.log(
      `  curl -sS -X POST ${BASE}/v1/auth/magic/consume -H 'content-type: application/json' \\`,
    );
    console.log(
      `    -d '{"token":"<from-email>","device_id":"${deviceId}","label":"mint-script"}'`,
    );
    process.exit(0);
  }
  console.log("Got magic_token from API (EXPOSE_MAGIC_TOKEN) — consuming…");
  const consumeRes = await fetch(`${BASE}/v1/auth/magic/consume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      device_id: deviceId,
      label: "mint-script",
    }),
  });
  const consume = await consumeRes.json();
  if (!consumeRes.ok || !consume.sync_token) {
    console.error("magic/consume failed:", consume);
    process.exit(1);
  }
  const sync = consume.sync_token;
  console.log("");
  console.log("=== Paste into Combo-X → Vault tab → Combo Cloud ===");
  console.log(`API: ${BASE}`);
  console.log(`Sync token: ${sync}`);
  console.log("Then: Pull vault pack / Push vault pack");
  console.log("");

  const envPath = path.resolve(__dirname, "../../.env");
  if (existsSync(envPath)) {
    let text = readFileSync(envPath, "utf8");
    const line = `COMBO_SYNC_TOKEN=${sync}`;
    if (/^COMBO_SYNC_TOKEN=/m.test(text)) {
      text = text.replace(/^COMBO_SYNC_TOKEN=.*$/m, line);
    } else {
      text = text.trimEnd() + `\n\n# Combo Platform (local vault sync test)\n${line}\nCOMBO_API_BASE=${BASE}\n`;
    }
    if (!/^COMBO_API_BASE=/m.test(text)) {
      text = text.trimEnd() + `\nCOMBO_API_BASE=${BASE}\n`;
    } else {
      text = text.replace(/^COMBO_API_BASE=.*$/m, `COMBO_API_BASE=${BASE}`);
    }
    writeFileSync(envPath, text);
    console.log(`Updated ${envPath} (COMBO_SYNC_TOKEN + COMBO_API_BASE)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
