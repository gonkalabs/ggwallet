import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sendMessage } from "@/lib/messaging";
import { toMinimal } from "@/lib/format";
import { GONKA_DISPLAY_DENOM } from "@/lib/gonka";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

type Step = "form" | "confirm" | "success";

export default function CreateProposal() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deposit, setDeposit] = useState("");

  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const canSubmit = title.trim().length > 0 && description.trim().length > 0;

  const handleConfirm = async () => {
    setLoading(true);
    setError("");

    try {
      const depositMinimal = deposit ? toMinimal(deposit) : "0";
      const resp = await sendMessage({
        type: "SUBMIT_PROPOSAL",
        title: title.trim(),
        description: description.trim(),
        deposit: depositMinimal,
      });

      if (resp.success) {
        setTxHash(resp.txHash || "");
        setStep("success");
      } else {
        setError(resp.error || "Failed to submit proposal");
      }
    } catch (e: any) {
      setError(e.message || "Failed to submit proposal");
    } finally {
      setLoading(false);
    }
  };

  if (step === "success") {
    return (
      <Layout title="Proposal Submitted" showBack showNav={false}>
        <div className="px-4 py-8 flex flex-col items-center text-center space-y-5 animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-gonka-500/15 border border-gonka-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold mb-1">Proposal Submitted</h2>
            <p className="text-xs text-surface-500">Your proposal has been submitted to the network.</p>
          </div>
          {txHash && (
            <div className="card !p-3 w-full">
              <p className="text-[10px] text-surface-500 mb-0.5">Transaction Hash</p>
              <p className="text-[11px] font-mono text-surface-300 break-all">{txHash}</p>
            </div>
          )}
          <button onClick={() => navigate("/proposals")} className="btn-primary">
            Back to Proposals
          </button>
        </div>
      </Layout>
    );
  }

  if (step === "confirm") {
    return (
      <Layout title="Confirm Proposal" showBack showNav={false}>
        <div className="px-4 py-4 space-y-4 animate-fade-in">
          <div className="card !p-3 space-y-3">
            <div>
              <p className="text-[10px] text-surface-500 mb-0.5">Title</p>
              <p className="text-sm font-medium">{title}</p>
            </div>
            <div>
              <p className="text-[10px] text-surface-500 mb-0.5">Description</p>
              <p className="text-xs text-surface-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{description}</p>
            </div>
            {deposit && (
              <div>
                <p className="text-[10px] text-surface-500 mb-0.5">Initial Deposit</p>
                <p className="text-sm font-medium text-gonka-400">{deposit} {GONKA_DISPLAY_DENOM}</p>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="space-y-2">
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  Submitting...
                </>
              ) : (
                "Submit Proposal"
              )}
            </button>
            <button
              onClick={() => { setStep("form"); setError(""); }}
              disabled={loading}
              className="btn-ghost text-sm"
            >
              Back to Edit
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="New Proposal" showBack showNav={false}>
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-surface-300">Title</label>
          <input
            type="text"
            className="input-field"
            placeholder="Proposal title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={140}
            autoFocus
          />
          <p className="text-[10px] text-surface-600 text-right">{title.length}/140</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-surface-300">Description</label>
          <textarea
            className="input-field !py-3 min-h-[120px] resize-none"
            placeholder="Describe your proposal..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
          />
          <p className="text-[10px] text-surface-600 text-right">{description.length}/5000</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-surface-300">Initial Deposit</label>
            <span className="text-[10px] text-surface-500">Optional</span>
          </div>
          <div className="relative">
            <input
              type="text"
              className="input-field pr-14"
              placeholder="0.00"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-surface-500 font-medium">
              {GONKA_DISPLAY_DENOM}
            </span>
          </div>
        </div>

        <button
          onClick={() => setStep("confirm")}
          disabled={!canSubmit}
          className="btn-primary"
        >
          Review Proposal
        </button>
      </div>
    </Layout>
  );
}
