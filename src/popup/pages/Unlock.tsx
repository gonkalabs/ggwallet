import { useState } from "react";
import { useWalletStore } from "@/popup/store";
import PasswordInput from "@/popup/components/PasswordInput";
import Spinner from "@/popup/components/Spinner";
import logo from "@/assets/ggwallet.png";

export default function Unlock() {
  const { unlock } = useWalletStore();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError("");

    try {
      const ok = await unlock(password);
      if (!ok) {
        setError("Wrong password");
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
        <p className="text-sm text-surface-500 mb-8">
          Enter your password to unlock GG Wallet
        </p>

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
