import { useEffect, useState, useCallback } from "react";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { queryValidators, queryDelegations, queryRewards } from "@/lib/cosmos";
import { toMinimal, toDisplay, formatCompact, truncateAddress } from "@/lib/format";
import { GONKA_DISPLAY_DENOM } from "@/lib/gonka";
import Layout from "@/popup/components/Layout";
import StakingCard from "@/popup/components/StakingCard";
import Spinner from "@/popup/components/Spinner";

type Modal = null | "delegate" | "undelegate";

interface ValidatorInfo {
  operatorAddress: string;
  moniker: string;
  tokens: string;
  commission: string;
  delegated: string;
  rewards: string;
}

export default function Staking() {
  const { address, balance, getBalance } = useWalletStore();
  const [validators, setValidators] = useState<ValidatorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalDelegated, setTotalDelegated] = useState("0");
  const [totalRewards, setTotalRewards] = useState("0");
  const [claiming, setClaiming] = useState(false);

  const [modal, setModal] = useState<Modal>(null);
  const [selectedValidator, setSelectedValidator] = useState<ValidatorInfo | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [stakeLoading, setStakeLoading] = useState(false);
  const [stakeError, setStakeError] = useState("");
  const [stakeSuccess, setStakeSuccess] = useState("");

  const loadStakingData = useCallback(async () => {
    if (!address) return;
    setLoading(true);

    try {
      const [vals, delegations, rewardsData] = await Promise.all([
        queryValidators(),
        queryDelegations(address),
        queryRewards(address),
      ]);

      const delegationMap = new Map<string, string>();
      let totalDel = 0n;
      for (const d of delegations) {
        const valAddr = d.delegation?.validator_address || "";
        const amount = d.balance?.amount || "0";
        delegationMap.set(valAddr, amount);
        totalDel += BigInt(amount);
      }

      const rewardMap = new Map<string, string>();
      for (const r of rewardsData.rewards) {
        rewardMap.set(r.validatorAddress, r.amount);
      }

      const validatorInfos: ValidatorInfo[] = vals.map((v: any) => ({
        operatorAddress: v.operator_address,
        moniker: v.description?.moniker || truncateAddress(v.operator_address),
        tokens: v.tokens || "0",
        commission: (
          parseFloat(v.commission?.commission_rates?.rate || "0") * 100
        ).toFixed(1),
        delegated: delegationMap.get(v.operator_address) || "0",
        rewards: rewardMap.get(v.operator_address) || "0",
      }));

      validatorInfos.sort((a, b) => {
        const aDel = BigInt(a.delegated);
        const bDel = BigInt(b.delegated);
        if (aDel > 0n && bDel === 0n) return -1;
        if (bDel > 0n && aDel === 0n) return 1;
        return Number(BigInt(b.tokens) - BigInt(a.tokens));
      });

      setValidators(validatorInfos);
      setTotalDelegated(totalDel.toString());
      setTotalRewards(rewardsData.total);
    } catch (err) {
      console.error("Failed to load staking data:", err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    loadStakingData();
  }, [loadStakingData]);

  const handleClaimRewards = async () => {
    setClaiming(true);
    try {
      const validatorsWithRewards = validators
        .filter((v) => BigInt(v.rewards) > 0n)
        .map((v) => v.operatorAddress);

      if (validatorsWithRewards.length === 0) return;

      const resp = await sendMessage({
        type: "WITHDRAW_REWARDS",
        validators: validatorsWithRewards,
      });

      if (resp.success) {
        await loadStakingData();
        getBalance();
      }
    } catch (err) {
      console.error("Failed to claim rewards:", err);
    } finally {
      setClaiming(false);
    }
  };

  const handleStake = async () => {
    if (!selectedValidator || !stakeAmount) return;
    setStakeLoading(true);
    setStakeError("");
    setStakeSuccess("");

    try {
      const minAmount = toMinimal(stakeAmount);
      const msgType = modal === "delegate" ? "DELEGATE" : "UNDELEGATE";

      const resp = await sendMessage({
        type: msgType,
        validator: selectedValidator.operatorAddress,
        amount: minAmount,
      });

      if (resp.success) {
        setStakeSuccess(`Transaction successful!`);
        await loadStakingData();
        getBalance();
        setTimeout(() => {
          setModal(null);
          setStakeAmount("");
          setStakeSuccess("");
        }, 2000);
      } else {
        setStakeError(resp.error || "Transaction failed");
      }
    } catch (e: any) {
      setStakeError(e.message || "Transaction failed");
    } finally {
      setStakeLoading(false);
    }
  };

  return (
    <Layout title="Staking">
      <div className="px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <StakingCard
              totalDelegated={totalDelegated}
              totalRewards={totalRewards}
              onClaimRewards={handleClaimRewards}
              claiming={claiming}
            />

            <h2 className="text-sm font-semibold text-surface-300">Validators</h2>

            <div className="space-y-2">
              {validators.map((v) => {
                const hasDelegation = BigInt(v.delegated) > 0n;
                return (
                  <div
                    key={v.operatorAddress}
                    className={`card ${hasDelegation ? "!border-gonka-500/10" : ""}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{v.moniker}</p>
                        <p className="text-xs text-surface-500">
                          Commission: {v.commission}%
                        </p>
                      </div>
                      {hasDelegation && (
                        <div className="text-right shrink-0 ml-2">
                          <p className="text-xs text-surface-500">Delegated</p>
                          <p className="text-sm font-bold text-gonka-400 tabular-nums">
                            {formatCompact(v.delegated)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedValidator(v);
                          setModal("delegate");
                          setStakeAmount("");
                          setStakeError("");
                          setStakeSuccess("");
                        }}
                        className="flex-1 py-2 text-xs font-semibold bg-gonka-500/10 hover:bg-gonka-500/15 text-gonka-400 border border-gonka-500/[0.15] hover:border-gonka-500/25 rounded-xl transition-all duration-200 active:scale-[0.97]"
                      >
                        Delegate
                      </button>
                      {hasDelegation && (
                        <button
                          onClick={() => {
                            setSelectedValidator(v);
                            setModal("undelegate");
                            setStakeAmount("");
                            setStakeError("");
                            setStakeSuccess("");
                          }}
                          className="flex-1 py-2 text-xs font-semibold bg-white/[0.04] hover:bg-white/[0.06] text-surface-300 rounded-xl transition-all duration-200 active:scale-[0.97]"
                        >
                          Undelegate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {validators.length === 0 && (
                <div className="text-center py-8 text-surface-600 text-sm">
                  No active validators found
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {modal && selectedValidator && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50 animate-fade-in">
          <div className="w-full bg-surface-900 border-t border-white/[0.06] rounded-t-3xl p-5 space-y-4 animate-slide-up shadow-modal">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">
                {modal === "delegate" ? "Delegate" : "Undelegate"}
              </h3>
              <button
                onClick={() => setModal(null)}
                className="p-1.5 hover:bg-white/5 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-surface-400">
              {modal === "delegate" ? "Delegate to" : "Undelegate from"}{" "}
              <span className="text-surface-200 font-medium">
                {selectedValidator.moniker}
              </span>
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-surface-300">Amount</label>
                <button
                  onClick={() => {
                    if (modal === "delegate") {
                      setStakeAmount(toDisplay(balance));
                    } else {
                      setStakeAmount(toDisplay(selectedValidator.delegated));
                    }
                  }}
                  className="text-xs text-gonka-400 hover:text-gonka-300"
                >
                  Max:{" "}
                  {modal === "delegate"
                    ? formatCompact(balance)
                    : formatCompact(selectedValidator.delegated)}
                </button>
              </div>
              <div className="relative">
                <input
                  type="text"
                  className="input-field pr-14"
                  placeholder="0.00"
                  value={stakeAmount}
                  onChange={(e) => {
                    setStakeAmount(e.target.value.replace(/[^0-9.]/g, ""));
                    setStakeError("");
                  }}
                  autoFocus
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-surface-500 font-medium">
                  {GONKA_DISPLAY_DENOM}
                </span>
              </div>
            </div>

            {stakeError && <p className="text-xs text-red-400">{stakeError}</p>}
            {stakeSuccess && <p className="text-xs text-gonka-400">{stakeSuccess}</p>}

            <button
              onClick={handleStake}
              disabled={stakeLoading || !stakeAmount}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {stakeLoading ? (
                <>
                  <Spinner size="sm" />
                  Processing...
                </>
              ) : modal === "delegate" ? (
                "Delegate"
              ) : (
                "Undelegate"
              )}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
