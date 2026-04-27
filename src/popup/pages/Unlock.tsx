import { useState, useEffect } from "react";
import { useWalletStore } from "@/popup/store";
import PasswordInput from "@/popup/components/PasswordInput";
import Spinner from "@/popup/components/Spinner";
import logo from "@/assets/ggwallet.png";
import { sendMessage } from "@/lib/messaging";

const METHOD_LABELS: Record<string, string> = {
  enable:        "connect to your wallet",
  getKey:        "read your wallet address",
  signAmino:     "sign a transaction",
  signDirect:    "sign a transaction",
  signArbitrary: "sign a message",
};

export default function Unlock() {
  const { unlock } = useWalletStore();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unlockOrigin, setUnlockOrigin] = useState("");
  const [unlockMethod, setUnlockMethod] = useState("");

  // Fetch the pending unlock context from the background so we can
  // show which dApp triggered the unlock request.
  useEffect(() => {
    sendMessage({ type: "GET_UNLOCK_CONTEXT" })
      .then((resp) => {
        if (resp?.context) {
          setUnlockOrigin(resp.context.origin || "");
          setUnlockMethod(resp.context.method || "");
        }
      })
      .catch(() => {});
  }, []);

  let originHostname = "";
  if (unlockOrigin) {
    try { originHostname = new URL(unlockOrigin).hostname; } catch { originHostname = unlockOrigin; }
  }
  const methodLabel = unlockMethod ? (METHOD_LABELS[unlockMethod] ?? unlockMethod) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError("");

    try {
      const ok = await unlock(password);
      if (!ok) {
        setError("Wrong password");
      } else if (unlockOrigin) {
        // Opened by a dApp request — close this window, the dApp will proceed
        window.close();
      }
    } catch {
      setError("Failed to unlock wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    await sendMessage({ type: "REJECT_UNLOCK" }).catch(() => {});
    window.close();
  };

  return (
    <div className="flex flex-col items-center justify-between h-[600px] px-6 py-10">
      <div />

      <div className="w-full flex flex-col items-center animate-fade-in-up">
        <img
          src={logo}
          alt="GG Wallet"
          className="w-16 h-16 mb-5 rounded-2xl"
          style={{ boxShadow: "0 0 20px -4px rgba(255,255,255,0.4)" }}
        />
        <h1 className="led-title text-2xl mb-2">Welcome back</h1>

        {originHostname && methodLabel ? (
          <div className="mb-8 text-center space-y-2.5">
            <div className="inline-flex items-center gap-2 led-panel px-3 py-1.5">
              <div className="w-4 h-4 rounded-[2px] bg-white flex items-center justify-center shrink-0" style={{ boxShadow: "0 0 4px rgba(255,255,255,0.4)" }}>
                <span className="led-text text-[9px] font-extrabold text-surface-950">
                  {originHostname.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="led-text text-[11px] font-extrabold text-white">{originHostname}</span>
            </div>
            <p className="led-text text-[12px] font-bold text-white/70">
              wants to <span className="text-white led-glow-soft">{methodLabel}</span>
            </p>
            <p className="led-text text-[10px] font-medium text-white/35" style={{ letterSpacing: "0.05em" }}>
              Unlock your wallet to continue
            </p>
          </div>
        ) : (
          <p className="led-text text-[11px] font-bold text-white/55 mb-8" style={{ letterSpacing: "0.05em" }}>
            Enter your password to unlock GG Wallet
          </p>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <PasswordInput
            placeholder="Enter password"
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              setError("");
            }}
            autoFocus
          />

          {error && (
            <p className="led-text text-[10px] font-bold text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Spinner size="sm" />
                Unlocking...
              </>
            ) : (
              "▶ Unlock"
            )}
          </button>

          {originHostname && (
            <button
              type="button"
              onClick={handleReject}
              className="led-text w-full py-2.5 text-[11px] font-extrabold text-white/45 hover:text-red-400 transition-colors rounded-xl hover:bg-white/[0.04]"
            >
              Reject request
            </button>
          )}
        </form>
      </div>

      <p className="led-text text-[10px] font-bold text-white/30">
        open-source by{" "}
        <a
          href="https://gonkalabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/55 hover:text-white transition-colors"
        >
          gonkalabs
        </a>
      </p>
    </div>
  );
}
