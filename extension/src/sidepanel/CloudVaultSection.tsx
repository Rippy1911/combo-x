/**
 * Vault tab: vault switcher + Combo Cloud sync + disk folder backup.
 */
import {
  COMBO_API_BASE_LABEL,
  COMBO_DEVICE_ID_LABEL,
  COMBO_SYNC_TOKEN_LABEL,
  COMBO_VAULT_PACK_VERSION_LABEL,
  ConnectorStore,
  DEFAULT_COMBO_API_BASE,
  buildVaultPack,
  canPickDirectory,
  cloudClientFromConfig,
  ensureDeviceId,
  loadCloudConfig,
  loadDirectoryHandle,
  mergeVaultPack,
  normalizeComboApiBase,
  openVaultFromEntry,
  packFromCiphertextB64,
  packToCiphertextB64,
  pickVaultBackupDirectory,
  probeComboApi,
  readVaultPackFromDirectory,
  renameVaultEntry,
  saveCloudConfig,
  saveRegistry,
  sealSetupPack,
  setActiveVaultId,
  setupPackFromB64,
  setupPackToB64,
  unsealSetupPack,
  writeVaultPackToDirectory,
  type Vault,
  type VaultRegistryState,
} from "@combo-x/core";
import { useEffect, useState } from "react";

export type CloudVaultSectionProps = {
  vault: Vault;
  registry: VaultRegistryState;
  onRegistryChange: (next: VaultRegistryState) => void;
  onSwitchVault: (vault: Vault, entryId: string) => void | Promise<void>;
  locked: boolean;
  linkEnabled?: boolean;
  syncChats?: boolean;
  linkStatus?: "off" | "online" | "error" | "no_cloud";
  linkError?: string;
  onLinkConfigChange?: (partial: { linkEnabled?: boolean; syncChats?: boolean }) => void;
  onPullSessions?: () => Promise<number>;
};

export function CloudVaultSection({
  vault,
  registry,
  onRegistryChange,
  onSwitchVault,
  locked,
  linkEnabled = false,
  syncChats = false,
  linkStatus = "off",
  linkError = "",
  onLinkConfigChange,
  onPullSessions,
}: CloudVaultSectionProps) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_COMBO_API_BASE);
  const [syncToken, setSyncToken] = useState("");
  const [rename, setRename] = useState("");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [historyKeep, setHistoryKeep] = useState(5);
  const [historyRows, setHistoryRows] = useState<
    Array<{ version: number; updated_at: string; tip?: boolean; byte_size: number }>
  >([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(() => {
    const b = loadCloudConfig()?.apiBase;
    return !!b && b.replace(/\/$/, "") !== DEFAULT_COMBO_API_BASE.replace(/\/$/, "");
  });
  const connectors = new ConnectorStore();

  useEffect(() => {
    const cfg = loadCloudConfig();
    if (cfg) {
      setApiBase(cfg.apiBase);
      setSyncToken(cfg.syncToken);
    }
    void loadDirectoryHandle().then((h) => setFolderName(h?.name ?? null));
  }, []);

  const persistRegistry = (next: VaultRegistryState) => {
    saveRegistry(next);
    onRegistryChange(next);
  };

  const mirrorCloudToVault = async (token: string, base: string, version: number) => {
    if (!vault.isUnlocked()) return;
    await vault.putByLabel(COMBO_SYNC_TOKEN_LABEL, token);
    await vault.putByLabel(COMBO_API_BASE_LABEL, base);
    await vault.putByLabel(COMBO_DEVICE_ID_LABEL, ensureDeviceId());
    await vault.putByLabel(COMBO_VAULT_PACK_VERSION_LABEL, String(version));
  };

  const saveCloud = async () => {
    const deviceId = ensureDeviceId();
    const base = normalizeComboApiBase(apiBase, DEFAULT_COMBO_API_BASE);
    setApiBase(base);
    const cfg = {
      apiBase: base,
      syncToken: syncToken.trim(),
      deviceId,
      packVersion: loadCloudConfig()?.packVersion ?? 0,
    };
    if (!cfg.syncToken) {
      setMsg("Sync token required");
      return;
    }
    saveCloudConfig(cfg);
    await mirrorCloudToVault(cfg.syncToken, cfg.apiBase, cfg.packVersion);
    setMsg(`Cloud config saved → ${base}`);
  };

  const testApi = async () => {
    setBusy(true);
    try {
      const base = normalizeComboApiBase(apiBase, DEFAULT_COMBO_API_BASE);
      setApiBase(base);
      const r = await probeComboApi(base);
      setMsg(r.ok ? `API OK — ${r.detail}` : `API failed — ${r.detail}`);
    } finally {
      setBusy(false);
    }
  };

  const createPairCode = async () => {
    setBusy(true);
    try {
      await saveCloud();
      const cfg = loadCloudConfig();
      if (!cfg?.syncToken) {
        setMsg("Save sync token first");
        return;
      }
      const client = cloudClientFromConfig(cfg);
      const r = await client.pairCreate();
      if (!r.ok || !r.code) {
        setMsg(r.error ?? "Pair create failed");
        return;
      }
      setPairCode(r.code);
      setMsg(
        `Pairing code ${r.code} (expires ~${r.expires_in_sec ?? 600}s) — enter on the other device`,
      );
    } finally {
      setBusy(false);
    }
  };

  const pushPack = async () => {
    setBusy(true);
    try {
      await saveCloud();
      const cfg = loadCloudConfig();
      if (!cfg?.syncToken) return;
      if (!vault.isUnlocked()) {
        setMsg("Unlock vault to push vault + setup packs");
        return;
      }
      const client = cloudClientFromConfig(cfg);
      const pack = await buildVaultPack(registry.vaults);
      const nextVersion = (cfg.packVersion || 0) + 1;
      const res = await client.syncPush({
        scope: "vault",
        version: nextVersion,
        prev_version: cfg.packVersion || undefined,
        ciphertext_b64: packToCiphertextB64(pack),
      });
      if (!res.ok) {
        setMsg(res.error ?? "Push failed");
        return;
      }
      const ver = res.version ?? nextVersion;

      // Sealed setup (connectors for active vault)
      const activeId = registry.activeId ?? "";
      const entry = registry.vaults.find((v) => v.id === activeId);
      const list = await connectors.list(activeId || undefined);
      let setupVer = cfg.setupPackVersion ?? 0;
      if (activeId && list.length) {
        const sealed = await sealSetupPack(vault, {
          vaultId: activeId,
          vaultName: entry?.name,
          connectors: list,
        });
        const nextSetup = setupVer + 1;
        const sRes = await client.syncPush({
          scope: "setup",
          version: nextSetup,
          prev_version: setupVer || undefined,
          ciphertext_b64: setupPackToB64(sealed),
        });
        if (sRes.ok) setupVer = sRes.version ?? nextSetup;
        else setMsg(`Vault pushed; setup push failed: ${sRes.error}`);
      }

      saveCloudConfig({ ...cfg, packVersion: ver, setupPackVersion: setupVer });
      await mirrorCloudToVault(cfg.syncToken, cfg.apiBase, ver);
      setMsg(
        `Pushed vault pack v${ver} (${pack.vaults.length} vaults)` +
          (setupVer ? ` + setup v${setupVer} (${list.length} connectors)` : ""),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pullPack = async (version?: number) => {
    setBusy(true);
    try {
      await saveCloud();
      const cfg = loadCloudConfig();
      if (!cfg?.syncToken) return;
      const client = cloudClientFromConfig(cfg);
      const pull = await client.syncPull("vault", version != null ? { version } : undefined);
      if (!pull.ok) {
        setMsg(pull.error ?? "Pull failed");
        return;
      }
      if (!pull.ciphertext_b64) {
        setMsg("Remote vault empty");
        return;
      }
      const pack = packFromCiphertextB64(pull.ciphertext_b64);
      const { state, imported } = await mergeVaultPack(registry, pack);
      persistRegistry(state);

      let setupNote = "";
      // vault/setup scopes have independent version counters — never pass a vault
      // history version into setup pull. History restore = vault only.
      if (vault.isUnlocked() && version == null) {
        const setupPull = await client.syncPull("setup");
        if (setupPull.ok && setupPull.ciphertext_b64) {
          try {
            const sealed = setupPackFromB64(setupPull.ciphertext_b64);
            const plain = await unsealSetupPack(vault, sealed);
            for (const c of plain.connectors) {
              await connectors.put({ ...c, vaultId: c.vaultId ?? plain.vaultId });
            }
            setupNote = ` + ${plain.connectors.length} connectors`;
            saveCloudConfig({
              ...cfg,
              packVersion: pull.version ?? cfg.packVersion,
              setupPackVersion: setupPull.version ?? cfg.setupPackVersion,
            });
          } catch (se) {
            setupNote = ` (setup unseal failed — unlock matching vault)`;
            console.warn(se);
            saveCloudConfig({ ...cfg, packVersion: pull.version ?? cfg.packVersion });
          }
        } else {
          saveCloudConfig({ ...cfg, packVersion: pull.version ?? cfg.packVersion });
        }
      } else {
        saveCloudConfig({ ...cfg, packVersion: pull.version ?? cfg.packVersion });
        if (version != null) {
          setupNote = " (setup left unchanged — independent version scope)";
        } else {
          setupNote = " (unlock to merge setup/connectors)";
        }
      }

      setMsg(
        `Pulled ${imported.length} vault(s)${version != null ? ` @v${version}` : ""}${setupNote}. Re-unlock if needed.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setBusy(true);
    try {
      const cfg = loadCloudConfig();
      if (!cfg?.syncToken) {
        setMsg("Save sync token first");
        return;
      }
      const client = cloudClientFromConfig(cfg);
      const h = await client.syncHistory("vault");
      if (!h.ok) {
        setMsg(h.error ?? "History failed");
        return;
      }
      setHistoryRows(h.versions ?? []);
      if (h.history_keep != null) setHistoryKeep(h.history_keep);
      setShowHistory(true);
      setMsg(`${(h.versions ?? []).length} version(s); keep=${h.history_keep}/${h.history_keep_cap}`);
    } finally {
      setBusy(false);
    }
  };

  const saveHistoryKeep = async () => {
    setBusy(true);
    try {
      const cfg = loadCloudConfig();
      if (!cfg?.syncToken) return;
      const client = cloudClientFromConfig(cfg);
      const r = await client.syncSettings({ sync_history_keep: historyKeep });
      if (!r.ok) {
        setMsg(r.error ?? "Settings failed");
        return;
      }
      saveCloudConfig({ ...cfg, syncHistoryKeep: r.sync_history_keep });
      setMsg(`History keep → ${r.sync_history_keep} (0 = tip only)`);
    } finally {
      setBusy(false);
    }
  };

  const switchVault = async (id: string) => {
    if (locked) {
      setMsg("Unlock first to switch vaults");
      return;
    }
    const entry = registry.vaults.find((v) => v.id === id);
    if (!entry) return;
    const next = setActiveVaultId(registry, id);
    persistRegistry(next);
    // Caller must re-prompt unlock for the new IDB — we open locked instance.
    const v = openVaultFromEntry(entry);
    await onSwitchVault(v, id);
    setMsg(`Active vault → ${entry.name}. Unlock if locked.`);
  };

  const applyRename = () => {
    if (!registry.activeId || !rename.trim()) return;
    const next = renameVaultEntry(registry, registry.activeId, rename.trim());
    persistRegistry(next);
    setRename("");
    setMsg("Vault renamed");
  };

  const saveDisk = async () => {
    setBusy(true);
    try {
      let handle = await loadDirectoryHandle();
      if (!handle) {
        if (!canPickDirectory()) {
          setMsg("Folder picker unavailable");
          return;
        }
        handle = await pickVaultBackupDirectory();
      }
      if (!handle) {
        setMsg("No folder");
        return;
      }
      setFolderName(handle.name);
      const pack = await buildVaultPack(registry.vaults);
      const w = await writeVaultPackToDirectory(handle, pack);
      setMsg(w.ok ? `Saved ${w.filename} → ${handle.name}` : w.error);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadDisk = async () => {
    setBusy(true);
    try {
      let handle = await loadDirectoryHandle();
      if (!handle) handle = await pickVaultBackupDirectory();
      if (!handle) {
        setMsg("No folder");
        return;
      }
      const read = await readVaultPackFromDirectory(handle);
      if (!read.ok) {
        setMsg(read.error);
        return;
      }
      const { state, imported } = await mergeVaultPack(registry, read.pack);
      persistRegistry(state);
      setMsg(`Loaded ${imported.length} vault(s) from folder`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Vaults</h3>
      <p className="hint wrap">
        Multiple encrypted vaults on this device. LLM API keys live inside a vault — configure below
        after unlock.
      </p>
      <label className="hint">Active vault</label>
      <select
        value={registry.activeId ?? ""}
        disabled={locked || busy}
        onChange={(e) => void switchVault(e.target.value)}
      >
        {registry.vaults.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <div className="row">
        <input
          value={rename}
          onChange={(e) => setRename(e.target.value)}
          placeholder="Rename active vault"
          disabled={locked}
        />
        <button type="button" disabled={locked || !rename.trim()} onClick={applyRename}>
          Rename
        </button>
      </div>

      <h3>Disk backup folder</h3>
      <p className="hint wrap">
        Browser folder grant (not a free path). {folderName ? `Linked: ${folderName}` : "No folder linked."}
      </p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => void pickVaultBackupDirectory().then((h) => setFolderName(h?.name ?? null))}>
          Choose folder…
        </button>
        <button type="button" disabled={busy || !registry.vaults.length} onClick={() => void saveDisk()}>
          Save pack now
        </button>
        <button type="button" disabled={busy} onClick={() => void loadDisk()}>
          Load pack
        </button>
      </div>

      <h3>Combo Cloud</h3>
      <p className="hint wrap">
        Ciphertext vault pack sync. Works with prod or a <strong>LAN self-host</strong> (no internet).
        Default: <code>{DEFAULT_COMBO_API_BASE}</code>
      </p>
      <label className="hint">Sync token</label>
      <input
        type="password"
        value={syncToken}
        onChange={(e) => setSyncToken(e.target.value)}
        placeholder="cmb_sync_…"
      />
      <button
        type="button"
        className="msg-action"
        disabled={busy}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide" : "Show"} advanced (API URL / LAN / pairing)
      </button>
      {showAdvanced ? (
        <>
          <label className="hint">API base (prod or LAN)</label>
          <input
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="http://192.168.1.10:8050"
          />
          <p className="hint wrap">
            LAN: run combo-platform on another machine →{" "}
            <code>http://&lt;host&gt;:8050</code>. See <code>docs/LOCAL_NETWORK.md</code>.
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void testApi()}>
              Test API
            </button>
            <button type="button" disabled={busy || locked || !syncToken.trim()} onClick={() => void createPairCode()}>
              Generate pairing code
            </button>
          </div>
          {pairCode ? (
            <p className="hint wrap">
              Code: <code style={{ fontSize: "1.2em" }}>{pairCode}</code>
            </p>
          ) : null}
        </>
      ) : (
        <p className="hint wrap">API: {normalizeComboApiBase(apiBase, DEFAULT_COMBO_API_BASE)}</p>
      )}
      <div className="row">
        <button type="button" disabled={busy || locked} onClick={() => void saveCloud()}>
          Save cloud config
        </button>
        <button type="button" disabled={busy || locked} onClick={() => void pushPack()}>
          Push vault + setup
        </button>
        <button type="button" disabled={busy} onClick={() => void pullPack()}>
          Pull vault + setup
        </button>
        <button type="button" disabled={busy} onClick={() => void loadHistory()}>
          History…
        </button>
      </div>
      {showHistory ? (
        <div className="vault-history">
          <label className="hint">
            Keep prior revisions (0 = tip only; free ≤5 / pro ≤30)
            <input
              type="number"
              min={0}
              max={30}
              value={historyKeep}
              onChange={(e) => setHistoryKeep(Number(e.target.value))}
              style={{ width: 64, marginLeft: 8 }}
            />
          </label>
          <button type="button" className="msg-action" disabled={busy} onClick={() => void saveHistoryKeep()}>
            Save keep
          </button>
          <ul className="hint" style={{ maxHeight: 160, overflow: "auto", paddingLeft: 16 }}>
            {historyRows.map((r) => (
              <li key={r.version}>
                v{r.version}
                {r.tip ? " (tip)" : ""} · {r.updated_at?.slice(0, 19) ?? "?"} ·{" "}
                {Math.round(r.byte_size / 1024)} KB{" "}
                <button
                  type="button"
                  className="msg-action"
                  disabled={busy}
                  onClick={() => void pullPack(r.version)}
                >
                  Restore
                </button>
              </li>
            ))}
            {!historyRows.length ? <li>No versions yet — push a pack first</li> : null}
          </ul>
        </div>
      ) : null}

      <h3>Combo Link</h3>
      <p className="hint wrap">
        Opt-in remote control from the Combo portal (phone / other laptop). Agent still runs here —
        keep this sidepanel open. Live chat events are TLS + account auth (not E2E). Status:{" "}
        <strong>{linkStatus}</strong>
        {linkError ? ` — ${linkError}` : ""}
      </p>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={linkEnabled}
          disabled={locked || !syncToken.trim()}
          onChange={(e) => onLinkConfigChange?.({ linkEnabled: e.target.checked })}
        />
        Enable Combo Link (advertise online)
      </label>
      <label className="row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={syncChats}
          disabled={locked || !syncToken.trim()}
          onChange={(e) => onLinkConfigChange?.({ syncChats: e.target.checked })}
        />
        Sync chats (sessions_manifest + session blobs)
      </label>
      <div className="row">
        <button
          type="button"
          disabled={busy || locked || !syncChats}
          onClick={() =>
            void (async () => {
              setBusy(true);
              try {
                const n = (await onPullSessions?.()) ?? 0;
                setMsg(n ? `Pulled ${n} session(s)` : "No newer sessions");
              } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          Pull chats now
        </button>
      </div>
      {msg ? <p className="hint wrap">{msg}</p> : null}
    </>
  );
}
