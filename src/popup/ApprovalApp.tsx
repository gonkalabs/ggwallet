import { useState, useEffect } from "react";
import Spinner from "@/popup/components/Spinner";
import logo from "@/assets/ggwallet.png";

/**
 * Approval popup — shown in a separate window when a dApp requests
 * a sensitive operation (enable, signAmino, signDirect, signArbitrary).
 *
 * Reads `requestId` from the URL search params, fetches the pending
 * request details from background, and lets the user approve or reject.
 */

interface PendingRequest {
  method: string;
  params: any;
  origin: string;
}

function sendMessage(msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response ?? {});
      }
    });
  });
}

export default function ApprovalApp() {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState("");

  const requestId = new URLSearchParams(window.location.search).get("requestId") || "";

  useEffect(() => {
    if (!requestId) {
      setError("Missing request ID");
      setLoading(false);
      return;
    }

    sendMessage({ type: "GET_PENDING_REQUEST", requestId })
      .then((resp) => {
        if (resp.error || !resp.request) {
          setError(resp.error || "Request not found or expired");
        } else {
          setRequest(resp.request);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [requestId]);

  const handleApprove = async () => {
    setResponding(true);
    try {
      await sendMessage({ type: "APPROVE_REQUEST", requestId });
      window.close();
    } catch (err: any) {
      setError(err.message);
      setResponding(false);
    }
  };

  const handleReject = async () => {
    setResponding(true);
    try {
      await sendMessage({ type: "REJECT_REQUEST", requestId });
      window.close();
    } catch (err: any) {
      setError(err.message);
      setResponding(false);
    }
  };

  if (loading) {
    return (
      <div className="w-[380px] h-[600px] flex items-center justify-center bg-surface-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-[380px] h-[600px] flex flex-col items-center justify-center bg-surface-950 px-6 text-center">
        <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <p className="text-sm text-surface-400">{error}</p>
        <button onClick={() => window.close()} className="mt-6 btn-secondary !w-auto !px-8">
          Close
        </button>
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="w-[380px] h-[600px] flex flex-col bg-surface-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="GG Wallet" className="w-8 h-8 rounded-xl" />
          <h1 className="text-sm font-semibold">GG Wallet</h1>
        </div>
        <span className="text-[10px] text-surface-600">
          open-source by{" "}
          <span className="text-surface-400 font-medium">gonkalabs</span>
        </span>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-5 py-4">
        {request.method === "enable" && <EnableApproval request={request} />}
        {request.method === "signAmino" && <SignAminoApproval request={request} />}
        {request.method === "signDirect" && <SignDirectApproval request={request} />}
        {request.method === "signArbitrary" && <SignArbitraryApproval request={request} />}
      </main>

      {/* Actions */}
      <div className="shrink-0 px-5 pb-5 pt-3 space-y-2 border-t border-white/[0.04]">
        <button
          onClick={handleApprove}
          disabled={responding}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {responding ? (
            <>
              <Spinner size="sm" />
              Processing...
            </>
          ) : request.method === "enable" ? (
            "Connect"
          ) : (
            "Approve"
          )}
        </button>
        <button
          onClick={handleReject}
          disabled={responding}
          className="btn-secondary"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
//  Approval views per method
// ------------------------------------------------------------------

function OriginBadge({ origin }: { origin: string }) {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    hostname = origin;
  }

  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-10 h-10 rounded-2xl bg-surface-800 border border-white/[0.06] flex items-center justify-center shrink-0">
        <span className="text-base font-bold text-surface-300">
          {hostname.charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate">{hostname}</p>
        <p className="text-[11px] text-surface-600 truncate">{origin}</p>
      </div>
    </div>
  );
}

function EnableApproval({ request }: { request: PendingRequest }) {
  const chainIds: string[] = request.params?.chainIds || [];

  return (
    <div>
      <OriginBadge origin={request.origin} />

      <div className="text-center mb-5">
        <div className="w-14 h-14 bg-gonka-500/10 border border-gonka-500/25 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-gonka-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.9-2.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.876 8.07" />
          </svg>
        </div>
        <h2 className="text-base font-bold mb-1">Connection Request</h2>
        <p className="text-sm text-surface-400">
          This site wants to connect to your wallet
        </p>
      </div>

      <div className="card space-y-3">
        <div>
          <p className="text-xs text-surface-500 mb-1">This will allow the site to:</p>
          <ul className="text-xs text-surface-300 space-y-1.5 ml-1">
            <li className="flex items-start gap-2">
              <svg className="w-3.5 h-3.5 text-gonka-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              View your wallet address
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-3.5 h-3.5 text-gonka-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Request transaction signatures
            </li>
          </ul>
        </div>
        {chainIds.length > 0 && (
          <>
            <div className="border-t border-white/[0.04]" />
            <div>
              <p className="text-xs text-surface-500 mb-1">Chain{chainIds.length > 1 ? "s" : ""}</p>
              <div className="flex flex-wrap gap-1.5">
                {chainIds.map((id) => (
                  <span
                    key={id}
                    className="text-[11px] font-mono text-surface-300 bg-surface-800 px-2 py-1 rounded-lg"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignAminoApproval({ request }: { request: PendingRequest }) {
  const { signDoc, chainId } = request.params || {};
  const msgs = signDoc?.msgs || [];

  return (
    <div>
      <OriginBadge origin={request.origin} />

      <div className="text-center mb-5">
        <div className="w-14 h-14 bg-yellow-500/10 border border-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        </div>
        <h2 className="text-base font-bold mb-1">Sign Transaction</h2>
        <p className="text-sm text-surface-400">
          Review and approve this transaction
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex justify-between">
          <span className="text-xs text-surface-500">Chain</span>
          <span className="text-xs font-mono text-surface-300">{chainId || signDoc?.chain_id}</span>
        </div>

        {msgs.length > 0 && (
          <>
            <div className="border-t border-white/[0.04]" />
            <div>
              <p className="text-xs text-surface-500 mb-2">Messages ({msgs.length})</p>
              <div className="space-y-2">
                {msgs.map((msg: any, i: number) => (
                  <div key={i} className="bg-black/20 rounded-xl p-3">
                    <p className="text-[11px] font-mono text-gonka-400 mb-1.5">{msg.type}</p>
                    <pre className="text-[10px] text-surface-400 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {JSON.stringify(msg.value, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {signDoc?.memo && (
          <>
            <div className="border-t border-white/[0.04]" />
            <div className="flex justify-between">
              <span className="text-xs text-surface-500">Memo</span>
              <span className="text-xs text-surface-300">{signDoc.memo}</span>
            </div>
          </>
        )}

        {signDoc?.fee && (
          <>
            <div className="border-t border-white/[0.04]" />
            <div className="flex justify-between">
              <span className="text-xs text-surface-500">Fee</span>
              <span className="text-xs text-surface-300">
                {signDoc.fee.amount?.map((a: any) => `${a.amount} ${a.denom}`).join(", ") || "0"}{" "}
                (gas: {signDoc.fee.gas})
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignDirectApproval({ request }: { request: PendingRequest }) {
  const { chainId, signer, signDoc } = request.params || {};

  return (
    <div>
      <OriginBadge origin={request.origin} />

      <div className="text-center mb-5">
        <div className="w-14 h-14 bg-yellow-500/10 border border-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
          </svg>
        </div>
        <h2 className="text-base font-bold mb-1">Sign Transaction</h2>
        <p className="text-sm text-surface-400">
          Review and approve this transaction (Protobuf)
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex justify-between">
          <span className="text-xs text-surface-500">Chain</span>
          <span className="text-xs font-mono text-surface-300">{chainId || signDoc?.chainId}</span>
        </div>
        <div className="border-t border-white/[0.04]" />
        <div>
          <span className="text-xs text-surface-500">Signer</span>
          <p className="text-xs font-mono text-surface-300 break-all mt-0.5">{signer}</p>
        </div>
        <div className="border-t border-white/[0.04]" />
        <div className="flex justify-between">
          <span className="text-xs text-surface-500">Account #</span>
          <span className="text-xs font-mono text-surface-300">{signDoc?.accountNumber || "0"}</span>
        </div>
        <div className="border-t border-white/[0.04]" />
        <div>
          <p className="text-xs text-surface-500 mb-1">Body bytes</p>
          <p className="text-[10px] font-mono text-surface-500 break-all bg-black/20 rounded-lg p-2">
            {signDoc?.bodyBytes?.length || 0} bytes
          </p>
        </div>
      </div>
    </div>
  );
}

function SignArbitraryApproval({ request }: { request: PendingRequest }) {
  const { chainId, signer, data } = request.params || {};

  // data can be a string or an array of numbers
  let displayData: string;
  if (typeof data === "string") {
    displayData = data;
  } else if (Array.isArray(data)) {
    try {
      displayData = new TextDecoder().decode(new Uint8Array(data));
    } catch {
      displayData = `[${data.length} bytes]`;
    }
  } else {
    displayData = String(data);
  }

  return (
    <div>
      <OriginBadge origin={request.origin} />

      <div className="text-center mb-5">
        <div className="w-14 h-14 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </div>
        <h2 className="text-base font-bold mb-1">Sign Message</h2>
        <p className="text-sm text-surface-400">
          This site wants you to sign a message
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex justify-between">
          <span className="text-xs text-surface-500">Chain</span>
          <span className="text-xs font-mono text-surface-300">{chainId}</span>
        </div>
        <div className="border-t border-white/[0.04]" />
        <div>
          <span className="text-xs text-surface-500">Signer</span>
          <p className="text-xs font-mono text-surface-300 break-all mt-0.5">{signer}</p>
        </div>
        <div className="border-t border-white/[0.04]" />
        <div>
          <p className="text-xs text-surface-500 mb-1">Message</p>
          <div className="bg-black/20 rounded-xl p-3">
            <p className="text-sm text-surface-200 whitespace-pre-wrap break-all">{displayData}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
