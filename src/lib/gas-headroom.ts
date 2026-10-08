/**
 * User-controlled gas headroom.
 *
 * Gonka simulation underestimates execution. A bank send padded by CosmJS's
 * 1.4× was submitted with gasWanted 96,526 and failed at gasUsed 96,667
 * (about 1.41× the simulated gas). 1.5× is the minimum that clears that
 * miss. 2.0× is the recommended setting.
 */

export const GAS_HEADROOM_MIN = 1;
export const GAS_HEADROOM_MAX = 3;
export const GAS_HEADROOM_STEP = 0.1;
export const GAS_HEADROOM_RECOMMENDED = 2;
/** Below this, the last observed send runs out of gas. */
export const GAS_HEADROOM_MIN_SAFE = 1.5;

export function clampGasHeadroom(value: number): number {
  if (!Number.isFinite(value)) return GAS_HEADROOM_RECOMMENDED;
  const stepped = Math.round(value / GAS_HEADROOM_STEP) * GAS_HEADROOM_STEP;
  const clamped = Math.min(GAS_HEADROOM_MAX, Math.max(GAS_HEADROOM_MIN, stepped));
  return Math.round(clamped * 10) / 10;
}

export function gasLimitForHeadroom(gasUsed: number, multiplier: number): number {
  const used = Number.isFinite(gasUsed) && gasUsed > 0 ? gasUsed : 0;
  return Math.ceil(used * clampGasHeadroom(multiplier));
}

/**
 * True when this multiplier leaves the gas limit under the execution gas
 * we have already seen on Gonka (about 1.5× simulated gas).
 */
export function headroomWillFail(gasUsed: number, multiplier: number): boolean {
  const applied = clampGasHeadroom(multiplier);
  if (!Number.isFinite(gasUsed) || gasUsed <= 0) {
    return applied < GAS_HEADROOM_MIN_SAFE;
  }
  return gasLimitForHeadroom(gasUsed, applied) < Math.ceil(gasUsed * GAS_HEADROOM_MIN_SAFE);
}
