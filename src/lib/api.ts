import { GONKA_EXPLORER_URL, GONKA_EXPLORER_API_KEY } from "./gonka";

/**
 * Gonka.gg Explorer API client.
 *
 * Response shape from /api/public/wallets/{address}/transactions:
 * {
 *   address, direction, source, page, limit, has_more, total_fetched,
 *   items: [{
 *     hash, block_height, timestamp, sender, receiver,
 *     amount ("10000000 ngonka"), fee, gas_used, gas_wanted,
 *     status ("success"), tx_type ("received"), message_type ("MsgSend"),
 *     memo, direction ("in"|"out"), is_ibc, token_symbol ("GNK"),
 *     message_sender, ...
 *   }]
 * }
 */

export interface Transaction {
  hash: string;
  height: string;
  timestamp: string;
  sender: string;
  receiver: string;
  amount: string;       // raw, e.g. "10000000"
  amountRaw: string;    // original, e.g. "10000000 ngonka"
  denom: string;
  direction: "sent" | "received" | "self";
  txType: string;
  messageType: string;
  status: string;
  fee: string | null;
  gasUsed: number;
  gasWanted: number;
  memo: string;
  tokenSymbol: string;
  isIbc: boolean;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Fetch transactions for a wallet address from gonka.gg explorer.
 */
export async function fetchTransactions(
  address: string,
  page = 1,
  pageSize = 20,
  direction: "all" | "sent" | "received" = "all"
): Promise<TransactionsResponse> {
  const url = new URL(
    `/api/public/wallets/${address}/transactions`,
    GONKA_EXPLORER_URL
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("source", "live");
  url.searchParams.set("direction", direction);
  url.searchParams.set("fetch_timestamps", "true");

  const resp = await fetch(url.toString(), {
    headers: {
      "X-API-Key": GONKA_EXPLORER_API_KEY,
    },
  });

  if (!resp.ok) {
    throw new Error(`Explorer API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();

  const items: any[] = data.items || [];

  return {
    transactions: items.map((item) => normalizeItem(item, address)),
    total: data.total_fetched || items.length,
    page: data.page || page,
    pageSize: data.limit || pageSize,
    hasMore: data.has_more === true,
  };
}

function normalizeItem(item: any, walletAddress: string): Transaction {
  const sender: string = item.sender || item.message_sender || "";
  const receiver: string = item.receiver || "";

  // Parse amount — comes as "10000000 ngonka"
  let amount = "0";
  let denom = "ngonka";
  const amountRaw: string = item.amount || "";
  if (amountRaw) {
    const parts = amountRaw.toString().split(" ");
    amount = parts[0] || "0";
    denom = parts[1] || "ngonka";
  }

  // Determine direction from API's direction field ("in"/"out") or tx_type
  let direction: "sent" | "received" | "self" = "received";
  if (item.direction === "out" || item.tx_type === "sent") {
    direction = "sent";
  } else if (item.direction === "in" || item.tx_type === "received") {
    direction = "received";
  }
  if (sender === walletAddress && receiver === walletAddress) {
    direction = "self";
  }

  return {
    hash: item.hash || "",
    height: String(item.block_height || ""),
    timestamp: item.timestamp || "",
    sender,
    receiver,
    amount,
    amountRaw,
    denom,
    direction,
    txType: item.tx_type || "",
    messageType: item.message_type || "",
    status: item.status || "",
    fee: item.fee || null,
    gasUsed: item.gas_used || 0,
    gasWanted: item.gas_wanted || 0,
    memo: item.memo || "",
    tokenSymbol: item.token_symbol || "GNK",
    isIbc: item.is_ibc === true,
  };
}
