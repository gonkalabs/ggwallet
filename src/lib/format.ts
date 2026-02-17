import { GONKA_DECIMALS, GONKA_DISPLAY_DENOM, GONKA_DENOM } from "./gonka";

/**
 * Convert minimal denom (ngonka) to display denom (GNK).
 * 1 GNK = 1,000,000,000 ngonka
 */
export function toDisplay(amount: string | bigint): string {
  const raw = BigInt(amount);
  const divisor = BigInt(10 ** GONKA_DECIMALS);
  const whole = raw / divisor;
  const frac = raw % divisor;

  if (frac === 0n) {
    return whole.toString();
  }

  const fracStr = frac.toString().padStart(GONKA_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Convert display denom (GNK) to minimal denom (ngonka).
 */
export function toMinimal(displayAmount: string): string {
  const parts = displayAmount.split(".");
  const whole = parts[0] || "0";
  let frac = parts[1] || "";

  if (frac.length > GONKA_DECIMALS) {
    frac = frac.slice(0, GONKA_DECIMALS);
  } else {
    frac = frac.padEnd(GONKA_DECIMALS, "0");
  }

  const raw = BigInt(whole) * BigInt(10 ** GONKA_DECIMALS) + BigInt(frac);
  return raw.toString();
}

/**
 * Format display amount with denom label.
 */
export function formatGNK(amount: string | bigint): string {
  return `${toDisplay(amount)} ${GONKA_DISPLAY_DENOM}`;
}

/**
 * Format a minimal denom amount for compact display (e.g., "1.23 GNK").
 * Shows up to `maxDecimals` decimal places.
 */
export function formatCompact(amount: string | bigint, maxDecimals = 4): string {
  const display = toDisplay(amount);
  const parts = display.split(".");
  if (parts.length === 1) return `${display} ${GONKA_DISPLAY_DENOM}`;

  const trimmed = parts[1].slice(0, maxDecimals).replace(/0+$/, "");
  if (!trimmed) return `${parts[0]} ${GONKA_DISPLAY_DENOM}`;
  return `${parts[0]}.${trimmed} ${GONKA_DISPLAY_DENOM}`;
}

/**
 * Truncate a bech32 address for display: gonka1abc...xyz
 */
export function truncateAddress(address: string, startLen = 10, endLen = 6): string {
  if (address.length <= startLen + endLen + 3) return address;
  return `${address.slice(0, startLen)}...${address.slice(-endLen)}`;
}

/**
 * Format a timestamp into a human-readable relative or absolute string.
 */
export function formatTimestamp(ts: string | number): string {
  const date = new Date(typeof ts === "string" ? ts : ts * 1000);
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}
