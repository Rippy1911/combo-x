import { type Connector, type ConnectorStore } from "@combo-x/core";
import { useCallback, useEffect, useState } from "react";

export function IntegrationsSubpanel({
  connectorStore,
  vaultUnlocked,
}: {
  connectorStore: ConnectorStore;
  vaultUnlocked: boolean;
}) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    setConnectors(await connectorStore.list());
  }, [connectorStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeConnector = async (id: string) => {
    await connectorStore.remove(id);
    await refresh();
    setMsg("Connector removed");
  };

  return (
    <div className="lib-section">
      <p className="hint wrap">
        REST and MCP connectors power <code>rest_request</code>, <code>mcp_list_tools</code>, and{" "}
        <code>mcp_call</code>. Add new connectors in Settings for now.
      </p>
      <p className="hint">Vault: {vaultUnlocked ? "unlocked" : "locked"}</p>
      <div className="row">
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {msg ? <p className="hint wrap">{msg}</p> : null}
      {connectors.length === 0 ? (
        <p className="hint">No connectors yet — open Settings → Connectors to add REST or MCP.</p>
      ) : (
        <ul className="list">
          {connectors.map((c) => (
            <li key={c.id}>
              <div className="list-card-top">
                <div className="list-card-body">
                  <strong>{c.name}</strong>
                  <div className="hint">
                    {c.kind}
                    {c.kind === "rest" ? ` · ${c.baseUrl}` : ` · ${c.url}`}
                  </div>
                </div>
                <div className="list-row-actions">
                  <button
                    type="button"
                    className="msg-action icon-btn dangerish"
                    title="Remove connector"
                    aria-label="Remove"
                    onClick={() => void removeConnector(c.id)}
                  >
                    ⌫
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
