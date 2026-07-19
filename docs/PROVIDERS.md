# LLM providers

Combo-X talks to any **OpenAI-compatible** `/chat/completions` endpoint via
`OpenRouterClient` (`packages/core/src/llm/openrouter.ts`).

## Presets (Settings → LLM provider)

| Id | Default base URL | API key | Notes |
|---|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | required | Default. Optional server tools for web search. |
| `openai` | `https://api.openai.com/v1` | required | Direct OpenAI. |
| `moonshot` | `https://api.moonshot.ai/v1` | required | Kimi models (K3, K2.6, K2.7 Code, …). |
| `ollama` | `http://127.0.0.1:11434/v1` | optional | Local; Bearer `local` if empty. |
| `custom` | `http://127.0.0.1:1234/v1` | optional | LM Studio, vLLM, llama.cpp, etc. |

Vault labels (encrypted):

- `openrouter_api_key` — API key (historical name; used for all providers)
- `llm_provider` — preset id
- `llm_base_url` — override base URL
- `openrouter_model` / `openrouter_worker_model` — model ids

### Moonshot / Kimi

1. Settings → Provider → **Moonshot / Kimi**
2. Paste Moonshot API key
3. Pick a model (`kimi-k3`, `kimi-k2.6`, `kimi-k2.7-code`, …) or paste any id from
   [platform.kimi.ai/docs/models](https://platform.kimi.ai/docs/models)

OpenRouter-only headers (`HTTP-Referer`, `X-Title`) and `stream_options.include_usage`
are **not** sent to Moonshot (compat APIs often 400 on unknown fields).

## Web search

Settings toggle **Enable web search** (`localStorage` `combo_x_web_search`, default on):

1. **OpenRouter + toggle on** — request body includes server tools
   `openrouter:web_search` and `openrouter:web_fetch`. Combo-X
   `web_search` / `web_fetch` tools are omitted for that run.
2. **Other providers + toggle on** — Combo-X DuckDuckGo HTML search + plaintext
   `web_fetch` (`packages/core/src/tools/webSearch.ts`).
3. **Toggle off** — neither OpenRouter server tools nor Combo search tools.

## Firefox / local hosts

Extensions cannot call `http://127.0.0.1` from some contexts without host
permissions. Chrome build already requests broad host access; Firefox temporary
add-ons inherit the transformed manifest. If Ollama fails with a network error,
confirm the model server is up and the URL matches Settings.
