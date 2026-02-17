import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { fetchTransactions, Transaction } from "@/lib/api";
import { getCache, setCache, cacheKey } from "@/lib/cache";
import Layout from "@/popup/components/Layout";
import BalanceCard from "@/popup/components/BalanceCard";
import TxItem from "@/popup/components/TxItem";
import Spinner from "@/popup/components/Spinner";
import WalletSwitcher from "@/popup/components/WalletSwitcher";

export default function Dashboard() {
  const navigate = useNavigate();
  const { address, balance, getBalance, activeIndex } = useWalletStore();

  const [txs, setTxs] = useState<Transaction[]>([]);
  const [hasCachedTxs, setHasCachedTxs] = useState(false);
  const [hasCachedBal, setHasCachedBal] = useState(false);
  const [refreshingBal, setRefreshingBal] = useState(false);
  const [refreshingTxs, setRefreshingTxs] = useState(false);
  const mountedRef = useRef(true);

  // Load cached data first, then refresh in background
  const loadData = useCallback(async () => {
    if (!address) return;

    const balKey = cacheKey(address, "balance");
    const txKey = cacheKey(address, "recent_txs");

    // 1. Load from cache instantly
    const [cachedBal, cachedTxs] = await Promise.all([
      getCache<string>(balKey),
      getCache<Transaction[]>(txKey),
    ]);

    if (cachedBal) {
      useWalletStore.setState({ balance: cachedBal.data });
      setHasCachedBal(true);
    }
    if (cachedTxs && cachedTxs.data.length > 0) {
      setTxs(cachedTxs.data);
      setHasCachedTxs(true);
    }

    // 2. Fetch fresh data in background
    setRefreshingBal(true);
    setRefreshingTxs(true);

    // Balance
    getBalance()
      .then(() => {
        if (mountedRef.current) {
          setHasCachedBal(true);
          setRefreshingBal(false);
          // Cache the fresh balance
          const freshBalance = useWalletStore.getState().balance;
          setCache(balKey, freshBalance);
        }
      })
      .catch(() => {
        if (mountedRef.current) setRefreshingBal(false);
      });

    // Transactions
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

  // Determine loading states: show spinner only if no cached data
  const showBalSkeleton = !hasCachedBal;
  const showTxSkeleton = !hasCachedTxs;

  return (
    <Layout headerContent={<WalletSwitcher />}>
      <div className="px-4 py-4 space-y-5">
        {/* Balance */}
        <BalanceCard
          balance={balance}
          address={address}
          loading={showBalSkeleton}
          refreshing={refreshingBal}
        />

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2 animate-fade-in-up" style={{ animationDelay: "0.05s", animationFillMode: "backwards" }}>
          <ActionButton
            label="Send"
            onClick={() => navigate("/send")}
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
        </div>

        {/* Recent transactions */}
        <div className="animate-fade-in-up" style={{ animationDelay: "0.1s", animationFillMode: "backwards" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-surface-300">
                Recent Activity
              </h2>
              {refreshingTxs && hasCachedTxs && (
                <Spinner size="sm" className="!w-3 !h-3 !text-surface-600" />
              )}
            </div>
            <button
              onClick={() => navigate("/transactions")}
              className="text-xs text-gonka-400 hover:text-gonka-300 transition-colors"
            >
              View all
            </button>
          </div>

          <div className="card !p-2">
            {showTxSkeleton ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" />
              </div>
            ) : txs.length === 0 ? (
              <div className="text-center py-8 text-surface-600 text-sm">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-0.5">
                {txs.map((tx) => (
                  <TxItem key={tx.hash} tx={tx} />
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
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3.5 bg-white/[0.03] hover:bg-gonka-500/[0.08] border border-transparent hover:border-gonka-500/[0.15] rounded-2xl transition-all duration-200 active:scale-[0.97]"
    >
      <div className="text-gonka-400">{icon}</div>
      <span className="text-xs font-medium text-surface-300">{label}</span>
    </button>
  );
}
