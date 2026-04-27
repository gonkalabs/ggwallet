import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { fetchTransactions, Transaction } from "@/lib/api";
import { getCache, setCache, cacheKey, isCacheFresh } from "@/lib/cache";
import Layout from "@/popup/components/Layout";
import BalanceCard from "@/popup/components/BalanceCard";
import TxItem from "@/popup/components/TxItem";
import Spinner from "@/popup/components/Spinner";
import WalletSwitcher from "@/popup/components/WalletSwitcher";

export default function Dashboard() {
  const navigate = useNavigate();
  const { address, balance, tokenBalances, getBalance, activeIndex, isViewOnly } = useWalletStore();

  const symbolMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const t of tokenBalances) map[t.denom] = t.symbol;
    return map;
  }, [tokenBalances]);

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [hasCachedTxs, setHasCachedTxs] = useState(false);
  const [hasCachedBal, setHasCachedBal] = useState(false);
  const [refreshingBal, setRefreshingBal] = useState(false);
  const [refreshingTxs, setRefreshingTxs] = useState(false);
  const mountedRef = useRef(true);

  // Load cached data first, then refresh in background only if stale
  const loadData = useCallback(async () => {
    if (!address) return;

    const balKey = cacheKey(address, "balance");
    const txKey = cacheKey(address, "recent_txs");

    // 1. Load from cache instantly
    const [cachedBal, cachedTxs] = await Promise.all([
      getCache<{ balance: string; tokenBalances: typeof tokenBalances } | string>(balKey),
      getCache<Transaction[]>(txKey),
    ]);

    if (cachedBal) {
      const cached = cachedBal.data;
      if (typeof cached === "string") {
        useWalletStore.setState({ balance: cached, tokenBalances: [] });
      } else {
        useWalletStore.setState({
          balance: cached.balance ?? "0",
          tokenBalances: cached.tokenBalances ?? [],
        });
      }
      setHasCachedBal(true);
    }
    if (cachedTxs && cachedTxs.data.length > 0) {
      setTxs(cachedTxs.data);
      setHasCachedTxs(true);
    }

    // 2. Skip background refresh if cache is fresh (< 30s old)
    const balFresh = isCacheFresh(cachedBal);
    const txFresh = isCacheFresh(cachedTxs);

    if (balFresh && txFresh) return;

    // 3. Fetch stale data in background
    if (!balFresh) {
      setRefreshingBal(true);
      getBalance()
        .then(() => {
          if (mountedRef.current) {
            setHasCachedBal(true);
            setRefreshingBal(false);
            const { balance: freshBalance, tokenBalances: freshTokenBalances } =
              useWalletStore.getState();
            setCache(balKey, { balance: freshBalance, tokenBalances: freshTokenBalances });
          }
        })
        .catch(() => {
          if (mountedRef.current) setRefreshingBal(false);
        });
    }

    if (!txFresh) {
      setRefreshingTxs(true);
      fetchTransactions(address, 1, 5)
        .then((data) => {
          if (mountedRef.current) {
            setTxs(data.transactions);
            setHasCachedTxs(true);
            setRefreshingTxs(false);
            setCache(txKey, data.transactions);
          }
        })
        .catch(() => {
          if (mountedRef.current) setRefreshingTxs(false);
        });
    }
  }, [address, getBalance]);

  useEffect(() => {
    mountedRef.current = true;
    // Reset state on wallet switch
    setHasCachedBal(false);
    setHasCachedTxs(false);
    setTxs([]);
    loadData();
    return () => {
      mountedRef.current = false;
    };
  }, [loadData, activeIndex]);

  // Force-refresh balance (bypasses cache freshness check)
  const forceRefreshBalance = useCallback(async () => {
    if (!address || refreshingBal) return;
    const balKey = cacheKey(address, "balance");
    setRefreshingBal(true);
    getBalance()
      .then(() => {
        if (mountedRef.current) {
          setHasCachedBal(true);
          setRefreshingBal(false);
          const { balance: freshBalance, tokenBalances: freshTokenBalances } =
            useWalletStore.getState();
          setCache(balKey, { balance: freshBalance, tokenBalances: freshTokenBalances });
        }
      })
      .catch(() => {
        if (mountedRef.current) setRefreshingBal(false);
      });
  }, [address, getBalance, refreshingBal]);

  // Force-refresh transactions (bypasses cache freshness check)
  const forceRefreshTxs = useCallback(async () => {
    if (!address || refreshingTxs) return;
    const txKey = cacheKey(address, "recent_txs");
    setRefreshingTxs(true);
    fetchTransactions(address, 1, 5)
      .then((data) => {
        if (mountedRef.current) {
          setTxs(data.transactions);
          setHasCachedTxs(true);
          setRefreshingTxs(false);
          setCache(txKey, data.transactions);
        }
      })
      .catch(() => {
        if (mountedRef.current) setRefreshingTxs(false);
      });
  }, [address, refreshingTxs]);

  // Determine loading states: show spinner only if no cached data
  const showBalSkeleton = !hasCachedBal;
  const showTxSkeleton = !hasCachedTxs;

  return (
    <Layout headerContent={<WalletSwitcher />}>
      <div className="px-4 py-4 space-y-5">
        {/* Balance */}
        <BalanceCard
          balance={balance}
          tokenBalances={tokenBalances}
          address={address}
          loading={showBalSkeleton}
          refreshing={refreshingBal}
          onRefresh={forceRefreshBalance}
        />

        {/* Quick actions */}
        {isViewOnly && (
          <div className="led-panel led-text flex items-center gap-2 px-3 py-2 text-[10px] font-bold text-amber-300 animate-fade-in-up" style={{ borderColor: "rgba(251, 191, 36, 0.25)" }}>
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.58-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Watch-only · cannot sign transactions
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 animate-fade-in-up" style={{ animationDelay: "0.05s", animationFillMode: "backwards" }}>
          <ActionButton
            label="Send"
            onClick={() => navigate("/send")}
            disabled={isViewOnly}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
              </svg>
            }
          />
          <ActionButton
            label="Receive"
            onClick={() => navigate("/receive")}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
              </svg>
            }
          />
          <ActionButton
            label="Names"
            onClick={() => navigate("/names")}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
            }
          />
          <ActionButton
            label="Govern"
            onClick={() => navigate("/proposals")}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
              </svg>
            }
          />
        </div>

        {/* Recent transactions */}
        <div className="animate-fade-in-up" style={{ animationDelay: "0.1s", animationFillMode: "backwards" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="led-eyebrow">
                <span className="led-eyebrow-dot" />
                Recent Activity
              </h2>
              {refreshingTxs && hasCachedTxs ? (
                <Spinner size="sm" className="!w-3 !h-3 !text-white/40" />
              ) : hasCachedTxs ? (
                <button
                  onClick={forceRefreshTxs}
                  className="p-0.5 text-white/40 hover:text-white transition-colors rounded-md hover:bg-white/[0.06] active:scale-90"
                  title="Refresh transactions"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                  </svg>
                </button>
              ) : null}
            </div>
            <button
              onClick={() => navigate("/transactions")}
              className="led-text text-[10px] font-bold text-white/55 hover:text-white transition-colors"
            >
              View all →
            </button>
          </div>

          <div className="card !p-2">
            {showTxSkeleton ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" />
              </div>
            ) : txs.length === 0 ? (
              <div className="led-text text-center py-8 text-white/35 text-[11px] font-medium">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-0.5">
                {txs.map((tx) => (
                  <TxItem key={tx.hash} tx={tx} symbolMap={symbolMap} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ActionButton({
  label,
  onClick,
  icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="led-panel group flex flex-col items-center gap-1.5 py-3.5 transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed hover:!border-white/30"
    >
      <div className="text-white/80 group-hover:text-white transition-colors">{icon}</div>
      <span className="led-text text-[10px] font-bold text-white/65 group-hover:text-white transition-colors">
        {label}
      </span>
    </button>
  );
}
