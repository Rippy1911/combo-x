# Agent profiles

Create multiple agents with different instructions, models, tools, connector access, and budget behavior. Profiles are stored locally in IndexedDB — no cloud account required.

**Store:** `AgentProfileStore` in `packages/core/src/agents/profiles.ts`  
**DB:** `combo_x_agents` (stores: `agents`, `meta`)  
**UI:** Settings → Agents in `extension/src/sidepanel/SettingsPanel.tsx`  
**Runtime:** Chat header picker in `extension/src/sidepanel/App.tsx`

---

## Fields (v1.0 — shipped)

| Field | Type | Meaning |
|-------|------|---------|
| `id` | `string` | UUID primary key |
| `name` | `string` | Display name |
| `systemPrompt` | `string?` | Extra instructions appended to orchestrator system prompt |
| `orchestratorModel` | `string?` | OpenRouter model id (default: global model picker) |
| `workerModel` | `string?` | Cheap model for `parse_data`, approval gate (default: `DEFAULT_WORKER_MODEL`) |
| `toolAllowlist` | `string[] \| "all"` | Which tools the orchestrator may call |
| `connectorIds` | `string[]` | REST/MCP connectors this agent may use (`rest_request`, `mcp_*`) |
| `budgetMode` | `"budget" \| "normal"?` | Token/step discipline (default: global Budget toggle) |
| `approvalMode` | `"ask" \| "auto_llm" \| "auto_all"?` | Sensitive tool gate |
| `ragEnabled` | `boolean?` | UI hint to prefer RAG tools when folder granted |
| `createdAt` / `updatedAt` | ISO strings | Audit timestamps |

Type definition:

```typescript
// packages/core/src/agents/profiles.ts
export interface AgentProfile {
  id: string;
  name: string;
  systemPrompt?: string;
  orchestratorModel?: string;
  workerModel?: string;
  toolAllowlist: ToolAllowlist; // string[] | "all"
  connectorIds: string[];
  budgetMode?: AgentBudgetMode;
  approvalMode?: ApprovalMode;
  ragEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## Fields (v1.1 — shipped)

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `maxSteps` | `number?` | `32` (budget still caps via `resolveMaxSteps`) | Per-agent orchestrator turn cap |
| `canDelegate` | `boolean?` | `true` on new profiles | Allow `spawn_subagent` — see [`docs/SUBAGENTS.md`](./SUBAGENTS.md) |
| `canSelfEdit` | `boolean?` | `true` on new profiles | Allow `update_agent` / `create_agent` / `list_agents` |
| `nestingDepth` | `number?` | `1` | Max child depth (enforced: parent depth 0 → child 1 only) |

Resolved via `resolveAgentProfile()` in `packages/core/src/agents/profiles.ts`. `App.tsx` passes `maxSteps` from the active profile into `agent.run()`.

---

## Behavior (v1.0)

### Zero custom agents

Backward compatible: global Tools allowlist (`localStorage`) + **all** connectors available.

### One or more agents

- Chat header shows agent picker (`AgentProfileStore.getActiveId()`)
- Each run uses the active profile's models, tools, connectors, budget, approval
- Tools tab edits the **active** agent's `toolAllowlist` (or global set when no agents exist)

### Tool resolution per run

```typescript
// extension/src/sidepanel/App.tsx (simplified)
const runTools =
  activeProfile?.toolAllowlist === "all"
    ? ALL_TOOL_NAMES
    : activeProfile?.toolAllowlist?.length
      ? activeProfile.toolAllowlist
      : [...enabledTools];

const connectorAllowlist =
  activeProfile?.connectorIds?.length ? activeProfile.connectorIds : undefined;
```

Passed to `AgentLoop.run({ enabledTools: runTools, connectors: { allowedIds: connectorAllowlist, … } })`.

---

## maxSteps

| Context | Default | Override path |
|---------|---------|---------------|
| Normal mode | 32 | `AgentRunOptions.maxSteps` |
| Budget mode | 16 | `AgentRunOptions.maxSteps` |
| v1.1 per profile | `profile.maxSteps` | Falls back to budget/normal defaults |

When hit, user sees: *"Hit the step limit … say continue"* (`AgentLoop.run()` in `packages/core/src/agent/loop.ts`).

Tests: `packages/core/src/agent/loop.test.ts` (`hitStepLimit when maxSteps=1`).

---

## Agentic self-edit (v1.1 — shipped)

When `canSelfEdit: true`, the orchestrator may call:

- `create_agent` — new profile; optionally runs `pickToolsForGoal` for allowlist
- `update_agent` — mutate fields (`systemPrompt`, `toolAllowlist`, models, flags, `maxSteps`)
- `list_agents` — inspect profiles

Persists via `AgentProfileStore`. Rationale: scrape agents can tighten their own tool set mid-mission.

---

## Delegation (v1.1 — shipped)

When `canDelegate: true`:

- `spawn_subagent` is added to the run's meta-tool set
- Child inherits vault, bridge, stores; **isolated** history
- Parent gets results envelope only; UI via `onSubagent` → `SubagentStrip`
- Max nesting depth: **1** (child cannot spawn)

Full protocol: [`docs/SUBAGENTS.md`](./SUBAGENTS.md).

---

## Tool allowlist auto-pick (v1.1 — shipped)

Manual allowlists remain (`toolAllowlist` + Tools tab).

**Auto-pick on `create_agent`:** worker LLM (`pickToolsForGoal`) receives:

- User goal
- `TOOL_CATALOG` name + description + use-cases
- Returns `string[]` stored as the new agent's `toolAllowlist`

Worker returns `string[]` tool names → `enabledTools` for that turn only.

Chat path: ask the agent to “create me a scrape agent …” → `create_agent` + `pickToolsForGoal` → profile persisted.

See [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md#tool-control--auto-agent-creation-v11--shipped).

---

## Model defaults

| Role | Default constant | File |
|------|------------------|------|
| Orchestrator | `x-ai/grok-4.5` | `packages/core/src/models.ts` (`DEFAULT_MODEL`) |
| Worker | `google/gemini-3.5-flash` | `DEFAULT_WORKER_MODEL` |

`normalizeModelId()` migrates legacy bad ids. Presets in `MODEL_PRESETS` for UI dropdowns.

---

## API surface

```typescript
class AgentProfileStore {
  list(): Promise<AgentProfile[]>;
  get(id: string): Promise<AgentProfile | null>;
  put(profile: AgentProfile): Promise<AgentProfile>;
  remove(id: string): Promise<boolean>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
}
```

Tests: `packages/core/src/agents/profiles.test.ts`.

---

## Related

- Architecture: [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Tools: [`docs/TOOLS.md`](./TOOLS.md)
- Sub-agents: [`docs/SUBAGENTS.md`](./SUBAGENTS.md)
- Budget mode: [`docs/BUDGET.md`](./BUDGET.md)
- Connectors: [`docs/CONNECTORS.md`](./CONNECTORS.md)
