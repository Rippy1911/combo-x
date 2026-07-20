import { describe, expect, it } from "vitest";
import { VAULT_RECIPES, getVaultRecipe } from "./recipes.js";

describe("vault recipes", () => {
  it("private includes ns-food + anatome + uploads", () => {
    const ids = VAULT_RECIPES.private.connectors("vid").map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["ns-food", "anatome", "ns-uploads"]));
  });

  it("work includes ideaforge + github + ns-exec", () => {
    const ids = VAULT_RECIPES.work.connectors("wid").map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["ideaforge", "github-rest", "ns-exec"]));
  });

  it("getVaultRecipe rejects unknown", () => {
    expect(getVaultRecipe("nope")).toBeNull();
    expect(getVaultRecipe("private")?.name).toBe("private");
  });
});
