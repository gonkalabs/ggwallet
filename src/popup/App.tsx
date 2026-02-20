import { Routes, Route, Navigate } from "react-router-dom";
import { useWalletStore } from "@/popup/store";
import { useEffect, useState } from "react";
import Welcome from "@/popup/pages/Welcome";
import CreateWallet from "@/popup/pages/CreateWallet";
import ImportWallet from "@/popup/pages/ImportWallet";
import SetPassword from "@/popup/pages/SetPassword";
import Unlock from "@/popup/pages/Unlock";
import Dashboard from "@/popup/pages/Dashboard";
import Send from "@/popup/pages/Send";
import Receive from "@/popup/pages/Receive";
import Transactions from "@/popup/pages/Transactions";
import Settings from "@/popup/pages/Settings";
import AddWallet from "@/popup/pages/AddWallet";
import Proposals from "@/popup/pages/Proposals";
import ProposalDetail from "@/popup/pages/ProposalDetail";
import CreateProposal from "@/popup/pages/CreateProposal";
import Spinner from "@/popup/components/Spinner";

export default function App() {
  const { isInitialized, isUnlocked, checkState } = useWalletStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkState().finally(() => setLoading(false));
  }, [checkState]);

  if (loading) {
    return (
      <div className="w-[380px] h-[600px] flex items-center justify-center bg-surface-950">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="w-[380px] h-[600px] flex flex-col bg-surface-950 text-white overflow-hidden animate-popup-in">
      <Routes>
        {!isInitialized ? (
          <>
            <Route path="/" element={<Welcome />} />
            <Route path="/create" element={<CreateWallet />} />
            <Route path="/import" element={<ImportWallet />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : !isUnlocked ? (
          <>
            <Route path="/" element={<Unlock />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/proposals" element={<Proposals />} />
            <Route path="/proposals/create" element={<CreateProposal />} />
            <Route path="/proposals/:id" element={<ProposalDetail />} />
            <Route path="/add-wallet" element={<AddWallet />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </div>
  );
}
