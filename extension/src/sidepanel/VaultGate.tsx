/**
 * First-run / unlock gate — passphrase + vault name/select only (no LLM key).
 */
import {
  DEFAULT_COMBO_API_BASE,
  buildVaultPack,
  canPickDirectory,
  cloudClientFromConfig,
  createVaultEntry,
  ensureDeviceId,
  loadCloudConfig,
  loadDirectoryHandle,
  mergeVaultPack,
  normalizeComboApiBase,
  openVaultFromEntry,
  packFromCiphertextB64,
  pickVaultBackupDirectory,
  probeComboApi,
  readVaultPackFromDirectory,
  saveCloudConfig,
  saveRegistry,
  upsertVaultEntry,
  writeVaultPackToDirectory,
  type Vault,
  type VaultRegistryEntry,
  type VaultRegistryState,
} from "@combo-x/core";
import { useMemo, useState } from "react";

export type VaultGateProps = {
  appVersion: string;
  protocolVersion: number;
  registry: VaultRegistryState;
  onRegistryChange: (next: VaultRegistryState) => void;
  vault: Vault;
  onVaultChange: (vault: Vault) => void;
  onUnlocked: (vault: Vault) => void | Promise<void>;
  status: string;
  setStatus: (s: string) => void;
};

export function VaultGate({
  appVersion,
  protocolVersion,
  registry,
  onRegistryChange,
  vault: _vault,
  onVaultChange,
  onUnlocked,
  status,
  setStatus,
}: VaultGateProps) {
  const [passphrase, setPassphrase] = useState("");
  const [vaultName, setVaultName] = useState("Personal");
  const [selectedId, setSelectedId] = useState<string | null>(
    registry.activeId ?? registry.vaults[0]?.id ?? null,
  );
  const [mode, setMode] = useState<"unlock" | "create">(
    registry.vaults.length ? "unlock" : "create",
  );
  const [cloudOpen, setCloudOpen] = useState(false);
  const [syncToken, setSyncToken] = useState(() => loadCloudConfig()?.syncToken ?? "");
  const [apiBase, setApiBase] = useState(
    () => loadCloudConfig()?.apiBase ?? DEFAULT_COMBO_API_BASE,
  );
  const [showAdvanced, setShowAdvanced] = useState(
    () => {
      const b = loadCloudConfig()?.apiBase;
      return !!b && b.replace(/\/$/, "") !== DEFAULT_COMBO_API_BASE.replace(/\/$/, "");
    },
  );
  const [magicOrPair, setMagicOrPair] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => registry.vaults.find((v) => v.id === selectedId) ?? null,
    [registry.vaults, selectedId],
  );

  const applyRegistry = (next: VaultRegistryState) => {
    saveRegistry(next);
    onRegistryChange(next);
  };

  const createVault = async () => {
    if (!passphrase.trim()) return setStatus("Passphrase required");
    if (!vaultName.trim()) return setStatus("Vault name required");
    setBusy(true);
    try {
      const entry = createVaultEntry(vaultName.trim());
      const v = openVaultFromEntry(entry);
      await v.setPassphrase(passphrase);
      const next = upsertVaultEntry(registry, entry, { makeActive: true });
      applyRegistry(next);
      setSelectedId(entry.id);
      onVaultChange(v);
      setStatus(`Created vault “${entry.name}”`);
      await onUnlocked(v);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlockSelected = async () => {
    if (!passphrase.trim()) return setStatus("Passphrase required");
    const entry = selected;
    if (!entry) return setStatus("Select a vault");
    setBusy(true);
    try {
      const v = openVaultFromEntry(entry);
      const ok = await v.unlock(passphrase);
      if (!ok) {
        setStatus("Wrong passphrase");
        return;
      }
      applyRegistry({ ...registry, activeId: entry.id });
      onVaultChange(v);
      setStatus(`Unlocked “${entry.name}”`);
      await onUnlocked(v);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolvedApiBase = () =>
    normalizeComboApiBase(apiBase, DEFAULT_COMBO_API_BASE);

  const pullCloud = async () => {
    setBusy(true);
    try {
      const deviceId = ensureDeviceId();
      let token = syncToken.trim();
      const base = resolvedApiBase();
      setApiBase(base);
      const client = cloudClientFromConfig({
        apiBase: base,
        syncToken: token,
        deviceId,
        packVersion: loadCloudConfig()?.packVersion ?? 0,
      });
      if (magicOrPair.trim()) {
        const raw = magicOrPair.trim();
        const isPair = /^[A-Z0-9]{6,12}$/i.test(raw) && !raw.includes(".");
        const auth = isPair
          ? await client.pairConsume(raw, "Combo-X")
          : await client.magicConsume(raw, "Combo-X");
        if (!auth.ok || !auth.sync_token) {
          setStatus(auth.error ?? "Cloud auth failed");
          return;
        }
        token = auth.sync_token;
        setSyncToken(token);
      }
      if (!token) {
        setStatus("Paste sync token (cmb_sync_…) or magic/pair code");
        return;
      }
      client.setSyncToken(token);
      const pull = await client.syncPull("vault");
      if (!pull.ok) {
        setStatus(pull.error ?? "Pull failed");
        return;
      }
      if (!pull.ciphertext_b64) {
        setStatus("Cloud vault empty — create a local vault, then Push from Vault tab");
        saveCloudConfig({
          apiBase: base,
          syncToken: token,
          deviceId,
          packVersion: 0,
        });
        return;
      }
      const pack = packFromCiphertextB64(pull.ciphertext_b64);
      const { state, imported } = await mergeVaultPack(registry, pack);
      applyRegistry(state);
      if (state.activeId) setSelectedId(state.activeId);
      saveCloudConfig({
        apiBase: base,
        syncToken: token,
        deviceId,
        packVersion: pull.version ?? 0,
      });
      setMode("unlock");
      setCloudOpen(false);
      setStatus(`Pulled ${imported.length} vault(s) from ${base} — unlock with passphrase`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const testApi = async () => {
    setBusy(true);
    try {
      const base = resolvedApiBase();
      setApiBase(base);
      const r = await probeComboApi(base);
      setStatus(r.ok ? `API OK — ${r.detail}` : `API failed — ${r.detail}`);
    } finally {
      setBusy(false);
    }
  };

  const loadDisk = async () => {
    setBusy(true);
    try {
      let handle = await loadDirectoryHandle();
      if (!handle) {
        if (!canPickDirectory()) {
          setStatus("Folder picker unavailable in this browser");
          return;
        }
        handle = await pickVaultBackupDirectory();
      }
      if (!handle) {
        setStatus("No folder selected");
        return;
      }
      const read = await readVaultPackFromDirectory(handle);
      if (!read.ok) {
        setStatus(read.error);
        return;
      }
      const { state, imported } = await mergeVaultPack(registry, read.pack);
      applyRegistry(state);
      if (state.activeId) setSelectedId(state.activeId);
      setMode("unlock");
      setStatus(`Loaded ${imported.length} vault(s) from folder — unlock with passphrase`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseDiskFolder = async () => {
    if (!canPickDirectory()) {
      setStatus("Folder picker unavailable (use Chromium/Firefox with File System Access)");
      return;
    }
    setBusy(true);
    try {
      const handle = await pickVaultBackupDirectory();
      if (!handle) {
        setStatus("No folder selected");
        return;
      }
      if (registry.vaults.length) {
        const pack = await buildVaultPack(registry.vaults);
        const w = await writeVaultPackToDirectory(handle, pack);
        setStatus(
          w.ok
            ? `Folder linked — saved ${w.filename} (browser grant, not a free path)`
            : w.error,
        );
      } else {
        setStatus(`Folder linked: ${handle.name} — create a vault, then save from Settings`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          Combo<span>-X</span>
          <span className="brand-version" title={`Protocol ${protocolVersion}`}>
            v{appVersion}
          </span>
        </div>
      </header>
      <div className="onboarding">
        <h1>Local vaults. Your keys.</h1>
        <p>
          Encrypted vaults (AES-GCM). Pick or create a vault with a passphrase — add your LLM API
          key later in Settings. Optional: pull a vault pack from Combo Cloud or a disk folder.
        </p>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={mode === "unlock" ? "primary" : undefined}
            disabled={!registry.vaults.length || busy}
            onClick={() => setMode("unlock")}
          >
            Unlock
          </button>
          <button
            type="button"
            className={mode === "create" ? "primary" : undefined}
            disabled={busy}
            onClick={() => setMode("create")}
          >
            Create vault
          </button>
          <button type="button" disabled={busy} onClick={() => setCloudOpen((v) => !v)}>
            Pull from Cloud…
          </button>
          <button type="button" disabled={busy} onClick={() => void loadDisk()}>
            Load from folder…
          </button>
          <button type="button" disabled={busy} onClick={() => void chooseDiskFolder()}>
            Choose disk folder…
          </button>
        </div>
        <p className="hint wrap">
          Disk location uses a browser folder grant (File System Access) — not a free filesystem
          path like /Users/….
        </p>

        {cloudOpen ? (
          <div className="card" style={{ marginTop: 12 }}>
            <label className="hint">Sync token (cmb_sync_…)</label>
            <input
              type="password"
              value={syncToken}
              onChange={(e) => setSyncToken(e.target.value)}
              placeholder="cmb_sync_…"
            />
            <label className="hint">Or magic token / pairing code</label>
            <input
              value={magicOrPair}
              onChange={(e) => setMagicOrPair(e.target.value)}
              placeholder="magic token or AB12CD34"
            />
            <button
              type="button"
              className="msg-action"
              disabled={busy}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide" : "Show"} advanced (API URL / LAN)
            </button>
            {showAdvanced ? (
              <>
                <label className="hint">Combo API base (prod or LAN)</label>
                <input
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="http://192.168.1.10:8050"
                />
                <p className="hint wrap">
                  Self-host: <code>docker compose up</code> in combo-platform → e.g.{" "}
                  <code>http://&lt;lan-ip&gt;:8050</code>. No internet required for sync/Link on LAN.
                </p>
                <button type="button" disabled={busy} onClick={() => void testApi()}>
                  Test API
                </button>
              </>
            ) : (
              <p className="hint wrap">API: {resolvedApiBase()}</p>
            )}
            <button type="button" className="primary" disabled={busy} onClick={() => void pullCloud()}>
              Pull vault pack
            </button>
          </div>
        ) : null}

        {mode === "create" ? (
          <>
            <label className="hint">Vault name</label>
            <input
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              placeholder="Personal"
            />
          </>
        ) : (
          <>
            <label className="hint">Vault</label>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              disabled={!registry.vaults.length}
            >
              {!registry.vaults.length ? <option value="">No local vaults</option> : null}
              {registry.vaults.map((v: VaultRegistryEntry) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="hint">Passphrase</label>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="passphrase"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void (mode === "create" ? createVault() : unlockSelected());
            }
          }}
        />

        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void (mode === "create" ? createVault() : unlockSelected())}
          >
            {mode === "create" ? "Create & unlock" : "Unlock"}
          </button>
        </div>
        {status ? <p className="hint wrap">{status}</p> : null}
      </div>
    </div>
  );
}
