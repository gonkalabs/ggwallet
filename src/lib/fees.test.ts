import { describe, it, expect } from "vitest";
import { AuthInfo, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { Any } from "cosmjs-types/google/protobuf/any";
import {
  feeForSimulatedGas,
  raiseAminoFee,
  raiseDirectAuthInfoFee,
  requiredNgonkaFee,
} from "./fees";

describe("requiredNgonkaFee", () => {
  it("charges 1 ngonka per gas", () => {
    expect(requiredNgonkaFee(96526)).toBe("96526");
  });

  it("returns 0 when there is no gas limit", () => {
    expect(requiredNgonkaFee(0)).toBe("0");
  });
});

describe("feeForSimulatedGas", () => {
  it("prices the recommended 2× headroom at 1 ngonka per gas", () => {
    const fee = feeForSimulatedGas(68947);
    expect(Number(fee.gas)).toBeGreaterThan(96667);
    expect(fee.amount).toBe(fee.gas);
  });

  it("prices a caller-supplied multiplier", () => {
    const fee = feeForSimulatedGas(1000, 1.5);
    expect(fee.gas).toBe("1500");
    expect(fee.amount).toBe("1500");
  });
});

describe("raiseAminoFee", () => {
  it("replaces a zero fee with gas × 1ngonka", () => {
    const fee = raiseAminoFee(
      { gas: "96526", amount: [{ denom: "ngonka", amount: "0" }] },
      ["cosmos-sdk/MsgSend"]
    );
    expect(fee.amount).toEqual([{ denom: "ngonka", amount: "96526" }]);
  });

  it("leaves a fee that already meets the minimum", () => {
    const original = { gas: "1000", amount: [{ denom: "ngonka", amount: "5000" }] };
    expect(raiseAminoFee(original, ["cosmos-sdk/MsgSend"])).toEqual(original);
  });

  it("does not charge governance votes", () => {
    const original = { gas: "80000", amount: [] as { denom: string; amount: string }[] };
    expect(raiseAminoFee(original, ["cosmos-sdk/MsgVote"])).toEqual(original);
  });
});

describe("raiseDirectAuthInfoFee", () => {
  function encode(typeUrl: string, gasLimit: number, feeAmount: string) {
    const body = TxBody.encode(
      TxBody.fromPartial({
        messages: [Any.fromPartial({ typeUrl, value: new Uint8Array() })],
      })
    ).finish();
    const auth = AuthInfo.encode(
      AuthInfo.fromPartial({
        fee: { amount: [{ denom: "ngonka", amount: feeAmount }], gasLimit: BigInt(gasLimit) },
      })
    ).finish();
    return { body, auth };
  }

  it("raises a zero direct fee to the gas limit", () => {
    const { body, auth } = encode("/cosmos.bank.v1beta1.MsgSend", 96526, "0");
    const next = raiseDirectAuthInfoFee(auth, body);
    const decoded = AuthInfo.decode(next);
    expect(decoded.fee?.amount[0]?.amount).toBe("96526");
  });

  it("leaves a vote-only direct fee at zero", () => {
    const { body, auth } = encode("/cosmos.gov.v1beta1.MsgVote", 80000, "0");
    const next = raiseDirectAuthInfoFee(auth, body);
    expect(next).toBe(auth);
  });
});
