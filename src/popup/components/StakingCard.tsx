import { formatCompact } from "@/lib/format";

interface StakingCardProps {
  totalDelegated: string;
  totalRewards: string;
  onClaimRewards?: () => void;
  claiming?: boolean;
}

export default function StakingCard({
  totalDelegated,
  totalRewards,
  onClaimRewards,
  claiming,
}: StakingCardProps) {
  const hasRewards = BigInt(totalRewards || "0") > 0n;

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-surface-500 mb-0.5">Total Staked</p>
          <p className="text-lg font-bold tracking-tight">{formatCompact(totalDelegated)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-surface-500 mb-0.5">Rewards</p>
          <p className="text-lg font-bold tracking-tight text-gonka-400">
            {formatCompact(totalRewards)}
          </p>
        </div>
      </div>

      {hasRewards && onClaimRewards && (
        <button
          onClick={onClaimRewards}
          disabled={claiming}
          className="w-full py-2.5 text-sm font-semibold bg-gonka-500/10 hover:bg-gonka-500/15 text-gonka-400 border border-gonka-500/[0.15] hover:border-gonka-500/25 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-40"
        >
          {claiming ? "Claiming..." : "Claim All Rewards"}
        </button>
      )}
    </div>
  );
}
