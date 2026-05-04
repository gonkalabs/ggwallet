import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the keystore so we can drive `isUnlocked()` from individual
// tests — the anti-spam paths below need an unlocked wallet to reach
// `requestApproval()` without going through the unlock popup flow.
vi.mock("./keystore", () => ({
  getMnemonic: vi.fn(() => null),
  getAddress: vi.fn(() => ""),
  isUnlocked: vi.fn(() => true),
  getWalletList: vi.fn(async () => []),
}));

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
  windows: {
    create: vi.fn(),
    update: vi.fn(() => Promise.resolve()),
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

const { isAllowedDappOrigin, handleProviderRequest, __resetAntiSpamStateForTests } = await import(
  "./provider-handler"
);
const { isUnlocked } = await import("./keystore");

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

// ------------------------------------------------------------------
//  Anti-spam — ref https://github.com/gonkalabs/ggwallet/issues/2
//
//  A malicious site could call approval-triggering methods in a loop
//  and drown the user in popup windows. The tests below verify that:
//
//    1. Legitimate sequential flows (hex.exchange style: enable →
//       signAmino → ...) are not blocked.
//    2. A flood of concurrent approvals from one origin opens at most
//       one popup at a time and is bounded by a queue cap.
//    3. Distinct origins never block each other.
//    4. Locked-wallet spam doesn't spawn multiple unlock popups.
//    5. A per-origin rate limit kicks in before any pathological
//       cheap-method flood can wear down the background script.
//
//  Tests use distinct origins so the module-local state for queue /
//  rate-limit doesn't leak between cases.
// ------------------------------------------------------------------

const SIGN_PARAMS = {
  chainId: "gonka-mainnet-1",
  signer: "",
  signDoc: {},
};

describe("anti-spam: approval popup queue", () => {
  beforeEach(() => {
    __resetAntiSpamStateForTests();
    vi.mocked(isUnlocked).mockReturnValue(true);
    (globalThis as any).chrome.windows.create.mockClear();
    (globalThis as any).chrome.windows.update.mockReset();
    (globalThis as any).chrome.windows.update.mockReturnValue(Promise.resolve());
  });

  it("opens exactly one popup for concurrent approvals from the same origin (the rest queue)", async () => {
    const origin = "https://queue-one.example.com";

    const p1 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p2 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p3 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);

    // Let the queued promises settle through their microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect((globalThis as any).chrome.windows.create).toHaveBeenCalledTimes(1);

    // Prevent the test runner from complaining about dangling promises.
    void p1;
    void p2;
    void p3;
  });

  it("rejects excess approvals with a clear error once the per-origin queue is full", async () => {
    const origin = "https://queue-full.example.com";

    const p1 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p2 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p3 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    // Fourth request exceeds MAX_QUEUED_APPROVALS_PER_ORIGIN (3) and must
    // be rejected synchronously without creating another popup.
    const p4 = await handleProviderRequest("signAmino", SIGN_PARAMS, origin);

    expect(p4.error).toMatch(/too many pending/i);
    expect((globalThis as any).chrome.windows.create).toHaveBeenCalledTimes(1);

    void p1;
    void p2;
    void p3;
  });

  it("opens independent popups for distinct origins (no cross-origin interference)", async () => {
    const originA = "https://dapp-a.example.com";
    const originB = "https://dapp-b.example.com";

    const pA = handleProviderRequest("signAmino", SIGN_PARAMS, originA);
    const pB = handleProviderRequest("signAmino", SIGN_PARAMS, originB);

    await Promise.resolve();
    await Promise.resolve();

    expect((globalThis as any).chrome.windows.create).toHaveBeenCalledTimes(2);

    void pA;
    void pB;
  });

  it("focuses the open popup when an origin's queue is full (so the user can respond)", async () => {
    const origin = "https://focus-existing.example.com";

    // Simulate the popup actually getting a window id — the create
    // mock invokes its callback with a fake window.
    let fakeWinId = 1001;
    (globalThis as any).chrome.windows.create.mockImplementation(
      (_opts: any, cb?: any) => cb && cb({ id: fakeWinId++ })
    );

    const p1 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p2 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    const p3 = handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    await Promise.resolve();
    await Promise.resolve();

    // Fourth call exceeds the queue; we should re-focus the active popup.
    const p4 = await handleProviderRequest("signAmino", SIGN_PARAMS, origin);
    expect(p4.error).toMatch(/too many pending/i);
    expect((globalThis as any).chrome.windows.update).toHaveBeenCalledWith(
      1001,
      expect.objectContaining({ focused: true })
    );

    void p1;
    void p2;
    void p3;
  });
});

describe("anti-spam: unlock popup dedupe", () => {
  beforeEach(() => {
    __resetAntiSpamStateForTests();
    vi.mocked(isUnlocked).mockReturnValue(false);
    (globalThis as any).chrome.windows.create.mockReset();
  });

  it("spawns at most one unlock popup for a burst of locked dApp requests", async () => {
    const origin = "https://locked-spam.example.com";

    (globalThis as any).chrome.windows.create.mockImplementation(
      (_opts: any, cb?: any) => cb && cb({ id: 4242 })
    );

    const promises = Array.from({ length: 10 }, () =>
      handleProviderRequest("signAmino", SIGN_PARAMS, origin)
    );

    // Flush microtasks — chrome.storage.session.set resolves next tick,
    // then openOrFocusUnlockWindow runs. The first call creates the
    // popup; every subsequent call should only invoke chrome.windows.update.
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect((globalThis as any).chrome.windows.create).toHaveBeenCalledTimes(1);

    void promises;
  });
});

describe("anti-spam: per-origin rate limit", () => {
  beforeEach(() => {
    __resetAntiSpamStateForTests();
    vi.mocked(isUnlocked).mockReturnValue(true);
  });

  it("rate-limits an origin after too many requests in the sliding window", async () => {
    const origin = "https://flood.example.com";

    // 60 requests (the configured limit) should all pass the rate
    // check; the 61st should be rejected with a rate-limit error.
    // `experimentalSuggestChain` is used because it short-circuits on
    // invalid chain info, avoiding unrelated side effects.
    for (let i = 0; i < 60; i++) {
      const r = await handleProviderRequest(
        "experimentalSuggestChain",
        { chainInfo: {} },
        origin
      );
      expect(r.error || "").not.toMatch(/too many requests/i);
    }

    const over = await handleProviderRequest(
      "experimentalSuggestChain",
      { chainInfo: {} },
      origin
    );
    expect(over.error).toMatch(/too many requests/i);
  });

  it("maintains independent rate-limit counters per origin", async () => {
    const burnedOrigin = "https://burned.example.com";
    const freshOrigin = "https://fresh.example.com";

    for (let i = 0; i < 61; i++) {
      await handleProviderRequest(
        "experimentalSuggestChain",
        { chainInfo: {} },
        burnedOrigin
      );
    }
    // Confirm burned origin is rate-limited.
    const blocked = await handleProviderRequest(
      "experimentalSuggestChain",
      { chainInfo: {} },
      burnedOrigin
    );
    expect(blocked.error).toMatch(/too many requests/i);

    // Fresh origin must be unaffected by the other origin's flood.
    const ok = await handleProviderRequest(
      "experimentalSuggestChain",
      { chainInfo: {} },
      freshOrigin
    );
    expect(ok.error || "").not.toMatch(/too many requests/i);
  });
});
