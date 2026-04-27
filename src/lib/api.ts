import { GONKA_EXPLORER_URL, GONKA_EXPLORER_API_KEY } from "./gonka";
import { GONKA_RPC_BASE_URL, getGonkaRpcApiKey } from "./rpc";

/**
 * Transaction history API.
 *
 * Two backends, chosen at runtime based on whether a rpc.gonka.gg API
 * key is configured:
 *
 *   - rpc.gonka.gg ClickHouse index (`/api/ch/address/{addr}`) when the
 *     key is set — ~100x faster than the explorer.
 *   - gonka.gg explorer (`/api/public/wallets/{addr}/transactions`)
 *     otherwise.
 *
 * Both are normalized to the same Transaction shape below.
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
 * Fetch transactions for a wallet address. Automatically routes to the
 * rpc.gonka.gg ClickHouse index when the API key is configured, otherwise
 * falls back to the gonka.gg explorer.
 */
export async function fetchTransactions(
  address: string,
  page = 1,
  pageSize = 20,
  direction: "all" | "sent" | "received" = "all"
): Promise<TransactionsResponse> {
  const gonkaKey = await getGonkaRpcApiKey();
  if (gonkaKey) {
    return fetchTransactionsViaGonkaRpc(address, gonkaKey, page, pageSize, direction);
  }
  return fetchTransactionsViaExplorer(address, page, pageSize, direction);
}

async function fetchTransactionsViaExplorer(
  address: string,
  page: number,
  pageSize: number,
  direction: "all" | "sent" | "received"
): Promise<TransactionsResponse> {
  const url = new URL(
    `/api/public/wallets/${address}/transactions`,
    GONKA_EXPLORER_URL
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
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

/**
 * Fetch tx history from rpc.gonka.gg's ClickHouse index.
 *
 * The /api/ch/address endpoint doesn't support server-side direction
 * filtering, so we fetch unfiltered and apply the filter client-side.
 */
async function fetchTransactionsViaGonkaRpc(
  address: string,
  apiKey: string,
  page: number,
  pageSize: number,
  direction: "all" | "sent" | "received"
): Promise<TransactionsResponse> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const url =
    `${GONKA_RPC_BASE_URL}/key/${encodeURIComponent(apiKey)}` +
    `/api/ch/address/${address}?limit=${pageSize}&offset=${offset}`;

  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`rpc.gonka.gg error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const rawTxs: any[] = Array.isArray(data.txs) ? data.txs : [];

  let transactions = rawTxs.map((tx) => normalizeChTx(tx, address));
  if (direction !== "all") {
    transactions = transactions.filter((t) => t.direction === direction);
  }

  return {
    transactions,
    total: typeof data.count === "number" ? data.count : transactions.length,
    page,
    pageSize,
    hasMore: data.has_more === true,
  };
}

/**
 * Extract the first Cosmos `/x.y.MsgFoo` action from the ch events blob
 * and return the trailing `MsgFoo` segment. Returns "" when unparseable.
 */
function extractMessageType(eventsStr: unknown): string {
  if (typeof eventsStr !== "string" || !eventsStr) return "";
  try {
    const events = JSON.parse(eventsStr);
    if (!Array.isArray(events)) return "";
    for (const ev of events) {
      if (ev?.type !== "message") continue;
      for (const attr of ev.attributes || []) {
        if (attr?.key === "action" && typeof attr.value === "string") {
          const parts = attr.value.split(".");
          return parts[parts.length - 1] || "";
        }
      }
    }
  } catch {
    // malformed JSON — fall through
  }
  return "";
}

/** Split "9ngonka" or "10000000 ngonka" into amount + denom. */
function splitAmountDenom(raw: string): { amount: string; denom: string } {
  if (!raw) return { amount: "0", denom: "ngonka" };
  const spaceIdx = raw.indexOf(" ");
  if (spaceIdx > 0) {
    return { amount: raw.slice(0, spaceIdx), denom: raw.slice(spaceIdx + 1) };
  }
  const m = raw.match(/^(\d+)(.*)$/);
  if (m) {
    return { amount: m[1] || "0", denom: (m[2] || "ngonka").trim() || "ngonka" };
  }
  return { amount: "0", denom: raw };
}

function normalizeChTx(tx: any, walletAddress: string): Transaction {
  const sender: string = tx.sender || "";
  const receiver: string = tx.recipient || "";
  const { amount, denom } = splitAmountDenom(String(tx.amount ?? ""));
  const messageType = extractMessageType(tx.events);

  let direction: "sent" | "received" | "self" = "received";
  if (sender === walletAddress && receiver === walletAddress) {
    direction = "self";
  } else if (sender === walletAddress) {
    direction = "sent";
  } else if (receiver === walletAddress) {
    direction = "received";
  } else if (sender && !receiver) {
    direction = "sent";
  }

  return {
    hash: String(tx.tx_hash || ""),
    height: String(tx.block_height || ""),
    // "2026-04-27 19:35:53.000" → ISO so formatTimestamp parses cleanly.
    timestamp: toIsoTimestamp(tx.block_time),
    sender,
    receiver,
    amount,
    amountRaw: String(tx.amount ?? ""),
    denom,
    direction,
    txType: String(tx.tx_type || ""),
    messageType,
    status: tx.success === false ? "failed" : "success",
    fee: tx.fee ? String(tx.fee) : null,
    gasUsed: Number(tx.gas_used || 0),
    gasWanted: Number(tx.gas_wanted || 0),
    memo: String(tx.memo || ""),
    tokenSymbol: denom.startsWith("ibc/") ? `IBC-${denom.slice(4, 8)}` : "GNK",
    isIbc: denom.startsWith("ibc/"),
  };
}

function toIsoTimestamp(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  // Accept "YYYY-MM-DD HH:MM:SS.sss" (UTC) and normalize to ISO.
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}

function normalizeItem(item: any, walletAddress: string): Transaction {
  const sender: string = item.sender || item.message_sender || "";
  const receiver: string = item.receiver || "";

  // Parse amount — comes as "10000000 ngonka" or "5000000 ibc/HASH..."
  let amount = "0";
  let denom = "ngonka";
  const amountRaw: string = item.amount || "";
  if (amountRaw) {
    const spaceIdx = amountRaw.toString().indexOf(" ");
    if (spaceIdx > 0) {
      amount = amountRaw.slice(0, spaceIdx);
      denom = amountRaw.slice(spaceIdx + 1);
    } else {
      amount = amountRaw.toString();
    }
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
    // Derive symbol from denom — API's token_symbol is unreliable for IBC tokens
    tokenSymbol: denom.startsWith("ibc/") ? `IBC-${denom.slice(4, 8)}` : (item.token_symbol || "GNK"),
    isIbc: denom.startsWith("ibc/") || item.is_ibc === true,
  };
}
