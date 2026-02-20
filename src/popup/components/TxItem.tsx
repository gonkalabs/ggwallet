import { Transaction } from "@/lib/api";
import { toDisplayDecimals, truncateAddress, formatTimestamp } from "@/lib/format";
import { GONKA_EXPLORER_URL, GONKA_DECIMALS } from "@/lib/gonka";

interface TxItemProps {
  tx: Transaction;
  /** Optional map of denom → resolved symbol (e.g. "ibc/HASH" → "ATOM") */
  symbolMap?: Record<string, string>;
}

function resolveSymbol(denom: string, apiSymbol: string, symbolMap?: Record<string, string>): string {
  if (symbolMap && symbolMap[denom]) return symbolMap[denom];
  return apiSymbol;
}

function denomDecimals(denom: string): number {
  if (denom === "ngonka") return GONKA_DECIMALS;
  if (denom.startsWith("ibc/")) return 6;
  return 0;
}

const MSG_TYPE_LABELS: Record<string, string> = {
  MsgVote: "Vote",
  MsgSubmitProposal: "Proposal",
  MsgDeposit: "Deposit",
  MsgDelegate: "Delegate",
  MsgUndelegate: "Undelegate",
  MsgBeginRedelegate: "Redelegate",
  MsgWithdrawDelegatorReward: "Claim Rewards",
  MsgGrant: "Grant",
  MsgRevoke: "Revoke",
  MsgExec: "Authz Exec",
};

function getTxLabel(tx: Transaction, isSent: boolean, isSelf: boolean): string {
  const msgLabel = MSG_TYPE_LABELS[tx.messageType];
  if (msgLabel) return msgLabel;
  if (isSelf) return "Self";
  return isSent ? "Sent" : "Received";
}

function isTransfer(tx: Transaction): boolean {
  return tx.messageType === "MsgSend" || tx.messageType === "MsgTransfer" || tx.messageType === "";
}

export default function TxItem({ tx, symbolMap }: TxItemProps) {
  const isSent = tx.direction === "sent";
  const isSelf = tx.direction === "self";

  const peerAddress = isSent ? tx.receiver : tx.sender;
  const symbol = resolveSymbol(tx.denom, tx.tokenSymbol, symbolMap);
  const decimals = denomDecimals(tx.denom);
  const displayAmount = toDisplayDecimals(tx.amount, decimals);
  const isZeroAmount = displayAmount === "0";
  const transfer = isTransfer(tx);
  const label = getTxLabel(tx, isSent, isSelf);

  const handleClick = () => {
    if (tx.hash) {
      chrome.tabs.create({
        url: `${GONKA_EXPLORER_URL}/transactions/${tx.hash}`,
      });
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-3 py-3 px-2 w-full text-left hover:bg-white/[0.03] rounded-xl transition-all duration-200 cursor-pointer group active:scale-[0.99]"
    >
      {/* Direction icon */}
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
          !transfer
            ? "bg-purple-500/10 text-purple-400"
            : isSelf
            ? "bg-white/[0.06] text-surface-400"
            : isSent
            ? "bg-red-500/10 text-red-400"
            : "bg-gonka-500/10 text-gonka-400"
        }`}
      >
        {!transfer ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ) : isSelf ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
          </svg>
        ) : isSent ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25" />
          </svg>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            {tx.isIbc && (
              <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                IBC
              </span>
            )}
            <svg className="w-3 h-3 text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </div>
          {transfer && !isZeroAmount ? (
            <span
              className={`text-sm font-semibold tabular-nums ${
                isSent ? "text-red-400" : "text-gonka-400"
              }`}
            >
              {isSent ? "-" : "+"}
              {displayAmount}
              <span className="ml-1 text-xs font-medium opacity-70">{symbol}</span>
            </span>
          ) : !isZeroAmount ? (
            <span className="text-sm font-semibold tabular-nums text-surface-300">
              {displayAmount}
              <span className="ml-1 text-xs font-medium opacity-70">{symbol}</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-surface-500 font-mono truncate max-w-[160px]">
            {peerAddress ? truncateAddress(peerAddress) : "\u2014"}
          </span>
          <span className="text-xs text-surface-600">
            {tx.timestamp ? formatTimestamp(tx.timestamp) : `#${tx.height}`}
          </span>
        </div>
      </div>
    </button>
  );
}
