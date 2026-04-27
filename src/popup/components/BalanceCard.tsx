import { useState, useMemo, useEffect } from "react";
import { toDisplay, toDisplayDecimals } from "@/lib/format";
import { GONKA_DISPLAY_DENOM } from "@/lib/gonka";
import { reverseResolve } from "@/lib/gns";
import type { TokenBalance } from "@/lib/cosmos";
import Spinner from "@/popup/components/Spinner";

interface BalanceCardProps {
  balance: string;
  tokenBalances: TokenBalance[];
  address: string;
  loading?: boolean;
  /** Show a subtle refresh indicator while fetching fresh data in background */
  refreshing?: boolean;
  /** Force-refresh callback */
  onRefresh?: () => void;
}

export default function BalanceCard({
  balance,
  tokenBalances,
  address,
  loading,
  refreshing,
  onRefresh,
}: BalanceCardProps) {
  const displayAmount = toDisplay(balance);
  const balanceSizeClass = useMemo(() => {
    const len = displayAmount.length;
    if (len > 18) return "text-lg";
    if (len > 14) return "text-xl";
    if (len > 10) return "text-2xl";
    return "text-3xl";
  }, [displayAmount]);
  const [copied, setCopied] = useState(false);

  const ibcTokens = tokenBalances.filter((t) => t.isIbc);

  const [gnsName, setGnsName] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    setGnsName(null);
    reverseResolve(address).then((name) => setGnsName(name));
  }, [address]);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="led-bezel animate-fade-in-up">
      <div className="led-display p-5">
        {/* Eyebrow + refresh control */}
        <div className="flex items-center justify-between mb-3">
          <span className="led-eyebrow">
            <span className="led-eyebrow-dot" />
            Total Balance
          </span>
          {refreshing && !loading ? (
            <Spinner size="sm" className="!w-3 !h-3 !text-white/40" />
          ) : onRefresh ? (
            <button
              onClick={onRefresh}
              className="p-1 text-white/40 hover:text-white transition-colors rounded-md hover:bg-white/[0.06] active:scale-90"
              title="Refresh balance"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
            </button>
          ) : null}
        </div>

        {/* GNK balance — primary readout, glowing LED numerals */}
        <div className="flex items-baseline gap-2 mb-3">
          {loading ? (
            <div className="h-9 w-36 bg-white/5 rounded-xl animate-pulse" />
          ) : (
            <>
              <span
                className={`led-text ${balanceSizeClass} font-extrabold text-white led-glow tabular-nums`}
              >
                {displayAmount}
              </span>
              <span className="led-text text-[11px] font-bold text-white/55">
                {GONKA_DISPLAY_DENOM}
              </span>
            </>
          )}
        </div>

        {/* IBC token balances — uppercase mono "spec" pills */}
        {!loading && ibcTokens.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3">
            {ibcTokens.map((t) => (
              <span key={t.denom} className="led-spec" title={t.denom}>
                <span className="text-white/85">
                  {toDisplayDecimals(t.amount, t.decimals)}
                </span>
                <span className="text-white/45">{t.symbol}</span>
              </span>
            ))}
          </div>
        )}
        {loading && (
          <div className="h-6 w-24 bg-white/5 rounded-xl animate-pulse mb-3" />
        )}

        {gnsName && (
          <div className="mb-1.5">
            <span className="led-text text-[12px] font-bold text-white led-glow-soft">
              {gnsName}
            </span>
          </div>
        )}

        {/* Address — uppercase mono, dashed divider above */}
        <div className="led-divider-top pt-3 mt-3">
          <button
            onClick={handleCopyAddress}
            className="flex items-center gap-2 text-[10px] font-bold text-white/45 hover:text-white/80 transition-all duration-200 group"
            title="Copy address"
            style={{ letterSpacing: "0.06em" }}
          >
            <span className="font-mono uppercase truncate max-w-[240px]">
              {address}
            </span>
            {copied ? (
              <svg
                className="w-3.5 h-3.5 text-white shrink-0 transition-transform duration-200 scale-110"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
