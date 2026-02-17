import { useNavigate } from "react-router-dom";
import logo from "@/assets/ggwallet.png";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-between h-[600px] px-6 py-10 bg-surface-950">
      <div />

      <div className="flex flex-col items-center text-center animate-fade-in-up">
        <img src={logo} alt="GG Wallet" className="w-20 h-20 mb-6 rounded-3xl shadow-glow" />
        <h1 className="text-2xl font-bold tracking-tight mb-2">GG Wallet</h1>
        <p className="text-surface-400 text-sm leading-relaxed max-w-[280px]">
          An open-source wallet to interact with the
          Gonka.ai blockchain — send, receive, stake, and more.
        </p>
      </div>

      <div className="w-full space-y-3 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
        <button onClick={() => navigate("/create")} className="btn-primary">
          Create New Wallet
        </button>
        <button onClick={() => navigate("/import")} className="btn-secondary">
          Import Existing Wallet
        </button>

        <p className="text-center pt-2 text-xs text-surface-600">
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
    </div>
  );
}
