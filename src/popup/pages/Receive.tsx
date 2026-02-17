import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useWalletStore } from "@/popup/store";
import Layout from "@/popup/components/Layout";

export default function Receive() {
  const { address } = useWalletStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout title="Receive GNK" showBack showNav={false}>
      <div className="flex flex-col items-center px-6 py-8 space-y-6">
        {/* QR Code */}
        <div className="bg-white p-4 rounded-3xl shadow-card">
          <QRCodeSVG
            value={address}
            size={192}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>

        {/* Address */}
        <div className="w-full">
          <p className="text-xs text-surface-500 text-center mb-2">
            Your Gonka Address
          </p>
          <div className="bg-white/[0.03] rounded-2xl p-4">
            <p className="text-xs font-mono text-surface-300 break-all text-center leading-relaxed">
              {address}
            </p>
          </div>
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="btn-primary flex items-center justify-center gap-2"
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
              Copy Address
            </>
          )}
        </button>

        <p className="text-xs text-surface-600 text-center max-w-[260px]">
          Only send GNK (ngonka) tokens to this address. Sending other tokens
          may result in permanent loss.
        </p>
      </div>
    </Layout>
  );
}
