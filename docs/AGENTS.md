# Agent profiles

Create multiple agents with different instructions, models, tools, and connector access.

## Fields

| Field | Meaning |
|---|---|
| name | Display name |
| systemPrompt | Extra / override instructions |
| orchestratorModel / workerModel | Defaults for that agent |
| toolAllowlist | `"all"` or list of tool names |
| connectorIds | Which REST/MCP connectors are callable |
| budgetMode | `budget` (default) or `normal` |
| approvalMode | ask / auto_llm / auto_all |
| ragEnabled | Prefer local folder RAG tools |

## Behavior

- **Zero custom agents:** global Tools allowlist + all connectors (backward compatible).
- **≥1 agents:** chat header picker; run uses the active profile.
- Tools tab edits the active agent’s allowlist (or global when none).

Stored in IndexedDB `combo_x_agents`.
