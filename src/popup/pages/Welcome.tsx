import { useNavigate } from "react-router-dom";
import logo from "@/assets/ggwallet.png";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-between h-[600px] px-6 py-10">
      <div className="led-eyebrow">
        <span className="led-eyebrow-dot" />
        Gonka Labs · Wallet
      </div>

      <div className="flex flex-col items-center text-center animate-fade-in-up">
        <img
          src={logo}
          alt="GG Wallet"
          className="w-20 h-20 mb-6 rounded-3xl"
          style={{ boxShadow: "0 0 24px -4px rgba(255,255,255,0.4)" }}
        />
        <h1 className="led-title text-3xl mb-3">GG Wallet</h1>
        <p className="led-text text-[11px] font-medium text-white/55 leading-relaxed max-w-[280px]" style={{ letterSpacing: "0.05em" }}>
          An open-source wallet to interact with the Gonka.ai blockchain —
          send, receive, stake, and more.
        </p>
      </div>

      <div className="w-full space-y-3 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
        <button onClick={() => navigate("/create")} className="btn-primary">
          ▶ Create New Wallet
        </button>
        <button onClick={() => navigate("/import")} className="btn-secondary">
          Import Existing Wallet
        </button>

        <p className="led-text text-center pt-2 text-[10px] font-bold text-white/30">
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
    </div>
  );
}
