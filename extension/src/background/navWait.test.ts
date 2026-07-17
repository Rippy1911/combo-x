import { describe, expect, it } from "vitest";
import {
  isHistoryNavSettled,
  isNavigationSettled,
  normalizeNavUrl,
  urlsMatchTarget,
} from "./navWait";

describe("navWait", () => {
  it("normalizeNavUrl strips hash and trailing slash", () => {
    expect(normalizeNavUrl("https://airon.coach/#hero")).toBe("https://airon.coach/");
    expect(normalizeNavUrl("https://airon.coach/path/")).toBe("https://airon.coach/path");
  });

  it("urlsMatchTarget tolerates www and root redirects", () => {
    expect(urlsMatchTarget("https://www.airon.coach/", "https://airon.coach")).toBe(true);
    expect(urlsMatchTarget("https://airon.coach/pl", "https://airon.coach/")).toBe(true);
    expect(urlsMatchTarget("https://google.com/", "https://airon.coach")).toBe(false);
  });

  it("does not settle on previous page complete (stale race)", () => {
    expect(
      isNavigationSettled({
        startUrl: "https://www.google.com/",
        targetUrl: "https://airon.coach/",
        currentUrl: "https://www.google.com/",
        status: "complete",
        sawLoading: false,
      }),
    ).toBe(false);
  });

  it("settles when complete on target after loading", () => {
    expect(
      isNavigationSettled({
        startUrl: "https://www.google.com/",
        targetUrl: "https://airon.coach/",
        currentUrl: "https://airon.coach/",
        status: "complete",
        sawLoading: true,
      }),
    ).toBe(true);
  });

  it("settles on same-site redirect after leaving start", () => {
    expect(
      isNavigationSettled({
        startUrl: "https://www.google.com/",
        targetUrl: "https://airon.coach/",
        currentUrl: "https://airon.coach/en",
        status: "complete",
        sawLoading: true,
      }),
    ).toBe(true);
  });

  it("idempotent navigate when already on target", () => {
    expect(
      isNavigationSettled({
        startUrl: "https://airon.coach/",
        targetUrl: "https://airon.coach",
        currentUrl: "https://airon.coach/",
        status: "complete",
        sawLoading: false,
      }),
    ).toBe(true);
  });

  it("history nav settles only after leave + loading", () => {
    expect(
      isHistoryNavSettled({
        startUrl: "https://airon.coach/",
        currentUrl: "https://airon.coach/",
        status: "complete",
        sawLoading: true,
      }),
    ).toBe(false);
    expect(
      isHistoryNavSettled({
        startUrl: "https://airon.coach/",
        currentUrl: "https://www.google.com/",
        status: "complete",
        sawLoading: true,
      }),
    ).toBe(true);
  });
});
