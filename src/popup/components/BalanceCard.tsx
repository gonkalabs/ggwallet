import { useState } from "react";
import { toDisplay } from "@/lib/format";
import { GONKA_DISPLAY_DENOM } from "@/lib/gonka";
import Spinner from "@/popup/components/Spinner";

interface BalanceCardProps {
  balance: string;
  address: string;
  loading?: boolean;
  /** Show a subtle refresh indicator while fetching fresh data in background */
  refreshing?: boolean;
}

export default function BalanceCard({ balance, address, loading, refreshing }: BalanceCardProps) {
  const displayAmount = toDisplay(balance);
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl p-5 bg-gradient-to-br from-gonka-950 via-surface-900 to-surface-950 border border-gonka-500/[0.15] animate-fade-in-up">
      {/* Glow effect */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-gonka-500/[0.08] rounded-full blur-3xl animate-pulse-soft" />
      <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-gonka-400/[0.05] rounded-full blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-surface-400 font-medium tracking-wide uppercase">
            Total Balance
          </span>
          {refreshing && !loading && (
            <Spinner size="sm" className="!w-3 !h-3 !text-surface-600" />
          )}
        </div>

        <div className="flex items-baseline gap-2 mb-4">
          {loading ? (
            <div className="h-9 w-36 bg-white/5 rounded-xl animate-pulse" />
          ) : (
            <>
              <span className="text-3xl font-extrabold tracking-tight">
                {displayAmount}
              </span>
              <span className="text-sm font-semibold text-gonka-400">
                {GONKA_DISPLAY_DENOM}
              </span>
            </>
          )}
        </div>

        <button
          onClick={handleCopyAddress}
          className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-300 transition-all duration-200 group"
          title="Copy address"
        >
          <span className="font-mono truncate max-w-[240px]">{address}</span>
          {copied ? (
            <svg className="w-3.5 h-3.5 text-gonka-400 shrink-0 transition-transform duration-200 scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
