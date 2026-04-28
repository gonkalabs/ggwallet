/**
 * In-popup banner that warns about rpc.gonka.gg free-tier quota usage.
 *
 *   < 20% of the day quota remaining → soft banner with link to upgrade.
 *   <  5% remaining                  → upgraded styling, persistent.
 *   = 0  remaining (429 was hit)     → persistent error variant; the
 *                                       caller that hit 429 also surfaces
 *                                       a modal (not part of this banner).
 *
 * Dismissals are throttled to once per UTC day via
 * KEYS.GONKA_RPC_LAST_NEAR_LIMIT_NOTICE so the banner doesn't nag.
 *
 * Rendered inside Layout above the main scroll area; gracefully no-ops
 * when there's no auto-key state, when the user is on public RPC, or
 * when usage is healthy.
 */

import { useEffect, useState } from "react";
import { sendMessage } from "@/lib/messaging";
import { GONKA_RPC_SIGNUP_URL } from "@/lib/rpc";
import {
  KEYS,
  type GonkaRpcUsage,
  type GonkaRpcProviderPref,
} from "@/lib/storage";

const SOFT_THRESHOLD = 0.2;   // remaining < 20% → soft warning
const HARD_THRESHOLD = 0.05;  // remaining < 5%  → hard warning

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function RpcUsageBanner() {
  const [usage, setUsage] = useState<GonkaRpcUsage | null>(null);
  const [providerPref, setProviderPref] = useState<GonkaRpcProviderPref>("gonka");
  const [dismissedDate, setDismissedDate] = useState<string | null>(null);
  const [hasManualKey, setHasManualKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [stateResp, prefResp, manualResp] = await Promise.all([
        sendMessage({ type: "GET_GONKA_AUTO_KEY_STATE" }),
        sendMessage({ type: "GET_RPC_PROVIDER_PREF" }),
        sendMessage({ type: "GET_GONKA_RPC_KEY" }),
      ]);
      if (cancelled) return;
      setUsage(stateResp?.state?.usage || null);
      setProviderPref(prefResp?.pref === "public" ? "public" : "gonka");
      setHasManualKey(!!manualResp?.key);

      try {
        const last = await new Promise<string | undefined>((resolve) =>
          chrome.storage.local.get(KEYS.GONKA_RPC_LAST_NEAR_LIMIT_NOTICE, (r) =>
            resolve(r[KEYS.GONKA_RPC_LAST_NEAR_LIMIT_NOTICE]),
          ),
        );
        if (!cancelled) setDismissedDate(last || null);
      } catch {
        /* ignore */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Show nothing for users on a manual paid key (their tier handles itself),
  // or on public RPC, or when we don't have usage data yet.
  if (hasManualKey || providerPref === "public" || !usage) return null;
  if (usage.limitDay <= 0) return null;

  const remainingFrac = usage.remainingDay / usage.limitDay;
  if (remainingFrac >= SOFT_THRESHOLD) return null;

  const hard = remainingFrac < HARD_THRESHOLD;
  const exhausted = usage.remainingDay <= 0;

  // Soft banner respects the once-per-day dismissal; hard / exhausted banners
  // are persistent until the quota refills.
  if (!hard && dismissedDate === todayUtc()) return null;

  const handleDismiss = () => {
    const today = todayUtc();
    chrome.storage.local
      .set({ [KEYS.GONKA_RPC_LAST_NEAR_LIMIT_NOTICE]: today })
      .catch(() => {});
    setDismissedDate(today);
  };

  const tone = exhausted
    ? { border: "border-red-500/50", text: "text-red-300", title: "FREE TIER EXHAUSTED" }
    : hard
    ? { border: "border-amber-500/50", text: "text-amber-300", title: "RPC USAGE 95%" }
    : { border: "border-white/20", text: "text-white/85", title: "RPC USAGE 80%" };

  const used = usage.limitDay - usage.remainingDay;

  return (
    <div className={`mx-3 mt-2 led-panel border ${tone.border}`}>
      <div className="flex items-start gap-2 p-3">
        <span className="led-eyebrow-dot mt-1 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className={`led-text text-[10px] font-extrabold ${tone.text} led-glow-soft`}>
            {tone.title}
          </p>
          <p className="led-text text-[10px] font-medium text-white/65" style={{ letterSpacing: "0.04em" }}>
            {used.toLocaleString()} / {usage.limitDay.toLocaleString()} requests today.
            {exhausted
              ? " RPC calls are blocked until the daily quota resets."
              : " Get a personal key for higher limits."}
          </p>
          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={() =>
                chrome.tabs.create({ url: `${GONKA_RPC_SIGNUP_URL}/?upgrade=1&from=ext` })
              }
              className="led-text px-2.5 py-1 text-[9px] font-extrabold text-white border border-white/25 hover:border-white/50 hover:bg-white/5 rounded-[3px] transition-colors"
            >
              GET PERSONAL KEY ↗
            </button>
            {!hard && (
              <button
                onClick={handleDismiss}
                className="led-text px-2.5 py-1 text-[9px] font-extrabold text-white/55 hover:text-white transition-colors"
              >
                DISMISS
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
