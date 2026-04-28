import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// gonka-key-service touches chrome.storage.local at multiple points
// (install id, key persistence, usage capture). Stub it before importing.

const _store: Record<string, any> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn((key: string | string[] | object, cb?: (v: any) => void) => {
        let result: any;
        if (typeof key === "string") {
          result = key in _store ? { [key]: _store[key] } : {};
        } else if (Array.isArray(key)) {
          result = {};
          for (const k of key) if (k in _store) result[k] = _store[k];
        } else {
          result = { ..._store };
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, any>, cb?: () => void) => {
        Object.assign(_store, items);
        if (cb) cb();
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[], cb?: () => void) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete _store[k];
        if (cb) cb();
        return Promise.resolve();
      }),
    },
  },
};

const { sha256 } = await import("@noble/hashes/sha256");

const {
  solvePow,
  parseRateLimitHeaders,
  ensureAutoApiKey,
  getInstallId,
  getAutoApiKey,
} = await import("./gonka-key-service");

const { getEffectiveApiKey } = await import("./rpc");

beforeEach(() => {
  for (const k of Object.keys(_store)) delete _store[k];
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ----------------------------------------------------------------------------
//  PoW
// ----------------------------------------------------------------------------

describe("solvePow", () => {
  it("returns nonce '0' when difficulty is 0 (gate disabled)", () => {
    expect(solvePow("any-install-id", 0)).toBe("0");
  });

  it("solves difficulty 4 quickly and the result is verifiable", () => {
    const nonce = solvePow("test-install", 4);
    const enc = new TextEncoder();
    const h = sha256(enc.encode(`test-install:${nonce}`));
    // Top 4 bits of the first byte must be zero.
    expect(h[0] >> 4).toBe(0);
  });

  it("solves difficulty 12 (full + partial byte) — boundary case", () => {
    const nonce = solvePow("test-install", 12);
    const enc = new TextEncoder();
    const h = sha256(enc.encode(`test-install:${nonce}`));
    expect(h[0]).toBe(0); // 8 leading zero bits in the first byte
    expect(h[1] >> 4).toBe(0); // 4 leading zero bits in the second byte
  });

  it("throws when no nonce found within the iteration cap", () => {
    // 32-bit difficulty is unsolvable in any reasonable time → enforce the cap.
    expect(() => solvePow("hard", 32, 1000)).toThrow(/PoW unsolved/);
  });
});

// ----------------------------------------------------------------------------
//  Header parser
// ----------------------------------------------------------------------------

describe("parseRateLimitHeaders", () => {
  it("returns null when the wallet headers are absent", () => {
    const h = new Headers({ "Content-Type": "application/json" });
    expect(parseRateLimitHeaders(h)).toBeNull();
  });

  it("returns a usage snapshot when all headers are present", () => {
    const h = new Headers({
      "X-RateLimit-Tier": "wallet-install",
      "X-RateLimit-Limit-Day": "10000",
      "X-RateLimit-Remaining-Day": "9437",
      "X-RateLimit-Limit-Minute": "60",
      "X-RateLimit-Remaining-Minute": "47",
      "X-RateLimit-Reset-At": "2026-04-29T00:00:00Z",
    });
    const u = parseRateLimitHeaders(h);
    expect(u).not.toBeNull();
    expect(u!.tier).toBe("wallet-install");
    expect(u!.limitDay).toBe(10000);
    expect(u!.remainingDay).toBe(9437);
    expect(u!.limitMinute).toBe(60);
    expect(u!.remainingMinute).toBe(47);
    expect(u!.resetAt).toBe("2026-04-29T00:00:00Z");
  });

  it("returns null when only some headers are set (e.g. portal key path)", () => {
    const h = new Headers({
      "X-RateLimit-Tier": "wallet-install",
      "X-RateLimit-Limit-Day": "10000",
    });
    expect(parseRateLimitHeaders(h)).toBeNull();
  });
});

// ----------------------------------------------------------------------------
//  Install id
// ----------------------------------------------------------------------------

describe("getInstallId", () => {
  it("generates and persists a UUID-shaped id on first call", async () => {
    const id = await getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns the same id on subsequent calls", async () => {
    const a = await getInstallId();
    const b = await getInstallId();
    expect(a).toBe(b);
  });
});

// ----------------------------------------------------------------------------
//  Effective key precedence (manual ?? auto)
// ----------------------------------------------------------------------------

describe("getEffectiveApiKey", () => {
  it("returns null when neither key is present", async () => {
    expect(await getEffectiveApiKey()).toBeNull();
  });

  it("returns the auto key when only the auto key is set", async () => {
    _store["gg_rpc_gonka_gg_api_key_auto"] = "gg_live_auto";
    expect(await getEffectiveApiKey()).toBe("gg_live_auto");
  });

  it("returns the manual key when both keys are set (manual wins)", async () => {
    _store["gg_rpc_gonka_gg_api_key"] = "gg_live_manual";
    _store["gg_rpc_gonka_gg_api_key_auto"] = "gg_live_auto";
    expect(await getEffectiveApiKey()).toBe("gg_live_manual");
  });
});

// ----------------------------------------------------------------------------
//  ensureAutoApiKey idempotency
// ----------------------------------------------------------------------------

describe("ensureAutoApiKey", () => {
  it("is a no-op when the key already exists", async () => {
    _store["gg_rpc_gonka_gg_api_key_auto"] = "gg_live_existing";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const key = await ensureAutoApiKey();
    expect(key).toBe("gg_live_existing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("collapses concurrent calls into a single network round-trip", async () => {
    // Simulate the real two-hop flow: 401 + Challenge, then 200 + apiKey.
    const fetchSpy = vi.fn();
    fetchSpy
      .mockResolvedValueOnce({
        // First hop: PoW challenge with very low difficulty so the test is fast.
        ok: false,
        status: 401,
        headers: new Headers(),
        clone() {
          return this;
        },
        json: () => Promise.resolve({ difficulty: 4 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            apiKey: "gg_live_minted",
            tier: "wallet-install",
            quota: { perMinute: 60, perDay: 10000 },
            issuedAt: "2026-04-28T13:05:00Z",
            expiresAt: null,
          }),
      })
      // Subsequent /v1/keys/info call after issuance — return success.
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            tier: "wallet-install",
            quota: { perMinute: 60, perDay: 10000 },
            usage: { lastMinute: 0, today: 0 },
            issuedAt: "2026-04-28T13:05:00Z",
            lastSeen: "2026-04-28T13:05:00Z",
          }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    // Three concurrent callers all asking for the auto key.
    const [a, b, c] = await Promise.all([
      ensureAutoApiKey(),
      ensureAutoApiKey(),
      ensureAutoApiKey(),
    ]);

    expect(a).toBe("gg_live_minted");
    expect(b).toBe("gg_live_minted");
    expect(c).toBe("gg_live_minted");
    expect(await getAutoApiKey()).toBe("gg_live_minted");

    // Only one /v1/keys/issue PoW pair (2 calls) + one /v1/keys/info bind.
    // = 3 total. If we'd raced, we'd see 6+.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const issueCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/v1/keys/issue"),
    );
    expect(issueCalls).toHaveLength(2);
    const infoCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/v1/keys/info"),
    );
    expect(infoCalls).toHaveLength(1);
  });

  it("returns null when issuance fails and leaves the auto key unset", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      clone() {
        return this;
      },
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("server down"),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await ensureAutoApiKey();
    expect(result).toBeNull();
    expect(await getAutoApiKey()).toBeNull();
  });
});
