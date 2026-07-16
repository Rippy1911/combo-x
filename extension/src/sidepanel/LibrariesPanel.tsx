import type {
  AgentProfileStore,
  ConnectorStore,
  CustomToolStore,
  MemoryStore,
  RagMeta,
  RagStore,
  SkillStore,
  ViewStore,
} from "@combo-x/core";
import { useState } from "react";
import { InspectorSubpanel } from "./InspectorSubpanel";
import { IntegrationsSubpanel } from "./IntegrationsSubpanel";
import { KnowledgeSubpanel } from "./KnowledgeSubpanel";
import { MemoryBrowser } from "./MemoryBrowser";
import { SkillsBrowser } from "./SkillsBrowser";
import { TablesSubpanel } from "./TablesSubpanel";
import { ToolsLibrary } from "./ToolsLibrary";

export type LibSubNav =
  | "memory"
  | "skills"
  | "tools"
  | "knowledge"
  | "integrations"
  | "tables"
  | "inspector";

export type LibrariesPanelProps = {
  memory: MemoryStore;
  skills: SkillStore;
  agents: AgentProfileStore;
  enabledTools: Set<string>;
  setEnabledTools?: (fn: (prev: Set<string>) => Set<string>) => void;
  customTools?: CustomToolStore;
  rag: RagStore;
  ragMeta: RagMeta | null;
  setRagMeta: (m: RagMeta | null) => void;
  ragExclude: string;
  setRagExclude: (v: string) => void;
  vaultUnlocked: boolean;
  locked?: boolean;
  connectorStore: ConnectorStore;
  views: ViewStore;
  onExport: (filename: string, text: string, mime: string) => void | Promise<void>;
  initialSubnav?: LibSubNav;
};

const SUBNAV: Array<{ id: LibSubNav; label: string }> = [
  { id: "memory", label: "Memory" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "knowledge", label: "Knowledge" },
  { id: "integrations", label: "Integrations" },
  { id: "tables", label: "Tables" },
  { id: "inspector", label: "Inspector" },
];

export function LibrariesPanel({
  memory,
  skills,
  agents,
  enabledTools,
  setEnabledTools,
  customTools,
  rag,
  ragMeta,
  setRagMeta,
  ragExclude,
  setRagExclude,
  vaultUnlocked,
  locked = false,
  connectorStore,
  views,
  onExport,
  initialSubnav = "memory",
}: LibrariesPanelProps) {
  const [sub, setSub] = useState<LibSubNav>(initialSubnav);

  return (
    <div className="panel libraries-panel">
      <h2>Libraries</h2>
      <p className="hint wrap">
        Memory, skills, tools, knowledge, and local data — how the agent remembers, unlocks, and
        browses.
      </p>
      <nav className="lib-subnav">
        {SUBNAV.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={sub === id ? "tab active" : "tab"}
            onClick={() => setSub(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {sub === "memory" ? <MemoryBrowser memory={memory} agents={agents} /> : null}
      {sub === "skills" ? <SkillsBrowser skills={skills} agents={agents} /> : null}
      {sub === "tools" ? (
        <ToolsLibrary
          enabledTools={enabledTools}
          setEnabledTools={setEnabledTools}
          customTools={customTools}
        />
      ) : null}
      {sub === "knowledge" ? (
        <KnowledgeSubpanel
          rag={rag}
          ragMeta={ragMeta}
          setRagMeta={setRagMeta}
          ragExclude={ragExclude}
          setRagExclude={setRagExclude}
          locked={locked}
          setEnabledTools={setEnabledTools}
        />
      ) : null}
      {sub === "integrations" ? (
        <IntegrationsSubpanel connectorStore={connectorStore} vaultUnlocked={vaultUnlocked} />
      ) : null}
      {sub === "tables" ? <TablesSubpanel views={views} onExport={onExport} /> : null}
      {sub === "inspector" ? <InspectorSubpanel /> : null}
    </div>
  );
}
