# LLM providers

Combo-X talks to any **OpenAI-compatible** `/chat/completions` endpoint via
`OpenRouterClient` (`packages/core/src/llm/openrouter.ts`).

**1.6.55+:** You can keep **multiple providers configured at once**. Each has its
own vault key (and base URL). The chat model picker lists models from every
ready provider; picking a Kimi model switches the active provider to Moonshot
for that send without wiping your OpenRouter key.

## Presets (Settings → LLM provider)

| Id | Default base URL | API key vault label | Default models | Notes |
|---|---|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | `openrouter_api_key` | Grok 4.5 / Gemini Flash | Optional server tools for web search. |
| `openai` | `https://api.openai.com/v1` | `openai_api_key` | gpt-4.1 / mini | Direct OpenAI. |
| `moonshot` | `https://api.moonshot.ai/v1` | `moonshot_api_key` | kimi-k3 / kimi-k2.6 | Kimi via Moonshot. |
| `ollama` | `http://127.0.0.1:11434/v1` | `ollama_api_key` (optional) | qwen2.5:32b / :14b | Local; Bearer `local` if empty. |
| `custom` | `http://127.0.0.1:1234/v1` | `custom_api_key` (optional) | local-model | LM Studio, vLLM, llama.cpp. |

Switching the Settings dropdown **loads** that provider’s saved key/base/models —
it does **not** delete other providers’ keys. Save keys for each provider you use.

Active pointers (legacy names kept):

- `llm_provider` — active preset id
- `llm_base_url` — copy of active base (also `llm_base_url_<id>` per provider)
- `openrouter_model` / `openrouter_worker_model` — active orch/worker
- `llm_model_<id>` / `llm_worker_model_<id>` — last models per provider

## Chat model picker

When two or more providers are ready (key present, or key-optional like Ollama),
the composer ModelPicker shows **grouped** lists (OpenRouter / Moonshot / …).
Selecting a row:

1. Sets active provider + orch model
2. Loads that provider’s key + base URL into the run
3. Restores that provider’s last worker model (or preset default)

One provider per send (orch + worker stay on the same host).

## Use cases

### OpenRouter + Kimi side by side
> Settings → OpenRouter → paste `sk-or-…` → Save. Switch Provider → Moonshot → paste
> Moonshot key → Save. Chat picker shows both; switch models without re-pasting.

### Local Ollama without clearing cloud keys
> Add Ollama (no key). OpenRouter key stays under `openrouter_api_key`.

### LAN custom endpoint
> Provider → Custom → Base URL `http://192.168.x.x:1234/v1` → Save. Label
> `custom_api_key` if the server needs a token.

## Ollama (recommended local)

```bash
ollama pull qwen2.5:32b
ollama pull qwen2.5:14b
# Settings → Provider → Ollama → Test LLM → Save keys
```

- Prefer **tool-capable** models for the agent loop (Qwen 2.5 14B+ is a good baseline).
- Model picker cache is **per Base URL** — Refresh after `ollama pull`.
- Another machine: set Base URL to `http://<lan-ip>:11434/v1` and run Ollama with `OLLAMA_HOST=0.0.0.0:11434`.

Full LAN guide: [`LOCAL_NETWORK.md`](./LOCAL_NETWORK.md).

### Moonshot / Kimi

1. Settings → Provider → **Moonshot / Kimi**
2. Paste Moonshot API key (saved as `moonshot_api_key`)
3. Pick a model (`kimi-k3`, …) or paste any id from
   [platform.kimi.ai/docs/models](https://platform.kimi.ai/docs/models)

OpenRouter-only headers (`HTTP-Referer`, `X-Title`) and `stream_options.include_usage`
are **not** sent to non-OpenRouter hosts.

## Web search

Settings toggle **Enable web search** (`localStorage` `combo_x_web_search`, default on):

1. **OpenRouter + toggle on** — request body includes server tools
   `openrouter:web_search` and `openrouter:web_fetch`. Combo-X
   `web_search` / `web_fetch` tools are omitted for that run.
2. **Other providers + toggle on** — Combo-X DuckDuckGo HTML search + plaintext
   `web_fetch` (needs internet).
3. **Toggle off** — neither. Auto-off when selecting Ollama/custom.

## Firefox / local hosts

Extensions need host permissions for `http://127.0.0.1` / LAN IPs. Chrome and Firefox
builds request broad host access. If Ollama fails with a network error, confirm the
server is up and the URL matches Settings → Base URL. Use **Test LLM**.
