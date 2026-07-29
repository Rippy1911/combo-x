import { useState } from "react";
import type { Vault } from "@combo-x/core";

export function normalizeVaultLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, "_");
}

export async function saveVaultSecret(
  vault: Pick<Vault, "putByLabel">,
  label: string,
  value: string,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const normalized = normalizeVaultLabel(label);
  if (!normalized) return { ok: false, error: "Label required" };
  if (!value) return { ok: false, error: "Value required" };
  await vault.putByLabel(normalized, value);
  return { ok: true, label: normalized };
}

export async function deleteVaultSecret(
  vault: Pick<Vault, "deleteByLabel">,
  label: string,
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const normalized = normalizeVaultLabel(label);
  if (!normalized) return { ok: false, error: "Label required" };
  const deleted = await vault.deleteByLabel(normalized);
  if (!deleted) return { ok: false, error: `No secret named ${normalized}` };
  return { ok: true, label: normalized };
}

export function VaultSecretsForm({
  vault,
  locked,
  onChanged,
}: {
  vault: Vault;
  locked: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: "save" | "delete") => {
    if (locked || !vault.isUnlocked()) {
      setMsg("Unlock vault first");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (action === "save") {
        const r = await saveVaultSecret(vault, label, value);
        if (!r.ok) {
          setMsg(r.error);
          return;
        }
        setValue("");
        setMsg(`Saved ${r.label}`);
      } else {
        const r = await deleteVaultSecret(vault, label);
        if (!r.ok) {
          setMsg(r.error);
          return;
        }
        setValue("");
        setMsg(`Deleted ${r.label}`);
      }
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-secrets-form" style={{ marginTop: 12 }}>
      <h3>Add secret</h3>
      <p className="hint wrap">
        Exact label names — e.g. <code>azure_speech_key</code>,{" "}
        <code>azure_speech_region</code> (default <code>northeurope</code>).
      </p>
      <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.replace(/\s+/g, "_"))}
          placeholder="label"
          spellCheck={false}
          disabled={locked || busy}
          aria-label="Vault secret label"
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          autoComplete="off"
          disabled={locked || busy}
          aria-label="Vault secret value"
        />
        <button
          type="button"
          disabled={locked || busy || !normalizeVaultLabel(label) || !value}
          onClick={() => void run("save")}
        >
          Save
        </button>
        <button
          type="button"
          className="dangerish"
          disabled={locked || busy || !normalizeVaultLabel(label)}
          onClick={() => void run("delete")}
        >
          Delete
        </button>
      </div>
      {msg ? <p className="hint wrap">{msg}</p> : null}
    </div>
  );
}
