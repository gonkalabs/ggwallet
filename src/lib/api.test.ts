import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTransactions } from "./api";

const mockApiResponse = {
  page: 1,
  limit: 20,
  has_more: false,
  total_fetched: 2,
  items: [
    {
      hash: "ABC123",
      block_height: 100,
      timestamp: "2025-01-01T00:00:00Z",
      sender: "gonka1sender",
      receiver: "gonka1me",
      amount: "5000000000 ngonka",
      fee: "0",
      gas_used: 80000,
      gas_wanted: 100000,
      status: "success",
      tx_type: "received",
      message_type: "MsgSend",
      memo: "",
      direction: "in",
      is_ibc: false,
      token_symbol: "GNK",
    },
    {
      hash: "DEF456",
      block_height: 200,
      timestamp: "2025-01-02T00:00:00Z",
      sender: "gonka1me",
      receiver: "gonka1receiver",
      amount: "1000000000 ngonka",
      fee: "0",
      gas_used: 70000,
      gas_wanted: 100000,
      status: "success",
      tx_type: "sent",
      message_type: "MsgSend",
      memo: "test memo",
      direction: "out",
      is_ibc: false,
      token_symbol: "GNK",
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTransactions", () => {
  it("parses API response and normalizes items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      })
    );

    const result = await fetchTransactions("gonka1me");

    expect(result.transactions).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(2);

    const rx = result.transactions[0];
    expect(rx.hash).toBe("ABC123");
    expect(rx.amount).toBe("5000000000");
    expect(rx.denom).toBe("ngonka");
    expect(rx.direction).toBe("received");
    expect(rx.sender).toBe("gonka1sender");

    const tx = result.transactions[1];
    expect(tx.direction).toBe("sent");
    expect(tx.memo).toBe("test memo");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    await expect(fetchTransactions("gonka1me")).rejects.toThrow("Explorer API error: 500");
  });

  it("handles empty items gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], has_more: false, total_fetched: 0 }),
      })
    );

    const result = await fetchTransactions("gonka1me");
    expect(result.transactions).toHaveLength(0);
  });

  it("detects self-transfers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                hash: "SELF1",
                block_height: 300,
                timestamp: "2025-01-03T00:00:00Z",
                sender: "gonka1me",
                receiver: "gonka1me",
                amount: "100 ngonka",
                direction: "out",
                tx_type: "sent",
                status: "success",
              },
            ],
          }),
      })
    );

    const result = await fetchTransactions("gonka1me");
    expect(result.transactions[0].direction).toBe("self");
  });
});
