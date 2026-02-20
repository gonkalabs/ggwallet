import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import { formatCompact, formatTimestamp, truncateAddress } from "@/lib/format";
import { GONKA_EXPLORER_URL } from "@/lib/gonka";
import type { Proposal, VoteOption } from "@/lib/cosmos";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

const STATUS_LABELS: Record<string, string> = {
  PROPOSAL_STATUS_DEPOSIT_PERIOD: "Deposit Period",
  PROPOSAL_STATUS_VOTING_PERIOD: "Voting Period",
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

const VOTE_OPTIONS: { option: VoteOption; label: string; color: string; activeColor: string }[] = [
  { option: "VOTE_OPTION_YES", label: "Yes", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/15 hover:bg-emerald-500/15", activeColor: "!bg-emerald-500/25 !border-emerald-500/40 ring-1 ring-emerald-500/30" },
  { option: "VOTE_OPTION_NO", label: "No", color: "bg-red-500/10 text-red-400 border-red-500/15 hover:bg-red-500/15", activeColor: "!bg-red-500/25 !border-red-500/40 ring-1 ring-red-500/30" },
  { option: "VOTE_OPTION_ABSTAIN", label: "Abstain", color: "bg-surface-700/50 text-surface-300 border-white/[0.06] hover:bg-surface-700", activeColor: "!bg-surface-700 !border-white/[0.12] ring-1 ring-white/10" },
  { option: "VOTE_OPTION_NO_WITH_VETO", label: "Veto", color: "bg-orange-500/10 text-orange-400 border-orange-500/15 hover:bg-orange-500/15", activeColor: "!bg-orange-500/25 !border-orange-500/40 ring-1 ring-orange-500/30" },
];

const VOTE_LABELS: Record<string, string> = {
  VOTE_OPTION_YES: "Yes",
  VOTE_OPTION_NO: "No",
  VOTE_OPTION_ABSTAIN: "Abstain",
  VOTE_OPTION_NO_WITH_VETO: "No With Veto",
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

export default function ProposalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isViewOnly } = useWalletStore();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tally, setTally] = useState<Proposal["finalTallyResult"] | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [quorum, setQuorum] = useState<number | null>(null);
  const [bondedTokens, setBondedTokens] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedVote, setSelectedVote] = useState<VoteOption | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState("");
  const [voteSuccess, setVoteSuccess] = useState("");
  const [voteTxHash, setVoteTxHash] = useState("");

  const [showDesc, setShowDesc] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");

    try {
      const [proposalResp, tallyResp, voteResp, govResp] = await Promise.all([
        sendMessage({ type: "GET_PROPOSAL", proposalId: id }),
        sendMessage({ type: "GET_PROPOSAL_TALLY", proposalId: id }),
        sendMessage({ type: "GET_VOTE", proposalId: id }),
        sendMessage({ type: "GET_GOV_PARAMS" }),
      ]);

      if (proposalResp.success) setProposal(proposalResp.proposal);
      else setError(proposalResp.error || "Failed to load proposal");

      if (tallyResp.success) setTally(tallyResp.tally);
      if (voteResp.success && voteResp.vote) setMyVote(voteResp.vote);
      if (govResp.success) {
        setQuorum(parseFloat(govResp.params.quorum));
        setBondedTokens(govResp.bondedTokens);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load proposal");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleVote = async () => {
    if (!selectedVote || !id) return;
    setVoting(true);
    setVoteError("");
    setVoteSuccess("");

    try {
      const resp = await sendMessage({ type: "VOTE_PROPOSAL", proposalId: id, option: selectedVote });
      if (resp.success) {
        setVoteSuccess("Vote submitted!");
        setVoteTxHash(resp.txHash || "");
        setMyVote(selectedVote);
        setSelectedVote(null);
        const tallyResp = await sendMessage({ type: "GET_PROPOSAL_TALLY", proposalId: id });
        if (tallyResp.success) setTally(tallyResp.tally);
      } else {
        setVoteError(resp.error || "Vote failed");
      }
    } catch (e: any) {
      setVoteError(e.message || "Vote failed");
    } finally {
      setVoting(false);
    }
  };

  const isVotingPeriod = proposal?.status === "PROPOSAL_STATUS_VOTING_PERIOD";
  const canVote = isVotingPeriod && !isViewOnly;

  if (loading) {
    return (
      <Layout title={`Proposal #${id}`} showBack>
        <div className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      </Layout>
    );
  }

  if (error || !proposal) {
    return (
      <Layout title="Proposal" showBack>
        <div className="text-center py-16 space-y-3">
          <p className="text-sm text-red-400">{error || "Proposal not found"}</p>
          <button onClick={() => navigate(-1)} className="text-xs text-gonka-400">
            Go back
          </button>
        </div>
      </Layout>
    );
  }

  const t = tally || proposal.finalTallyResult;
  const yes = Number(t.yes);
  const no = Number(t.no);
  const abstain = Number(t.abstain);
  const veto = Number(t.noWithVeto);
  const total = yes + no + abstain + veto;

  return (
    <Layout title={`#${proposal.id}`} showBack>
      <div className="px-4 py-3 space-y-3">
        {/* Status badge + title */}
        <div>
          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md border mb-2 ${STATUS_COLORS[proposal.status] || "bg-surface-800 text-surface-400 border-white/5"}`}>
            {STATUS_LABELS[proposal.status] || proposal.status}
          </span>
          <h2 className="text-base font-bold leading-snug">{proposal.title}</h2>
        </div>

        {/* Description / Body */}
        {(proposal.description || proposal.summary) && (
          <div className="card !p-3 space-y-2">
            <h3 className="text-xs font-semibold text-surface-300">Description</h3>
            <div className={`text-xs text-surface-400 leading-relaxed whitespace-pre-wrap break-words ${!showDesc ? "max-h-[120px] overflow-hidden relative" : ""}`}>
              <RichText text={proposal.description || proposal.summary} />
              {!showDesc && (proposal.description || proposal.summary).length > 200 && (
                <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-surface-900/90 to-transparent" />
              )}
            </div>
            {(proposal.description || proposal.summary).length > 200 && (
              <button
                onClick={() => setShowDesc(!showDesc)}
                className="text-[11px] text-gonka-400 hover:text-gonka-300"
              >
                {showDesc ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {/* Links */}
        <div className="card !p-3 space-y-2">
          <h3 className="text-xs font-semibold text-surface-300">Links</h3>
          <ExplorerLink href={`${GONKA_EXPLORER_URL}/proposals/${proposal.id}`} label="View on Explorer" />
          {extractLinks(proposal).map((link, i) => (
            <ExplorerLink key={i} href={link.url} label={link.label} />
          ))}
        </div>

        {/* Info */}
        <div className="card !p-3 space-y-2">
          <InfoRow label="Deposit" value={formatCompact(proposal.totalDeposit)} />
          {proposal.proposer && <InfoRow label="Proposer" value={truncateAddress(proposal.proposer)} />}
          {proposal.submitTime && <InfoRow label="Submitted" value={formatTimestamp(proposal.submitTime)} />}
          {isVotingPeriod && proposal.votingEndTime && (
            <InfoRow label="Voting ends" value={timeLeft(proposal.votingEndTime)} highlight />
          )}
          {proposal.status === "PROPOSAL_STATUS_DEPOSIT_PERIOD" && proposal.depositEndTime && (
            <InfoRow label="Deposit ends" value={timeLeft(proposal.depositEndTime)} highlight />
          )}
        </div>

        {/* Tally */}
        <div className="card !p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-surface-300">Tally</h3>
            {quorum !== null && bondedTokens && (
              <QuorumBadge totalVoted={total} bondedTokens={bondedTokens} quorum={quorum} />
            )}
          </div>

          {quorum !== null && bondedTokens && Number(bondedTokens) > 0 && (
            <QuorumBar totalVoted={total} bondedTokens={bondedTokens} quorum={quorum} />
          )}

          <div className="h-2 rounded-full bg-surface-800 overflow-hidden flex">
            {total > 0 && (
              <>
                {yes > 0 && <div className="h-full bg-emerald-400 transition-all" style={{ width: `${(yes / total) * 100}%` }} />}
                {no > 0 && <div className="h-full bg-red-400 transition-all" style={{ width: `${(no / total) * 100}%` }} />}
                {veto > 0 && <div className="h-full bg-orange-400 transition-all" style={{ width: `${(veto / total) * 100}%` }} />}
                {abstain > 0 && <div className="h-full bg-surface-600 transition-all" style={{ width: `${(abstain / total) * 100}%` }} />}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TallyItem label="Yes" value={t.yes} total={total} color="text-emerald-400" />
            <TallyItem label="No" value={t.no} total={total} color="text-red-400" />
            <TallyItem label="Abstain" value={t.abstain} total={total} color="text-surface-400" />
            <TallyItem label="No w/ Veto" value={t.noWithVeto} total={total} color="text-orange-400" />
          </div>
        </div>

        {/* My vote */}
        {myVote && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gonka-500/10 border border-gonka-500/15">
            <svg className="w-3.5 h-3.5 text-gonka-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span className="text-xs text-gonka-400">
              You voted <span className="font-semibold">{VOTE_LABELS[myVote] || myVote}</span>
            </span>
          </div>
        )}

        {/* Vote buttons */}
        {canVote && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-surface-300">Cast Your Vote</h3>
            <div className="grid grid-cols-2 gap-2">
              {VOTE_OPTIONS.map((v) => (
                <button
                  key={v.option}
                  onClick={() => {
                    setSelectedVote(selectedVote === v.option ? null : v.option);
                    setVoteError("");
                    setVoteSuccess("");
                  }}
                  className={`py-2.5 text-xs font-semibold border rounded-xl transition-all duration-200 active:scale-[0.97] ${v.color} ${selectedVote === v.option ? v.activeColor : ""}`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {voteError && <p className="text-xs text-red-400">{voteError}</p>}
            {voteSuccess && (
              <div className="card !p-3 space-y-1.5">
                <p className="text-xs text-gonka-400">{voteSuccess}</p>
                {voteTxHash && (
                  <div>
                    <p className="text-[10px] text-surface-500">Tx Hash</p>
                    <p className="text-[10px] font-mono text-surface-300 break-all leading-relaxed">{voteTxHash}</p>
                  </div>
                )}
              </div>
            )}

            {selectedVote && (
              <button
                onClick={handleVote}
                disabled={voting}
                className="btn-primary flex items-center justify-center gap-2"
              >
                {voting ? (
                  <>
                    <Spinner size="sm" />
                    Submitting...
                  </>
                ) : (
                  `Vote ${VOTE_OPTIONS.find((v) => v.option === selectedVote)?.label}`
                )}
              </button>
            )}
          </div>
        )}

        {isVotingPeriod && isViewOnly && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.58-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Watch-only — cannot vote
          </div>
        )}

        <div className="h-2" />
      </div>
    </Layout>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-surface-500">{label}</span>
      <span className={`text-[11px] font-medium ${highlight ? "text-gonka-400" : "text-surface-300"}`}>{value}</span>
    </div>
  );
}

function TallyItem({ label, value, total, color }: { label: string; value: string; total: number; color: string }) {
  const pct = total > 0 ? ((Number(value) / total) * 100).toFixed(1) : "0.0";
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[11px] font-medium ${color}`}>{label}</span>
      <span className="text-[11px] text-surface-400 tabular-nums">{pct}%</span>
    </div>
  );
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

function RichText({ text }: { text: string }) {
  const parts: (string | { url: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_REGEX)) {
    if (match.index! > last) parts.push(text.slice(last, match.index));
    parts.push({ url: match[0] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gonka-400 hover:text-gonka-300 underline underline-offset-2 break-all"
          >
            {p.url}
          </a>
        )
      )}
    </>
  );
}

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-[11px] text-gonka-400 hover:text-gonka-300 transition-colors group"
    >
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
      <span className="truncate group-hover:underline underline-offset-2">{label}</span>
    </a>
  );
}

function extractLinks(proposal: Proposal): { url: string; label: string }[] {
  const links: { url: string; label: string }[] = [];
  const seen = new Set<string>();

  try {
    const meta = JSON.parse(proposal.metadata);
    if (meta.details && meta.details.startsWith("http")) {
      seen.add(meta.details);
      links.push({ url: meta.details, label: "Proposal Details" });
    }
    if (meta.forum && meta.forum.startsWith("http")) {
      seen.add(meta.forum);
      links.push({ url: meta.forum, label: "Forum Discussion" });
    }
    if (typeof meta === "string" && meta.startsWith("http")) {
      seen.add(meta);
      links.push({ url: meta, label: "Metadata" });
    }
  } catch {
    if (proposal.metadata && proposal.metadata.startsWith("http")) {
      seen.add(proposal.metadata);
      links.push({ url: proposal.metadata, label: "Proposal Metadata" });
    }
  }

  const body = proposal.description || proposal.summary || "";
  for (const match of body.matchAll(URL_REGEX)) {
    const url = match[0];
    if (!seen.has(url)) {
      seen.add(url);
      const label = url.includes("github.com") ? "GitHub" :
                    url.includes("forum") || url.includes("commonwealth") ? "Forum Discussion" :
                    url.includes("ipfs") ? "IPFS Document" :
                    "Related Link";
      links.push({ url, label });
    }
  }

  return links;
}

function QuorumBadge({ totalVoted, bondedTokens, quorum }: { totalVoted: number; bondedTokens: string; quorum: number }) {
  const bonded = Number(bondedTokens);
  if (bonded === 0) return null;
  const votedPct = (totalVoted / bonded) * 100;
  const quorumPct = quorum * 100;
  const reached = votedPct >= quorumPct;

  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
      reached
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
        : "bg-amber-500/15 text-amber-400 border-amber-500/20"
    }`}>
      {reached ? "Quorum reached" : `Quorum: ${votedPct.toFixed(1)}% / ${quorumPct}%`}
    </span>
  );
}

function QuorumBar({ totalVoted, bondedTokens, quorum }: { totalVoted: number; bondedTokens: string; quorum: number }) {
  const bonded = Number(bondedTokens);
  if (bonded === 0) return null;
  const votedPct = Math.min((totalVoted / bonded) * 100, 100);
  const quorumPct = quorum * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-surface-500">
        <span>Turnout: {votedPct.toFixed(1)}%</span>
        <span>Quorum: {quorumPct}%</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-800 overflow-hidden">
        <div
          className="h-full bg-gonka-500/60 rounded-full transition-all"
          style={{ width: `${votedPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-px bg-white/30"
          style={{ left: `${quorumPct}%` }}
        />
      </div>
    </div>
  );
}
