// 2-decimal contract scale testes
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { toContractScale } from "../src/utils.js";

describe("toContractScale", () => {
  it("scales 6-decimal (USDC) amounts: 5 USDC -> 500", () => {
    assert.equal(toContractScale(5_000_000n, 6), 500n);
  });

  it("scales 18-decimal amounts: 1 token -> 100", () => {
    assert.equal(toContractScale(1_000_000_000_000_000_000n, 18), 100n);
  });

  it("accepts string / number / bigint for both amount and decimals", () => {
    assert.equal(toContractScale("5000000", 6), 500n);
    assert.equal(toContractScale(5000000, 6), 500n);
    assert.equal(toContractScale(5_000_000n, 6n), 500n);
  });

  it("returns a bigint", () => {
    assert.equal(typeof toContractScale(5_000_000n, 6), "bigint");
  });

  it("throws when the amount rounds to 0 in contract scale", () => {
    assert.throws(() => toContractScale(1000n, 6), /Amount too small/); // 0.001 USDC
    assert.throws(() => toContractScale(9999n, 6), /Amount too small/); // 0.009999 USDC
    assert.throws(() => toContractScale(0n, 6), /Amount too small/);
  });

  describe("sub-cent remainder handling", () => {
    let warnings;
    let originalWarn;
    beforeEach(() => {
      warnings = [];
      originalWarn = console.warn;
      console.warn = (...a) => warnings.push(a.join(" "));
    });
    afterEach(() => {
      console.warn = originalWarn;
    });

    it("warns and floors when a sub-cent remainder is dropped", () => {
      const scaled = toContractScale(5_000_001n, 6); // 500.0001 -> 500
      assert.equal(scaled, 500n);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /not fully representable/);
    });

    it("does not warn when the amount is exactly representable", () => {
      toContractScale(5_000_000n, 6);
      assert.equal(warnings.length, 0);
    });
  });
});
