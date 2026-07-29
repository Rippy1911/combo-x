import { describe, expect, it, vi } from "vitest";
import {
  deleteVaultSecret,
  normalizeVaultLabel,
  saveVaultSecret,
} from "./VaultSecretsForm";

describe("normalizeVaultLabel", () => {
  it("trims and collapses whitespace to underscores", () => {
    expect(normalizeVaultLabel("  azure speech key  ")).toBe("azure_speech_key");
  });
});

describe("saveVaultSecret", () => {
  it("rejects empty label or value", async () => {
    const putByLabel = vi.fn();
    await expect(saveVaultSecret({ putByLabel }, "", "x")).resolves.toEqual({
      ok: false,
      error: "Label required",
    });
    await expect(saveVaultSecret({ putByLabel }, "k", "")).resolves.toEqual({
      ok: false,
      error: "Value required",
    });
    expect(putByLabel).not.toHaveBeenCalled();
  });

  it("writes normalized label", async () => {
    const putByLabel = vi.fn(async () => "id");
    await expect(
      saveVaultSecret({ putByLabel }, "azure_speech_key", "sekret"),
    ).resolves.toEqual({ ok: true, label: "azure_speech_key" });
    expect(putByLabel).toHaveBeenCalledWith("azure_speech_key", "sekret");
  });
});

describe("deleteVaultSecret", () => {
  it("reports missing labels", async () => {
    const deleteByLabel = vi.fn(async () => false);
    await expect(deleteVaultSecret({ deleteByLabel }, "nope")).resolves.toEqual({
      ok: false,
      error: "No secret named nope",
    });
  });

  it("deletes when present", async () => {
    const deleteByLabel = vi.fn(async () => true);
    await expect(
      deleteVaultSecret({ deleteByLabel }, "azure_speech_key"),
    ).resolves.toEqual({ ok: true, label: "azure_speech_key" });
  });
});
