import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  ApprovalPolicyStore,
  policyMatches,
  targetKeyFromArgs,
} from "./approvalPolicy.js";

describe("approvalPolicy", () => {
  it("fingerprints url / index+text", () => {
    expect(targetKeyFromArgs("navigate", { url: "https://x.test" })).toBe(
      "url:https://x.test",
    );
    expect(targetKeyFromArgs("type_index", { index: 6, text: "abc" })).toBe(
      "idx:6:abc",
    );
  });

  it("matches tool-wide then target-specific", () => {
    const policies = [
      {
        id: "1",
        tool: "type_index",
        targetKey: null as string | null,
        createdAt: "a",
      },
      {
        id: "2",
        tool: "type_index",
        targetKey: "idx:6:x",
        createdAt: "b",
      },
    ];
    expect(policyMatches(policies, "type_index", { index: 6, text: "x" })?.id).toBe(
      "2",
    );
    expect(policyMatches(policies, "type_index", { index: 1 })?.id).toBe("1");
    expect(policyMatches(policies, "click", {})).toBeNull();
  });

  it("persists remember", async () => {
    const store = new ApprovalPolicyStore(
      `combo_x_approval_policies_test_${crypto.randomUUID()}`,
    );
    await store.remember("click", null);
    expect(await store.allows("click", {})).toBe(true);
    expect(await store.allows("type_index", { index: 1 })).toBe(false);
  });
});
