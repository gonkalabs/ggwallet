import { GONKA_DECIMALS, GONKA_DISPLAY_DENOM } from "./gonka";

/**
 * Convert minimal denom (ngonka) to display denom (GNK).
 * 1 GNK = 1,000,000,000 ngonka
 */
export function toDisplay(amount: string | bigint | undefined | null): string {
  if (amount === undefined || amount === null || amount === "") return "0";
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
 * Format a minimal denom amount with denom label (e.g., "1.23 GNK").
 * Shows full precision — trailing zeros are stripped but no digits are rounded.
 */
export function formatCompact(amount: string | bigint): string {
  const display = toDisplay(amount);
  return `${display} ${GONKA_DISPLAY_DENOM}`;
}

/**
 * Generic display formatter for any denom with arbitrary decimal places.
 * e.g. toDisplayDecimals("1000000", 6) -> "1"
 */
/**
 * Convert display amount to minimal denom for arbitrary decimal places.
 */
export function toMinimalDecimals(displayAmount: string, decimals: number): string {
  const parts = displayAmount.split(".");
  const whole = parts[0] || "0";
  let frac = parts[1] || "";
  if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  } else {
    frac = frac.padEnd(decimals, "0");
  }
  const raw = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return raw.toString();
}

export function toDisplayDecimals(amount: string | bigint | undefined | null, decimals: number): string {
  if (amount === undefined || amount === null || amount === "") return "0";
  if (decimals === 0) return BigInt(amount).toString();
  const raw = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
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
