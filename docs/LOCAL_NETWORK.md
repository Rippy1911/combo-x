# Combo-X on a local network (no internet)

Run Combo **100% on LAN**: self-hosted Combo Platform + Ollama (or LM Studio), no
`api.combo.nextsolutions.studio` / OpenRouter required.

## Architecture

```
Phone / laptop B                    Laptop A (agent)
  Combo portal OR                     Combo-X extension
  smoke HTML  ──LAN──►  combo-platform :8050
                              ▲
                              │ sync / Link
                        Combo-X (vault unlocked)
                              │
                              ▼
                        Ollama :11434  (or remote LAN Ollama)
```

## 1. Self-host Combo Platform

```bash
cd ns-infra/services/combo-platform
cp .env.example .env   # DATABASE_URL for compose postgres is pre-wired
docker compose up -d --build
curl -sS http://localhost:8050/v1/health
# → {"ok":true,"db":"ok",…}
```

On another machine use `http://<host-lan-ip>:8050`.

Mint a sync token (no email when `EXPOSE_MAGIC_TOKEN=1`):

```bash
COMBO_API_BASE=http://192.168.1.10:8050 \
  node combo-x/scripts/mint-combo-sync-token.mjs you@local.test
```

## 2. Point Combo-X at the LAN API

**Vault gate (before unlock):** Pull from Cloud… → **Show advanced** → set API base → Test API → paste `cmb_sync_…` → Pull.

**After unlock:** Vault tab → Combo Cloud → **Show advanced** → API base → Test API → Save.

Pairing second device: **Generate pairing code** on device A → enter code on device B (same API base).

## 3. Local LLM (Ollama)

```bash
# On the GPU machine
ollama pull qwen2.5:32b    # orchestrator (tools)
ollama pull qwen2.5:14b    # cheaper worker
# optional vision
ollama pull llava
```

Combo-X → Settings → Provider → **Ollama (local)**

| Field | Value |
|-------|--------|
| Base URL | `http://127.0.0.1:11434/v1` or `http://<gpu-lan-ip>:11434/v1` |
| API key | leave empty |
| Orchestrator | `qwen2.5:32b` (or Refresh model list) |
| Worker | `qwen2.5:14b` |
| Web search | off (needs internet) |

Click **Test LLM** — should list pulled models. Then **Save keys**.

### LAN Ollama from another device

Ollama must listen on the LAN interface (not only localhost):

```bash
# macOS/Linux example
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

Firewall: allow TCP 11434 from your LAN. In Combo set Base URL to `http://192.168.x.x:11434/v1`.

## 4. Combo Link on LAN

1. Deploy Link-capable combo-platform + migrate schema.
2. Extension: enable Combo Link (Vault tab) with LAN API base.
3. Portal: use smoke HTML `_artifacts/combo-link-portal-smoke.html` with the same API base + `cmb_portal_…`, or a self-hosted portal pointed at the LAN API.

## Use case — weekend / travel LAN

> Take the home NAS with combo-platform + Ollama. On the laptop: Vault → Combo Cloud advanced → API base `http://192.168.x.x:8050`, provider **Ollama**, model `qwen2.5:32b`. Chat and Link work on Wi‑Fi with no OpenRouter. Model picker shows `local · free` costs.

## Offline checklist

| Feature | Offline OK? |
|---------|-------------|
| Chat + tools (DOM) | Yes — with Ollama/custom |
| Vault encrypt / disk folder | Yes |
| Cloud sync / Link | Yes — against LAN combo-platform |
| Web search | No (unless you host a local search) |
| Map tiles / uploads templates | Needs internet or local mirrors |
| OpenRouter models | No |

## See also

- [`PROVIDERS.md`](./PROVIDERS.md) — Ollama / custom presets
- [`VAULTS.md`](./VAULTS.md) — vault pack sync
- [`COMBO_LINK.md`](./COMBO_LINK.md) — remote control
- ns-infra `services/combo-platform/README.md`
