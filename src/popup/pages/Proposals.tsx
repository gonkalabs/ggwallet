import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { sendMessage } from "@/lib/messaging";
import { formatCompact } from "@/lib/format";
import type { Proposal } from "@/lib/cosmos";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

const STATUS_LABELS: Record<string, string> = {
  PROPOSAL_STATUS_DEPOSIT_PERIOD: "Deposit",
  PROPOSAL_STATUS_VOTING_PERIOD: "Voting",
  PROPOSAL_STATUS_PASSED: "Passed",
  PROPOSAL_STATUS_REJECTED: "Rejected",
  PROPOSAL_STATUS_FAILED: "Failed",
};

const STATUS_COLORS: Record<string, string> = {
  PROPOSAL_STATUS_DEPOSIT_PERIOD: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  PROPOSAL_STATUS_VOTING_PERIOD: "bg-gonka-500/15 text-gonka-400 border-gonka-500/20",
  PROPOSAL_STATUS_PASSED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  PROPOSAL_STATUS_REJECTED: "bg-red-500/15 text-red-400 border-red-500/20",
  PROPOSAL_STATUS_FAILED: "bg-red-500/15 text-red-400 border-red-500/20",
};

function timeLeft(endTime: string): string {
  if (!endTime) return "";
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400_000);
  const hours = Math.floor((diff % 86400_000) / 3600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export default function Proposals() {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await sendMessage({ type: "GET_PROPOSALS" });
      if (resp.success) {
        setProposals(resp.proposals);
      } else {
        setError(resp.error || "Failed to load proposals");
      }
    } catch (e: any) {
      setError(e.message || "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isVoting = (p: Proposal) => p.status === "PROPOSAL_STATUS_VOTING_PERIOD";

  return (
    <Layout title="Governance" showBack>
      <div className="px-4 py-3 space-y-3">
        <button
          onClick={() => navigate("/proposals/create")}
          className="w-full py-2.5 text-sm font-semibold bg-gonka-500/10 hover:bg-gonka-500/15 text-gonka-400 border border-gonka-500/[0.15] hover:border-gonka-500/25 rounded-xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Proposal
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={load} className="text-xs text-gonka-400 hover:text-gonka-300">
              Try again
            </button>
          </div>
        ) : proposals.length === 0 ? (
          <div className="text-center py-16 text-surface-600 text-sm">
            No proposals found
          </div>
        ) : (
          <div className="space-y-2">
            {proposals.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/proposals/${p.id}`)}
                className="card w-full text-left hover:border-white/[0.08] active:scale-[0.99] transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono text-surface-500">#{p.id}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${STATUS_COLORS[p.status] || "bg-surface-800 text-surface-400 border-white/5"}`}>
                        {STATUS_LABELS[p.status] || p.status.replace("PROPOSAL_STATUS_", "")}
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-snug line-clamp-2">{p.title}</p>
                  </div>
                  <svg className="w-4 h-4 text-surface-600 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>

                {isVoting(p) && (
                  <div className="mb-2">
                    <TallyBar tally={p.finalTallyResult} />
                  </div>
                )}

                <div className="flex items-center justify-between text-[11px] text-surface-500">
                  <span>Deposit: {formatCompact(p.totalDeposit)}</span>
                  {isVoting(p) ? (
                    <span className="text-gonka-400">{timeLeft(p.votingEndTime)}</span>
                  ) : p.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD" ? (
                    <span className="text-amber-400">{timeLeft(p.depositEndTime)}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function TallyBar({ tally }: { tally: Proposal["finalTallyResult"] }) {
  const yes = Number(tally.yes);
  const no = Number(tally.no);
  const abstain = Number(tally.abstain);
  const veto = Number(tally.noWithVeto);
  const total = yes + no + abstain + veto;

  if (total === 0) {
    return (
      <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
        <div className="h-full w-0" />
      </div>
    );
  }

  const yesP = (yes / total) * 100;
  const noP = (no / total) * 100;
  const vetoP = (veto / total) * 100;

  return (
    <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden flex">
      {yesP > 0 && <div className="h-full bg-emerald-400" style={{ width: `${yesP}%` }} />}
      {noP > 0 && <div className="h-full bg-red-400" style={{ width: `${noP}%` }} />}
      {vetoP > 0 && <div className="h-full bg-orange-400" style={{ width: `${vetoP}%` }} />}
    </div>
  );
}
