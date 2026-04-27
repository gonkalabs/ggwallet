import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import PasswordInput from "@/popup/components/PasswordInput";
import Spinner from "@/popup/components/Spinner";

export default function SetPassword() {
  const navigate = useNavigate();
  const { mnemonic, createWallet } = useWalletStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!mnemonic) {
    navigate("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const ok = await createWallet(mnemonic, password);
      if (ok) {
        navigate("/");
      } else {
        setError("Failed to create wallet");
      }
    } catch (e: any) {
      setError(e.message || "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px]">
      <header className="flex items-center gap-3 px-4 h-14 shrink-0 led-divider-bottom">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 -ml-1.5 hover:bg-white/5 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="led-text text-[13px] font-extrabold text-white led-glow-soft">
          Set Password
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
          <p className="led-text text-[11px] font-medium text-white/55 mb-2" style={{ letterSpacing: "0.05em" }}>
            Create a password to encrypt your wallet. You'll need this password
            to unlock GG Wallet each time you use it.
          </p>

          <PasswordInput
            label="Password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              setError("");
            }}
            autoFocus
          />

          <PasswordInput
            label="Confirm Password"
            placeholder="Enter password again"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.currentTarget.value);
              setError("");
            }}
          />

          {error && <p className="led-text text-[10px] font-bold text-red-400">{error}</p>}

          {/* Password strength */}
          <div className="space-y-1.5">
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((level) => (
                <div
                  key={level}
                  className={`h-1 flex-1 transition-colors ${
                    password.length >= level * 4
                      ? level <= 1
                        ? "bg-red-500"
                        : level <= 2
                        ? "bg-yellow-500"
                        : "bg-white"
                      : "bg-white/[0.06]"
                  }`}
                  style={
                    password.length >= level * 4 && level > 2
                      ? { boxShadow: "0 0 6px rgba(255,255,255,0.5)" }
                      : undefined
                  }
                />
              ))}
            </div>
            <p className="led-text text-[10px] font-bold text-white/40">
              {password.length === 0
                ? ""
                : password.length < 8
                ? "▢ Too short"
                : password.length < 12
                ? "▢ Good"
                : "▢ Strong"}
            </p>
          </div>
        </div>

        <div className="px-4 py-3 shrink-0 led-divider-top">
          <button
            type="submit"
            disabled={loading || !password || !confirm}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Spinner size="sm" />
                Creating wallet...
              </>
            ) : (
              "▶ Create Wallet"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
