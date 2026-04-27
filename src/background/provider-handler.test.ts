import { describe, it, expect, vi } from "vitest";

// provider-handler imports modules that call chrome.storage at init-time
// (loadSuggestedChains). Stub the API surface we touch before importing.
(globalThis as any).chrome = {
  storage: {
    local: {
      get: (_k: any, cb: (v: any) => void) => cb({}),
      set: (_v: any, cb?: () => void) => cb && cb(),
    },
    session: {
      remove: vi.fn(() => Promise.resolve()),
      set: vi.fn(() => Promise.resolve()),
    },
  },
  runtime: { getURL: (p: string) => p },
  windows: { create: vi.fn(), onRemoved: { addListener: vi.fn(), removeListener: vi.fn() } },
};

const { isAllowedDappOrigin, handleProviderRequest } = await import("./provider-handler");

describe("isAllowedDappOrigin – HTTPS-only allow-list", () => {
  it("accepts plain https origins", () => {
    expect(isAllowedDappOrigin("https://app.example.com")).toBe(true);
    expect(isAllowedDappOrigin("https://gonka.ai")).toBe(true);
    expect(isAllowedDappOrigin("https://localhost:8443")).toBe(true);
  });

  it("rejects plain http (including localhost)", () => {
    expect(isAllowedDappOrigin("http://localhost:8787")).toBe(false);
    expect(isAllowedDappOrigin("http://127.0.0.1:3000")).toBe(false);
    expect(isAllowedDappOrigin("http://example.com")).toBe(false);
  });

  it("rejects file://, data:, chrome-extension:// and other non-https schemes", () => {
    expect(isAllowedDappOrigin("file:///Users/x/index.html")).toBe(false);
    expect(isAllowedDappOrigin("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isAllowedDappOrigin("chrome-extension://abc")).toBe(false);
    expect(isAllowedDappOrigin("ftp://example.com")).toBe(false);
  });

  it("rejects empty / undefined / malformed origins", () => {
    expect(isAllowedDappOrigin(undefined)).toBe(false);
    expect(isAllowedDappOrigin(null)).toBe(false);
    expect(isAllowedDappOrigin("")).toBe(false);
    expect(isAllowedDappOrigin("not a url")).toBe(false);
    expect(isAllowedDappOrigin("//example.com")).toBe(false);
  });
});

describe("handleProviderRequest – HTTPS gate", () => {
  it("blocks every method for non-https origins before doing any work", async () => {
    const methods = [
      "enable",
      "getKey",
      "signAmino",
      "signDirect",
      "signArbitrary",
      "sendTx",
      "experimentalSuggestChain",
    ];

    for (const method of methods) {
      const res = await handleProviderRequest(method, {}, "http://localhost:8787");
      expect(res.error).toMatch(/HTTPS/);
      expect(res.result).toBeUndefined();
    }
  });

  it("blocks requests with no origin at all", async () => {
    const res = await handleProviderRequest("enable", { chainIds: ["gonka-mainnet-1"] }, undefined);
    expect(res.error).toMatch(/HTTPS/);
  });
});
