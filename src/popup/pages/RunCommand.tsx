import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { sendMessage } from "@/lib/messaging";
import { toDisplayDecimals, truncateAddress } from "@/lib/format";
import { GONKA_DENOM, GONKA_DISPLAY_DENOM, GONKA_DECIMALS, GONKA_CHAIN_ID } from "@/lib/gonka";
import type { ParsedCommand, Intent, Coin } from "@/lib/inferenced-parser";
import { isQueryIntent } from "@/lib/inferenced-parser";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

type Step = "edit" | "running" | "success" | "error";

const PLACEHOLDER = `# Paste a full inferenced command, e.g.
./inferenced query wasm contract-state smart gonka1… '{"is_available":{"name":"…"}}'
# or
./inferenced tx wasm execute gonka1… '{"vote":{"id":"…"}}' \\
  --from <your-key> --chain-id ${GONKA_CHAIN_ID} -y`;

export default function RunCommand() {
  const navigate = useNavigate();

  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);
  const [step, setStep] = useState<Step>("edit");
  const [runError, setRunError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txHeight, setTxHeight] = useState<number | undefined>(undefined);
  const [contractAddr, setContractAddr] = useState<string | null>(null);
  const [queryJson, setQueryJson] = useState<unknown>(undefined);
  const [queryEndpoint, setQueryEndpoint] = useState<string>("");

  const isQuery = parsed?.ok ? isQueryIntent(parsed.intent) : false;

  // Re-parse on every change. Parser is pure + cheap; we route through the
  // service worker so the SW knows the user's address and can flag --from
  // mismatches accurately.
  useEffect(() => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setParsed(null);
      return;
    }
    let cancelled = false;
    sendMessage({ type: "PARSE_INFERENCED_CMD", command: raw }).then((r) => {
      if (cancelled) return;
      if (r?.parsed) setParsed(r.parsed);
    });
    return () => {
      cancelled = true;
    };
  }, [raw]);

  const canExecute = useMemo(
    () =>
      step === "edit" &&
      parsed?.ok === true &&
      !parsed.warnings.some((w) => w.level === "error"),
    [parsed, step],
  );

  const handleRun = async () => {
    if (!parsed?.ok) return;
    setStep("running");
    setRunError("");
    try {
      const r = await sendMessage({ type: "RUN_INFERENCED_CMD", command: raw });
      if (r?.success) {
        if (r.queryResult) {
          setQueryJson(r.queryResult.json);
          setQueryEndpoint(r.queryResult.endpoint || "");
        } else {
          setTxHash(r.result.txHash);
          setTxHeight(r.result.height);
          setContractAddr(r.result.contractAddress ?? null);
        }
        setStep("success");
      } else {
        setRunError(r?.error || "Execution failed");
        setStep("error");
      }
    } catch (e: any) {
      setRunError(e?.message || "Execution failed");
      setStep("error");
    }
  };

  // ---- Success / error end states ----------------------------------------

  if (step === "success" && queryJson !== undefined) {
    return (
      <Layout title="Query Result" showBack={false} showNav={false}>
        <div className="px-4 py-4 space-y-4">
          <div className="card space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="led-eyebrow">
                <span className="led-eyebrow-dot" />
                Result
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(queryJson, null, 2));
                }}
                className="text-[10px] uppercase tracking-wide text-gonka-400 hover:text-gonka-300"
              >
                Copy JSON
              </button>
            </div>
            <pre className="font-mono text-[10px] text-surface-200 bg-black/30 rounded-xl p-2 max-h-72 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(queryJson, null, 2)}
            </pre>
            {queryEndpoint && (
              <p className="text-[10px] text-surface-500 break-all">{queryEndpoint}</p>
            )}
          </div>
          <div className="space-y-2">
            <button
              onClick={() => {
                setStep("edit");
                setQueryJson(undefined);
                setQueryEndpoint("");
              }}
              className="btn-primary"
            >
              Run Another
            </button>
            <button onClick={() => navigate("/")} className="btn-secondary">
              Back to Wallet
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (step === "success") {
    return (
      <Layout title="Command Executed" showBack={false} showNav={false}>
        <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
          <div className="w-16 h-16 bg-gonka-500/10 border border-gonka-500/25 rounded-full flex items-center justify-center mb-5 animate-scale-in">
            <svg className="w-8 h-8 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold mb-2">Command Executed</h2>
          {txHeight !== undefined && (
            <p className="text-sm text-surface-400 mb-5">Block height {txHeight}</p>
          )}
          {contractAddr && (
            <div className="w-full bg-white/[0.03] rounded-2xl p-4 mb-3">
              <p className="text-xs text-surface-500 mb-1">Contract Address</p>
              <p className="text-xs font-mono text-surface-300 break-all">{contractAddr}</p>
            </div>
          )}
          <div className="w-full bg-white/[0.03] rounded-2xl p-4 mb-6">
            <p className="text-xs text-surface-500 mb-1">Transaction Hash</p>
            <p className="text-xs font-mono text-surface-300 break-all">{txHash}</p>
          </div>
          <button onClick={() => navigate("/")} className="btn-primary">
            Back to Wallet
          </button>
        </div>
      </Layout>
    );
  }

  if (step === "error") {
    return (
      <Layout title="Execution Failed" showBack={false} showNav={false}>
        <div className="px-4 py-4 space-y-4">
          <div className="card border-red-500/30">
            <p className="text-sm text-red-400 break-words">{runError}</p>
          </div>
          <div className="space-y-2">
            <button onClick={() => setStep("edit")} className="btn-primary">
              Edit & Retry
            </button>
            <button onClick={() => navigate("/")} className="btn-secondary">
              Back to Wallet
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // ---- Edit / preview ----------------------------------------------------

  return (
    <Layout title="Run inferenced Command" showBack showNav={false}>
      <div className="px-4 py-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-surface-300">
            Command
          </label>
          <textarea
            className="input-field font-mono text-[11px] leading-relaxed min-h-[140px] resize-y"
            placeholder={PLACEHOLDER}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
          <p className="text-[11px] text-surface-500 leading-snug">
            Paste any <code className="text-surface-300">inferenced tx …</code> or{" "}
            <code className="text-surface-300">query …</code> command. The wallet signs <code className="text-surface-300">tx</code>{" "}
            with your active key; <code className="text-surface-300">--from</code>, <code className="text-surface-300">--node</code>, and{" "}
            <code className="text-surface-300">--keyring-backend</code> are ignored.
          </p>
        </div>

        {parsed && <PreviewCard parsed={parsed} />}

        {step === "running" ? (
          <button disabled className="btn-primary flex items-center justify-center gap-2">
            <Spinner size="sm" /> {isQuery ? "Querying…" : "Broadcasting…"}
          </button>
        ) : (
          <button onClick={handleRun} disabled={!canExecute} className="btn-primary">
            {isQuery ? "Run Query" : "Execute"}
          </button>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
//  Preview card — shows the parser's verdict in human-friendly form
// ---------------------------------------------------------------------------

function PreviewCard({ parsed }: { parsed: ParsedCommand }) {
  const errors = parsed.warnings.filter((w) => w.level === "error");
  const infos = parsed.warnings.filter((w) => w.level === "info");

  return (
    <div className="card space-y-3">
      <div className="flex justify-between items-baseline">
        <span className="led-eyebrow">
          <span className="led-eyebrow-dot" />
          {parsed.ok ? "Parsed" : "Issue"}
        </span>
        <span className="text-[10px] font-mono text-surface-500 uppercase">
          {parsed.ok ? parsed.intent.kind : parsed.subcommand || "unknown"}
        </span>
      </div>

      {parsed.ok ? (
        <IntentDetails intent={parsed.intent} />
      ) : (
        <p className="text-xs text-red-400 break-words">{parsed.error}</p>
      )}

      {(errors.length > 0 || infos.length > 0) && (
        <div className="border-t border-white/[0.04] pt-3 space-y-1.5">
          {errors.map((w, i) => (
            <p key={`e${i}`} className="text-[11px] text-red-400 break-words">
              ✕ {w.message}
            </p>
          ))}
          {infos.map((w, i) => (
            <p key={`i${i}`} className="text-[11px] text-surface-500 break-words">
              ℹ {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function IntentDetails({ intent }: { intent: Intent }) {
  switch (intent.kind) {
    // ---- Queries ----
    case "query.bank.balances":
      return (
        <Rows>
          <Row label="Query">All balances</Row>
          <Row label="Address" mono>{intent.address}</Row>
        </Rows>
      );
    case "query.bank.balance":
      return (
        <Rows>
          <Row label="Query">Balance ({intent.denom})</Row>
          <Row label="Address" mono>{intent.address}</Row>
        </Rows>
      );
    case "query.staking.delegations":
      return (
        <Rows>
          <Row label="Query">All delegations</Row>
          <Row label="Address" mono>{intent.address}</Row>
        </Rows>
      );
    case "query.staking.delegation":
      return (
        <Rows>
          <Row label="Query">Delegation</Row>
          <Row label="Delegator" mono>{intent.address}</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );
    case "query.staking.validator":
      return (
        <Rows>
          <Row label="Query">Validator info</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );
    case "query.staking.validators":
      return (<Rows><Row label="Query">All validators</Row></Rows>);
    case "query.distribution.rewards":
      return (
        <Rows>
          <Row label="Query">Staking rewards</Row>
          <Row label="Address" mono>{intent.address}</Row>
        </Rows>
      );
    case "query.distribution.rewards-from-validator":
      return (
        <Rows>
          <Row label="Query">Rewards from validator</Row>
          <Row label="Delegator" mono>{intent.address}</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );
    case "query.gov.proposal":
      return (<Rows><Row label="Query">Proposal #{intent.proposalId}</Row></Rows>);
    case "query.gov.proposals":
      return (<Rows><Row label="Query">All proposals</Row></Rows>);
    case "query.gov.tally":
      return (<Rows><Row label="Query">Tally for proposal #{intent.proposalId}</Row></Rows>);
    case "query.auth.account":
      return (
        <Rows>
          <Row label="Query">Account</Row>
          <Row label="Address" mono>{intent.address}</Row>
        </Rows>
      );
    case "query.tx":
      return (
        <Rows>
          <Row label="Query">Transaction</Row>
          <Row label="Hash" mono>{intent.hash}</Row>
        </Rows>
      );
    case "query.wasm.smart":
      return (
        <Rows>
          <Row label="Query">Smart-query contract</Row>
          <Row label="Contract" mono>{truncateAddress(intent.contract, 12, 8)}</Row>
          <Row label="Message" block>
            <pre className="font-mono text-[10px] text-surface-300 bg-black/30 rounded-xl p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {tryPretty(intent.queryRaw)}
            </pre>
          </Row>
        </Rows>
      );
    case "query.wasm.code-info":
      return (<Rows><Row label="Query">Code info #{intent.codeId}</Row></Rows>);
    case "query.wasm.list-codes":
      return (<Rows><Row label="Query">All stored codes</Row></Rows>);

    // ---- Transactions ----
    case "bank.send":
      return (
        <Rows>
          <Row label="Action">Send {formatCoin({ denom: intent.denom, amount: intent.amount })}</Row>
          <Row label="To" mono>{intent.toAddress}</Row>
          {intent.memo && <Row label="Memo">{intent.memo}</Row>}
        </Rows>
      );

    case "wasm.execute":
      return (
        <Rows>
          <Row label="Action">Execute contract</Row>
          <Row label="Contract" mono>{truncateAddress(intent.contract, 12, 8)}</Row>
          <Row label="Message" block>
            <pre className="font-mono text-[10px] text-surface-300 bg-black/30 rounded-xl p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {tryPretty(intent.msgRaw)}
            </pre>
          </Row>
          {intent.funds.length > 0 && (
            <Row label="Funds">{intent.funds.map(formatCoin).join(", ")}</Row>
          )}
          {intent.memo && <Row label="Memo">{intent.memo}</Row>}
        </Rows>
      );

    case "wasm.instantiate":
      return (
        <Rows>
          <Row label="Action">Instantiate code #{intent.codeId}</Row>
          <Row label="Label">{intent.label}</Row>
          <Row label="Admin" mono>
            {intent.admin ? truncateAddress(intent.admin, 12, 8) : "(none)"}
          </Row>
          <Row label="Init Msg" block>
            <pre className="font-mono text-[10px] text-surface-300 bg-black/30 rounded-xl p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {tryPretty(intent.initMsgRaw)}
            </pre>
          </Row>
          {intent.funds.length > 0 && (
            <Row label="Funds">{intent.funds.map(formatCoin).join(", ")}</Row>
          )}
        </Rows>
      );

    case "staking.delegate":
      return (
        <Rows>
          <Row label="Action">Delegate {formatCoin({ denom: intent.denom, amount: intent.amount })}</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );

    case "staking.unbond":
      return (
        <Rows>
          <Row label="Action">Unbond {formatCoin({ denom: intent.denom, amount: intent.amount })}</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );

    case "staking.redelegate":
      return (
        <Rows>
          <Row label="Action">Redelegate {formatCoin({ denom: intent.denom, amount: intent.amount })}</Row>
          <Row label="From" mono>{intent.srcValidator}</Row>
          <Row label="To" mono>{intent.dstValidator}</Row>
        </Rows>
      );

    case "distribution.withdraw-rewards":
      return (
        <Rows>
          <Row label="Action">Withdraw staking rewards</Row>
          <Row label="Validator" mono>{intent.validator}</Row>
        </Rows>
      );

    case "distribution.withdraw-all-rewards":
      return (
        <Rows>
          <Row label="Action">Withdraw all rewards</Row>
        </Rows>
      );

    case "gov.vote":
      return (
        <Rows>
          <Row label="Action">Vote on proposal #{intent.proposalId}</Row>
          <Row label="Option">{prettyVote(intent.option)}</Row>
        </Rows>
      );

    case "gov.deposit":
      return (
        <Rows>
          <Row label="Action">Deposit {formatCoin({ denom: intent.denom, amount: intent.amount })}</Row>
          <Row label="Proposal">#{intent.proposalId}</Row>
        </Rows>
      );

    default: {
      const _e: never = intent;
      void _e;
      return null;
    }
  }
}

function Rows({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function Row({
  label,
  children,
  mono,
  block,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  block?: boolean;
}) {
  if (block) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-surface-500">{label}</div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-[11px] uppercase tracking-wide text-surface-500 shrink-0 mt-0.5">
        {label}
      </span>
      <span
        className={`text-xs text-right break-all ${mono ? "font-mono text-surface-300" : "text-white"}`}
      >
        {children}
      </span>
    </div>
  );
}

function formatCoin(c: Coin): string {
  if (c.denom === GONKA_DENOM) {
    return `${toDisplayDecimals(c.amount, GONKA_DECIMALS)} ${GONKA_DISPLAY_DENOM}`;
  }
  return `${c.amount} ${c.denom}`;
}

function tryPretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function prettyVote(o: string): string {
  switch (o) {
    case "VOTE_OPTION_YES": return "Yes";
    case "VOTE_OPTION_NO": return "No";
    case "VOTE_OPTION_ABSTAIN": return "Abstain";
    case "VOTE_OPTION_NO_WITH_VETO": return "No with veto";
  }
  return o;
}
