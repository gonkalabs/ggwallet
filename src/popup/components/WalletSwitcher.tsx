import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { truncateAddress } from "@/lib/format";

export default function WalletSwitcher() {
  const navigate = useNavigate();
  const { wallets, activeIndex, switchWallet, getBalance } = useWalletStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeWallet = wallets[activeIndex];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSwitch = async (index: number) => {
    if (index === activeIndex) {
      setOpen(false);
      return;
    }
    const ok = await switchWallet(index);
    if (ok) {
      setOpen(false);
      getBalance();
    }
  };

  if (!activeWallet) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-all duration-150 max-w-[200px]"
      >
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-gonka-400 to-gonka-600 flex items-center justify-center text-[10px] font-bold text-surface-950 shrink-0">
          {activeWallet.name.charAt(0).toUpperCase()}
        </div>
        <span className="text-xs font-medium truncate">{activeWallet.name}</span>
        <svg
          className={`w-3 h-3 text-surface-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-64 bg-surface-900 border border-white/[0.06] rounded-2xl shadow-card z-50 overflow-hidden animate-scale-in origin-top-left">
          <div className="max-h-[240px] overflow-y-auto py-1">
            {wallets.map((w, i) => (
              <button
                key={i}
                onClick={() => handleSwitch(i)}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${
                  i === activeIndex
                    ? "bg-gonka-500/10"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === activeIndex
                      ? "bg-gradient-to-br from-gonka-400 to-gonka-600 text-surface-950"
                      : "bg-white/[0.06] text-surface-400"
                  }`}
                >
                  {w.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.name}</p>
                  <p className="text-[10px] font-mono text-surface-500 truncate">
                    {truncateAddress(w.address, 10, 6)}
                  </p>
                </div>
                {i === activeIndex && (
                  <svg className="w-4 h-4 text-gonka-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-white/[0.04] p-1">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/add-wallet");
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-left rounded-xl hover:bg-white/[0.04] transition-colors text-gonka-400"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span className="text-sm font-medium">Add Wallet</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
