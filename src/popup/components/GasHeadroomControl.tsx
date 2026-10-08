import { formatCompact } from "@/lib/format";
import {
  GAS_HEADROOM_MAX,
  GAS_HEADROOM_MIN,
  GAS_HEADROOM_MIN_SAFE,
  GAS_HEADROOM_RECOMMENDED,
  GAS_HEADROOM_STEP,
  clampGasHeadroom,
  gasLimitForHeadroom,
  headroomWillFail,
} from "@/lib/gas-headroom";

interface Props {
  value: number;
  onChange: (multiplier: number) => void;
  /** Raw simulated gas. When set, the control shows this transaction's fee. */
  gasUsed?: number | null;
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(1)}×`;
}

function formatGas(gas: number): string {
  return `${gas.toLocaleString("en-US")} gas`;
}

export default function GasHeadroomControl({ value, onChange, gasUsed }: Props) {
  const hasSimulation = gasUsed != null && gasUsed > 0;
  const appliedGas = hasSimulation ? gasLimitForHeadroom(gasUsed, value) : null;
  const requiredGas = hasSimulation ? Math.ceil(gasUsed * GAS_HEADROOM_MIN_SAFE) : null;
  const willFail = headroomWillFail(gasUsed ?? 0, value);
  const isRecommended = value === GAS_HEADROOM_RECOMMENDED;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-surface-500">Gas headroom</span>
        <span className="text-sm font-bold text-white">{formatMultiplier(value)}</span>
      </div>

      <input
        type="range"
        min={GAS_HEADROOM_MIN}
        max={GAS_HEADROOM_MAX}
        step={GAS_HEADROOM_STEP}
        value={value}
        aria-label="Gas headroom"
        onChange={(event) => onChange(clampGasHeadroom(Number(event.target.value)))}
        className="w-full accent-white"
      />

      <div className="flex items-center justify-between text-[10px] text-surface-500">
        <span>{formatMultiplier(GAS_HEADROOM_MIN)}</span>
        <button
          type="button"
          onClick={() => onChange(GAS_HEADROOM_RECOMMENDED)}
          className={`font-semibold ${isRecommended ? "text-gonka-400" : "text-surface-400 hover:text-white"}`}
        >
          Recommended {formatMultiplier(GAS_HEADROOM_RECOMMENDED)}
        </button>
        <span>{formatMultiplier(GAS_HEADROOM_MAX)}</span>
      </div>

      {appliedGas != null && (
        <div className="flex justify-between text-sm">
          <span className="text-surface-500">Applied fee</span>
          <span className="text-surface-300 text-right">
            {formatCompact(String(appliedGas))}
            <span className="block text-[10px] text-surface-500">{formatGas(appliedGas)}</span>
          </span>
        </div>
      )}

      <div
        className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${
          willFail
            ? "bg-red-500/10 text-red-300 border border-red-500/20"
            : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
        }`}
      >
        <p className="font-semibold">{willFail ? "Will fail" : "Will clear"}</p>
        <p className="mt-0.5 text-[11px] opacity-90">
          {willFail
            ? `Under ${formatMultiplier(GAS_HEADROOM_MIN_SAFE)}. A send at 1.4× ran out of gas on Gonka.`
            : `At least ${formatMultiplier(GAS_HEADROOM_MIN_SAFE)} simulated gas.`}
          {requiredGas != null ? ` This transaction needs ${formatGas(requiredGas)}.` : ""}
        </p>
      </div>
    </div>
  );
}
