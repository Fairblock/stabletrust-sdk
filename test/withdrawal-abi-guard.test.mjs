import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ConfidentialTransferClient } from "../src/index.js";
import { CONTRACT_ABI } from "../src/constants.js";

function runGuard(abi) {
  const client = Object.create(ConfidentialTransferClient.prototype);
  client.contract = { interface: new ethers.Interface(abi) };
  return () => client._assertLatestContractAbi();
}

test("fee-aware ABI guard accepts the current withdrawal fee ABI", () => {
  assert.doesNotThrow(runGuard(CONTRACT_ABI));
});

test("fee-aware ABI guard rejects a pre-withdrawal-fee ABI", () => {
  const stale = CONTRACT_ABI.filter(
    (fragment) =>
      !fragment.includes("nonAnonymousWithdrawFee()") &&
      !fragment.includes("nonAnonymousWithdrawFeePpm()") &&
      !fragment.includes("anonymousWithdrawFeePpm()"),
  );

  assert.throws(runGuard(stale), /nonAnonymousWithdrawFee\(\)/);
  assert.throws(runGuard(stale), /nonAnonymousWithdrawFeePpm\(\)/);
  assert.throws(runGuard(stale), /anonymousWithdrawFeePpm\(\)/);
});
