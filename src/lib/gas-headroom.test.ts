import { describe, it, expect } from "vitest";
import {
  clampGasHeadroom,
  gasLimitForHeadroom,
  headroomWillFail,
  GAS_HEADROOM_RECOMMENDED,
} from "./gas-headroom";

describe("clampGasHeadroom", () => {
  it("snaps to a tenth and stays inside 1.0–3.0", () => {
    expect(clampGasHeadroom(1.44)).toBe(1.4);
    expect(clampGasHeadroom(0.2)).toBe(1);
    expect(clampGasHeadroom(9)).toBe(3);
    expect(clampGasHeadroom(Number.NaN)).toBe(GAS_HEADROOM_RECOMMENDED);
  });
});

describe("headroomWillFail", () => {
  const simulated = 68947;

  it("rejects 1.4×, which ran out of gas on chain", () => {
    expect(gasLimitForHeadroom(simulated, 1.4)).toBe(96526);
    expect(headroomWillFail(simulated, 1.4)).toBe(true);
  });

  it("accepts the 1.5× minimum and the recommended 2.0×", () => {
    expect(headroomWillFail(simulated, 1.5)).toBe(false);
    expect(headroomWillFail(simulated, 2)).toBe(false);
    expect(gasLimitForHeadroom(simulated, 1.5)).toBeGreaterThan(96667);
  });
});
