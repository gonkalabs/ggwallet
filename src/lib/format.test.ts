import { describe, it, expect } from "vitest";
import { toDisplay, toMinimal, formatGNK, formatCompact, truncateAddress } from "./format";

describe("toDisplay – ngonka to GNK", () => {
  it("converts whole numbers", () => {
    expect(toDisplay("1000000000")).toBe("1");
    expect(toDisplay("5000000000")).toBe("5");
  });

  it("converts fractional amounts", () => {
    expect(toDisplay("1500000000")).toBe("1.5");
    expect(toDisplay("1230000000")).toBe("1.23");
  });

  it("handles zero", () => {
    expect(toDisplay("0")).toBe("0");
  });

  it("handles sub-one amounts", () => {
    expect(toDisplay("500000000")).toBe("0.5");
    expect(toDisplay("1")).toBe("0.000000001");
  });

  it("strips trailing zeroes from fractional part", () => {
    expect(toDisplay("1000100000")).toBe("1.0001");
  });

  it("accepts bigint input", () => {
    expect(toDisplay(2000000000n)).toBe("2");
  });
});

describe("toMinimal – GNK to ngonka", () => {
  it("converts whole numbers", () => {
    expect(toMinimal("1")).toBe("1000000000");
    expect(toMinimal("5")).toBe("5000000000");
  });

  it("converts fractional amounts", () => {
    expect(toMinimal("1.5")).toBe("1500000000");
    expect(toMinimal("0.000000001")).toBe("1");
  });

  it("handles zero", () => {
    expect(toMinimal("0")).toBe("0");
  });

  it("truncates excess decimals beyond 9 places", () => {
    expect(toMinimal("1.0000000001")).toBe("1000000000");
  });
});

describe("formatGNK", () => {
  it("formats with denom label", () => {
    expect(formatGNK("1000000000")).toBe("1 GNK");
    expect(formatGNK("1500000000")).toBe("1.5 GNK");
  });
});

describe("formatCompact", () => {
  it("limits decimal places", () => {
    expect(formatCompact("1123456789", 4)).toBe("1.1234 GNK");
    expect(formatCompact("1123456789", 2)).toBe("1.12 GNK");
  });

  it("removes trailing zeroes", () => {
    expect(formatCompact("1100000000", 4)).toBe("1.1 GNK");
  });

  it("handles whole numbers", () => {
    expect(formatCompact("1000000000")).toBe("1 GNK");
  });
});

describe("truncateAddress", () => {
  it("truncates a long address", () => {
    const addr = "gonka1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
    const result = truncateAddress(addr);
    expect(result).toMatch(/^gonka1qypq\.\.\.lzv7xu$/);
  });

  it("returns short addresses unchanged", () => {
    const short = "gonka1abc";
    expect(truncateAddress(short)).toBe(short);
  });
});
