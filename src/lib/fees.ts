/**
 * Gonka fee math after the v0.2.16 upgrade.
 *
 * Paid messages must attach at least `gas_limit * 1ngonka`. A fee of 0 is
 * rejected with "insufficient fee: got 0ngonka". Governance votes are exempt.
 *
 * Simulation underestimates execution. The gas limit is simulated gas times
 * the user's headroom multiplier (recommended 2.0×). Below 1.5× a send has
 * already run out of gas on Gonka.
 */

import { calculateFee } from "@cosmjs/stargate";
import { AuthInfo, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { GONKA_DENOM, GONKA_GAS_PRICE } from "./gonka";
import { GAS_HEADROOM_RECOMMENDED, gasLimitForHeadroom } from "./gas-headroom";

export interface FeeCoin {
  denom: string;
  amount: string;
}

export interface AminoFee {
  gas?: string | number;
  amount?: FeeCoin[];
  granter?: string;
  payer?: string;
}

export function requiredNgonkaFee(gasLimit: number): string {
  if (!Number.isFinite(gasLimit) || gasLimit <= 0) return "0";
  const fee = calculateFee(Math.ceil(gasLimit), GONKA_GAS_PRICE);
  return fee.amount.find((coin) => coin.denom === GONKA_DENOM)?.amount ?? "0";
}

/** Fee for a simulated `gasUsed` at the given headroom multiplier. */
export function feeForSimulatedGas(
  gasUsed: number,
  multiplier = GAS_HEADROOM_RECOMMENDED
): { amount: string; gas: string } {
  const gasLimit = gasLimitForHeadroom(gasUsed, multiplier);
  return { amount: requiredNgonkaFee(gasLimit), gas: gasLimit.toString() };
}

function isVoteMessage(type: string | undefined): boolean {
  if (!type) return false;
  return (
    type === "cosmos-sdk/MsgVote" ||
    type === "cosmos-sdk/MsgVoteWeighted" ||
    type.endsWith(".MsgVote") ||
    type.endsWith(".MsgVoteWeighted")
  );
}

function ngonkaAmount(amount: FeeCoin[] | undefined): bigint {
  const coin = (amount ?? []).find((entry) => entry.denom === GONKA_DENOM);
  try {
    return BigInt(coin?.amount || "0");
  } catch {
    return 0n;
  }
}

/**
 * Raise an Amino fee to the chain minimum when the dApp underpaid.
 * Vote-only transactions stay at whatever fee they already have (usually 0).
 */
export function raiseAminoFee<T extends AminoFee>(fee: T, messageTypes: string[]): T {
  if (messageTypes.length > 0 && messageTypes.every(isVoteMessage)) return fee;
  const gas = Number(fee.gas ?? 0);
  if (!Number.isFinite(gas) || gas <= 0) return fee;

  const required = BigInt(requiredNgonkaFee(gas));
  if (ngonkaAmount(fee.amount) >= required) return fee;

  const rest = (fee.amount ?? []).filter((coin) => coin.denom !== GONKA_DENOM);
  return {
    ...fee,
    amount: [...rest, { denom: GONKA_DENOM, amount: required.toString() }],
  };
}

/**
 * Raise the fee inside a direct-sign AuthInfo. Returns the original bytes
 * when the fee is already high enough, the tx is vote-only, or the bytes
 * cannot be decoded.
 */
export function readAuthInfoFee(authInfoBytes: Uint8Array): { coins: FeeCoin[]; gas: string } | null {
  try {
    const authInfo = AuthInfo.decode(authInfoBytes);
    return {
      coins: (authInfo.fee?.amount ?? []).map((coin) => ({
        denom: coin.denom,
        amount: coin.amount,
      })),
      gas: authInfo.fee?.gasLimit?.toString() ?? "0",
    };
  } catch {
    return null;
  }
}

export function raiseDirectAuthInfoFee(authInfoBytes: Uint8Array, bodyBytes: Uint8Array): Uint8Array {
  let voteOnly = false;
  try {
    const body = TxBody.decode(bodyBytes);
    const types = body.messages.map((message) => message.typeUrl);
    voteOnly = types.length > 0 && types.every(isVoteMessage);
  } catch {
    voteOnly = false;
  }
  if (voteOnly) return authInfoBytes;

  try {
    const authInfo = AuthInfo.decode(authInfoBytes);
    const gas = Number(authInfo.fee?.gasLimit ?? 0);
    if (!authInfo.fee || !Number.isFinite(gas) || gas <= 0) return authInfoBytes;

    const required = requiredNgonkaFee(gas);
    const current = authInfo.fee.amount.find((coin) => coin.denom === GONKA_DENOM)?.amount ?? "0";
    if (BigInt(current || "0") >= BigInt(required)) return authInfoBytes;

    const rest = authInfo.fee.amount.filter((coin) => coin.denom !== GONKA_DENOM);
    authInfo.fee.amount = [...rest, { denom: GONKA_DENOM, amount: required }];
    return AuthInfo.encode(authInfo).finish();
  } catch {
    return authInfoBytes;
  }
}
