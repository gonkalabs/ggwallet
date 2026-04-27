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
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all duration-150 max-w-[200px]"
      >
        <div className="w-5 h-5 rounded-[3px] bg-white flex items-center justify-center text-[10px] font-extrabold text-surface-950 shrink-0 led-text" style={{ boxShadow: "0 0 6px rgba(255,255,255,0.4)" }}>
          {activeWallet.name.charAt(0).toUpperCase()}
        </div>
        <span className="led-text text-[11px] font-bold text-white truncate">
          {activeWallet.name}
        </span>
        <svg
          className={`w-3 h-3 text-white/40 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-64 led-bezel z-50 animate-scale-in origin-top-left">
          <div className="led-display">
            <div className="max-h-[240px] overflow-y-auto py-1">
              {wallets.map((w, i) => (
                <button
                  key={i}
                  onClick={() => handleSwitch(i)}
                  className={`flex items-center gap-2.5 w-full px-3 py-2.5 text-left transition-colors ${
                    i === activeIndex
                      ? "bg-white/[0.06]"
                      : "hover:bg-white/[0.04]"
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-[3px] flex items-center justify-center text-xs font-extrabold shrink-0 led-text ${
                      i === activeIndex
                        ? "bg-white text-surface-950"
                        : "bg-white/[0.08] text-white/70"
                    }`}
                    style={i === activeIndex ? { boxShadow: "0 0 8px rgba(255,255,255,0.4)" } : undefined}
                  >
                    {w.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="led-text text-[12px] font-bold text-white truncate">
                      {w.name}
                    </p>
                    <p className="led-text text-[9px] font-medium text-white/40 truncate">
                      {truncateAddress(w.address, 10, 6)}
                    </p>
                  </div>
                  {i === activeIndex && (
                    <svg className="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            <div className="led-divider-top p-1">
              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/add-wallet");
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 text-left rounded-xl hover:bg-white/[0.04] transition-colors text-white"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="led-text text-[11px] font-bold">Add Wallet</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
