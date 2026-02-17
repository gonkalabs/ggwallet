import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { sendMessage } from "@/lib/messaging";
import Layout from "@/popup/components/Layout";
import Spinner from "@/popup/components/Spinner";

type Step = "choose" | "create" | "import";

export default function AddWallet() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("choose");
  const [mnemonic, setMnemonic] = useState("");
  const [importInput, setImportInput] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleCreate = async () => {
    setGenerating(true);
    try {
      const { Bip39, Random } = await import("@cosmjs/crypto");
      const entropy = Random.getBytes(32);
      const m = Bip39.encode(entropy).toString();
      setMnemonic(m);
      setStep("create");
    } finally {
      setGenerating(false);
    }
  };

  /** Submit the wallet (works for both create and import flows) */
  const submitWallet = async (mnemonicToAdd: string) => {
    setLoading(true);
    setError("");

    try {
      // ADD_WALLET uses the cached password from the already-unlocked keystore
      const resp = await sendMessage({
        type: "ADD_WALLET",
        mnemonic: mnemonicToAdd,
        name: name || undefined,
      });

      if (resp.success) {
        useWalletStore.setState({
          address: resp.address,
          activeIndex: resp.index ?? 0,
          balance: "0",
        });
        await useWalletStore.getState().refreshWallets();
        navigate("/");
      } else {
        setError(resp.error || "Failed to add wallet");
      }
    } catch (e: any) {
      setError(e.message || "Failed to add wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleImportContinue = () => {
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError("Please enter a valid 12 or 24-word recovery phrase");
      return;
    }
    const cleaned = words.join(" ");
    setMnemonic(cleaned);
    submitWallet(cleaned);
  };

  // Step: choose create or import
  if (step === "choose") {
    return (
      <Layout title="Add Wallet" showBack showNav={false}>
        <div className="px-4 py-6 space-y-4">
          <p className="text-sm text-surface-400">
            Add another wallet to Gonka Wallet. You can switch between wallets at any time.
          </p>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-surface-300">
                Wallet Name <span className="text-surface-600">(optional)</span>
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Trading, Staking..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={generating}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {generating ? <Spinner size="sm" /> : null}
              Create New Wallet
            </button>
            <button
              onClick={() => setStep("import")}
              className="btn-secondary"
            >
              Import Existing Wallet
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // Step: show mnemonic for created wallet, then add it
  if (step === "create") {
    const words = mnemonic.split(" ");
    return (
      <Layout title="Backup Phrase" showBack={false} showNav={false}>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <p className="text-xs text-surface-500">
            Write down these words in order. This is the only way to recover this wallet.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-white/[0.03] rounded-xl px-2.5 py-2"
              >
                <span className="text-[10px] text-surface-600 w-4 text-right tabular-nums">{i + 1}</span>
                <span className="text-xs font-medium">{word}</span>
              </div>
            ))}
          </div>
          <div className="bg-yellow-500/5 border border-yellow-500/10 rounded-2xl p-3.5">
            <p className="text-xs text-yellow-200/70">
              Store this phrase securely offline. Never share it with anyone.
            </p>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-4 py-3 shrink-0 space-y-2">
          <button
            onClick={() => submitWallet(mnemonic)}
            disabled={loading}
            className="btn-primary flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Spinner size="sm" />
                Adding wallet...
              </>
            ) : (
              "I've saved it — Add Wallet"
            )}
          </button>
          <button
            onClick={() => navigate("/")}
            disabled={loading}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      </Layout>
    );
  }

  // Step: import mnemonic
  return (
    <Layout title="Import Wallet" showBack={false} showNav={false}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="text-xs text-surface-500">
          Enter the 12 or 24-word recovery phrase for the wallet you want to add.
        </p>
        <textarea
          value={importInput}
          onChange={(e) => {
            setImportInput(e.target.value);
            setError("");
          }}
          placeholder="Enter recovery phrase..."
          rows={4}
          className="input-field resize-none font-mono text-sm"
          autoFocus
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
      <div className="px-4 py-3 space-y-2 shrink-0">
        <button
          onClick={handleImportContinue}
          disabled={!importInput.trim() || loading}
          className="btn-primary flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Spinner size="sm" />
              Adding wallet...
            </>
          ) : (
            "Import & Add Wallet"
          )}
        </button>
        <button
          onClick={() => { setStep("choose"); setError(""); }}
          disabled={loading}
          className="btn-secondary"
        >
          Back
        </button>
      </div>
    </Layout>
  );
}
