#!/usr/bin/env node
/**
 * Enqueue setup.apply_bundle (+ optional secrets) to an online Combo Link device.
 * Values are sent only to the unlocked desktop — never stored on the API in clear.
 *
 *   node scripts/apply-vault-recipe-via-link.mjs --recipe private --device <device_id>
 *   node scripts/apply-vault-recipe-via-link.mjs --recipe work --device <id> --push
 *
 * Env: COMBO_SYNC_TOKEN, COMBO_API_BASE (optional), secret values from portfolio .env
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const ENV_FILE = resolve(ROOT, ".env");

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing */
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const env = { ...loadEnv(ENV_FILE), ...process.env };
const recipe = arg("recipe", "private");
const device = arg("device", "");
const apiBase = (env.COMBO_API_BASE || "https://api.combo.nextsolutions.studio").replace(/\/$/, "");
const token = env.COMBO_SYNC_TOKEN || "";
const doPush = process.argv.includes("--push");

if (!token) {
  console.error("COMBO_SYNC_TOKEN required in portfolio .env");
  process.exit(2);
}
if (!device) {
  console.error("--device <device_id> required (from Vault Link / GET /v1/link/devices)");
  process.exit(2);
}

const SECRET_MAP = {
  private: {
    openrouter_api_key: env.OPENROUTER_API_KEY,
    ns_food_key: env.NS_FOOD_API_KEY || env.NS_FOOD_KEY,
    anatome_api_key: env.ANATOME_API_KEY || env.ANATOME_ADMIN_TOKEN,
    fc_uploads_key: env.FC_UPLOADS_KEY || env.NS_FC_UPLOADS_KEY,
  },
  work: {
    ideaforge_shared_api_key: env.IDEAFORGE_SHARED_API_KEY,
    github_token: env.GITHUB_TOKEN || env.GH_TOKEN,
    ns_exec_token: env.NS_EXEC_TOKEN,
  },
};

const secrets = Object.fromEntries(
  Object.entries(SECRET_MAP[recipe] || {}).filter(([, v]) => typeof v === "string" && v.trim()),
);

async function enqueue(type, payload) {
  const res = await fetch(`${apiBase}/v1/link/commands`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_device_id: device, type, payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    const err = body.error?.message || body.error || `HTTP ${res.status}`;
    throw new Error(`${type}: ${err}`);
  }
  console.log(`OK ${type} → ${body.command_id}`);
  return body;
}

const payload = { recipeId: recipe, secrets };
console.log(`Applying recipe=${recipe} secrets=${Object.keys(secrets).join(",") || "(none)"} → ${device}`);
await enqueue("setup.apply_bundle", payload);
if (doPush) {
  await enqueue("sync.push_now", { scopes: ["vault", "setup"] });
}
console.log("Done — watch Combo sidepanel Link status / Vault labels.");
