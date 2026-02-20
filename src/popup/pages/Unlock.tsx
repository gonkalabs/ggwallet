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

  return (
    <div className="flex flex-col items-center justify-between h-[600px] px-6 py-10 bg-surface-950">
      <div />

      <div className="w-full flex flex-col items-center animate-fade-in-up">
        <img src={logo} alt="GG Wallet" className="w-16 h-16 mb-5 rounded-2xl shadow-glow" />
        <h1 className="text-xl font-bold tracking-tight mb-1">Welcome back</h1>

        {originHostname && methodLabel ? (
          <div className="mb-8 text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-surface-800 border border-white/[0.06] rounded-2xl px-3 py-1.5">
              <div className="w-4 h-4 rounded-full bg-gonka-500/20 border border-gonka-500/30 flex items-center justify-center shrink-0">
                <span className="text-[9px] font-bold text-gonka-400">
                  {originHostname.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="text-xs font-medium text-surface-300">{originHostname}</span>
            </div>
            <p className="text-sm text-surface-400">
              wants to <span className="text-white font-medium">{methodLabel}</span>
            </p>
            <p className="text-xs text-surface-600">Unlock your wallet to continue</p>
          </div>
        ) : (
          <p className="text-sm text-surface-500 mb-8">
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
            <p className="text-xs text-red-400 text-center">{error}</p>
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
              "Unlock"
            )}
          </button>
        </form>
      </div>

      <p className="text-xs text-surface-600">
        open-source by{" "}
        <a
          href="https://gonkalabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-surface-500 hover:text-surface-400 transition-colors"
        >
          gonkalabs
        </a>
      </p>
    </div>
  );
}
