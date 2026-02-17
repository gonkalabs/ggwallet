import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";

async function generateMnemonic(): Promise<string> {
  const { Bip39, Random } = await import("@cosmjs/crypto");
  const entropy = Random.getBytes(32);
  const mnemonic = Bip39.encode(entropy);
  return mnemonic.toString();
}

export default function CreateWallet() {
  const navigate = useNavigate();
  const { setMnemonic } = useWalletStore();
  const [words, setWords] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    generateMnemonic().then((m) => {
      setWords(m.split(" "));
      setLoading(false);
    });
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(words.join(" "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    setMnemonic(words.join(" "));
    navigate("/set-password");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-surface-950">
        <div className="animate-spin w-8 h-8 border-2 border-gonka-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px] bg-surface-950">
      <header className="flex items-center gap-3 px-4 h-14 shrink-0">
        <button
          onClick={() => navigate("/")}
          className="p-1.5 -ml-1.5 hover:bg-white/5 rounded-xl transition-colors"
        >
          <svg className="w-5 h-5 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-base font-semibold">Create Wallet</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-surface-300 mb-1">
            Recovery Phrase
          </h2>
          <p className="text-xs text-surface-500 mb-3">
            Write down these 24 words in order. Never share them with anyone.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {words.map((word, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 bg-white/[0.03] rounded-xl px-2.5 py-2"
            >
              <span className="text-[10px] text-surface-600 w-4 text-right tabular-nums">
                {i + 1}
              </span>
              <span className="text-xs font-medium">{word}</span>
            </div>
          ))}
        </div>

        <button
          onClick={handleCopy}
          className="w-full py-2 text-sm text-gonka-400 hover:text-gonka-300 transition-colors flex items-center justify-center gap-2"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              Copy to clipboard
            </>
          )}
        </button>

        <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-2xl p-3.5">
          <p className="text-xs text-yellow-200/70">
            Warning: If you lose this phrase, you will lose access to your
            wallet and all your funds.
          </p>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 rounded border-surface-600 bg-surface-800 text-gonka-500 focus:ring-gonka-500"
          />
          <span className="text-xs text-surface-400">
            I have saved my recovery phrase in a secure location
          </span>
        </label>
      </div>

      <div className="px-4 py-3 shrink-0">
        <button
          onClick={handleContinue}
          disabled={!confirmed}
          className="btn-primary"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
