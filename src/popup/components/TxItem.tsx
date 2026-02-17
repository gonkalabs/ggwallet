import { Transaction } from "@/lib/api";
import { formatCompact, truncateAddress, formatTimestamp } from "@/lib/format";
import { GONKA_EXPLORER_URL } from "@/lib/gonka";

interface TxItemProps {
  tx: Transaction;
}

export default function TxItem({ tx }: TxItemProps) {
  const isSent = tx.direction === "sent";
  const isSelf = tx.direction === "self";

  const peerAddress = isSent ? tx.receiver : tx.sender;

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
          isSelf
            ? "bg-white/[0.06] text-surface-400"
            : isSent
            ? "bg-red-500/10 text-red-400"
            : "bg-gonka-500/10 text-gonka-400"
        }`}
      >
        {isSelf ? (
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
            <span className="text-sm font-medium">
              {isSelf ? "Self" : isSent ? "Sent" : "Received"}
            </span>
            <svg className="w-3 h-3 text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </div>
          <span
            className={`text-sm font-semibold tabular-nums ${
              isSent ? "text-red-400" : "text-gonka-400"
            }`}
          >
            {isSent ? "-" : "+"}
            {formatCompact(tx.amount, 4)}
          </span>
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
