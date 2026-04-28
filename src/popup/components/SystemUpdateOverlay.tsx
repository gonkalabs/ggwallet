/**
 * Static "system is updating" overlay. Mounted at the App root and
 * shown only while the wallet is finishing one-time setup work in
 * the background — primarily the first-install RPC key acquisition.
 *
 * The overlay shows when ALL of the following are true at popup open:
 *   - the user hasn't opted out to public RPC,
 *   - no auto-issued rpc.gonka.gg key is in storage yet,
 *   - no manual key is in storage either.
 *
 * It dismisses as soon as a key shows up, OR after a hard timeout
 * (so a flaky network never blocks the wallet UI). The popup also
 * nudges the service worker via ENSURE_GONKA_AUTO_KEY in case the
 * SW had already finished issuance and forgotten about it.
 */

import { useEffect, useState } from "react";
import { sendMessage } from "@/lib/messaging";
import Spinner from "./Spinner";

const TIMEOUT_MS = 20_000;
const POLL_MS = 700;

export default function SystemUpdateOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const init = async () => {
      const [stateResp, manualResp, prefResp] = await Promise.all([
        sendMessage({ type: "GET_GONKA_AUTO_KEY_STATE" }),
        sendMessage({ type: "GET_GONKA_RPC_KEY" }),
        sendMessage({ type: "GET_RPC_PROVIDER_PREF" }),
      ]);
      if (cancelled) return;

      const hasKey = !!(stateResp?.state?.apiKey || manualResp?.key);
      const optedOut = prefResp?.pref === "public";

      if (hasKey || optedOut) return;

      setVisible(true);

      // Nudge the SW to (re-)run issuance in case the listener was
      // missed (e.g. the SW spun down before chrome.runtime.onInstalled).
      sendMessage({ type: "ENSURE_GONKA_AUTO_KEY" }).catch(() => {});

      const startedAt = Date.now();
      const poll = async () => {
        if (cancelled) return;
        const s = await sendMessage({ type: "GET_GONKA_AUTO_KEY_STATE" });
        if (cancelled) return;
        if (s?.state?.apiKey) {
          setVisible(false);
          return;
        }
        if (Date.now() - startedAt >= TIMEOUT_MS) {
          // Give up — the wallet falls back to public RPC; the in-popup
          // banner covers the "issuance failed" state from here on.
          setVisible(false);
          return;
        }
        timer = window.setTimeout(poll, POLL_MS);
      };
      timer = window.setTimeout(poll, POLL_MS);
    };

    init();

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-led-bg/95 flex items-center justify-center p-5">
      <div className="led-bezel w-full">
        <div className="led-display p-6 space-y-5">
          <p className="led-eyebrow">
            <span className="led-eyebrow-dot" />
            System Update
          </p>

          <div className="space-y-2">
            <h2 className="led-title text-base">Updating services…</h2>
            <p className="led-text text-[11px] font-medium text-white/65 leading-relaxed" style={{ letterSpacing: "0.04em" }}>
              Just a moment while the wallet finishes setting things up.
            </p>
          </div>

          <div className="led-divider-top pt-4 flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
