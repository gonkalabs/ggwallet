import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useWalletStore } from "@/popup/store";
import { fetchTransactions, Transaction } from "@/lib/api";
import { getCache, setCache, cacheKey } from "@/lib/cache";
import Layout from "@/popup/components/Layout";
import TxItem from "@/popup/components/TxItem";
import Spinner from "@/popup/components/Spinner";

type Filter = "all" | "sent" | "received";

export default function Transactions() {
  const { address, tokenBalances } = useWalletStore();

  const symbolMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const t of tokenBalances) {
      map[t.denom] = t.symbol;
    }
    return map;
  }, [tokenBalances]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [hasCached, setHasCached] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [total, setTotal] = useState(0);
  const mountedRef = useRef(true);

  const PAGE_SIZE = 20;

  // Load cached, then fetch fresh
  const loadInitial = useCallback(async () => {
    if (!address) return;

    const key = cacheKey(address, `txs_${filter}`);

    // 1. Load cache
    const cached = await getCache<{ txs: Transaction[]; total: number; hasMore: boolean }>(key);
    if (cached && cached.data.txs.length > 0) {
      setTxs(cached.data.txs);
      setTotal(cached.data.total);
      setHasMore(cached.data.hasMore);
      setHasCached(true);
    }

    // 2. Fetch fresh in background
    setRefreshing(true);

    try {
      const data = await fetchTransactions(address, 1, PAGE_SIZE, filter);
      if (mountedRef.current) {
        setTxs(data.transactions);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setHasCached(true);
        setPage(1);
        // Cache the result
        setCache(key, {
          txs: data.transactions,
          total: data.total,
          hasMore: data.hasMore,
        });
      }
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [address, filter]);

  useEffect(() => {
    mountedRef.current = true;
    setHasCached(false);
    setTxs([]);
    setTotal(0);
    loadInitial();
    return () => {
      mountedRef.current = false;
    };
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!address || loadingMore || !hasMore) return;
    setLoadingMore(true);

    try {
      const nextPage = page + 1;
      const data = await fetchTransactions(address, nextPage, PAGE_SIZE, filter);
      if (mountedRef.current) {
        setTxs((prev) => [...prev, ...data.transactions]);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(nextPage);
      }
    } catch (err) {
      console.error("Failed to load more transactions:", err);
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "sent", label: "Sent" },
    { key: "received", label: "Received" },
  ];

  const showSkeleton = !hasCached;

  return (
    <Layout title="Activity">
      <div className="px-4 py-3 space-y-3">
        {/* Filters */}
        <div className="flex gap-2">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setFilter(key);
                setPage(1);
              }}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                filter === key
                  ? "bg-gonka-500/15 text-gonka-400 border border-gonka-500/25"
                  : "bg-white/[0.04] text-surface-400 hover:bg-white/[0.06] border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5 self-center">
            {refreshing && hasCached && (
              <Spinner size="sm" className="!w-3 !h-3 !text-surface-600" />
            )}
            {total > 0 && (
              <span className="text-xs text-surface-600 tabular-nums">
                {total} total
              </span>
            )}
          </div>
        </div>

        {/* Transaction list */}
        {showSkeleton ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : txs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-white/[0.04] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
            </div>
            <p className="text-sm text-surface-600">No transactions found</p>
          </div>
        ) : (
          <>
            <div className="card !p-2">
              <div className="space-y-0.5">
                {txs.map((tx, i) => (
                  <TxItem key={`${tx.hash}-${i}`} tx={tx} symbolMap={symbolMap} />
                ))}
              </div>
            </div>

            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-2.5 text-sm text-gonka-400 hover:text-gonka-300 transition-colors flex items-center justify-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <Spinner size="sm" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
