// the stale-ABI fail-fast guard `_assertLatestContractAbi`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ConfidentialTransferClient } from "../src/confidential-client.js";
import {
  CONTRACT_ABI,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
} from "../src/constants.js";

const REQUIRED = [
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
];

// Build a client instance without the constructor, then point the guard at a
// contract whose interface is built from `abi`
function runGuard(abi) {
  const client = Object.create(ConfidentialTransferClient.prototype);
  client.contract = { interface: new ethers.Interface(abi) };
  return () => client._assertLatestContractAbi();
}

describe("_assertLatestContractAbi (stale-ABI fail-fast guard)", () => {
  it("passes on the current full ABI (all six required signatures present)", () => {
    assert.doesNotThrow(runGuard(CONTRACT_ABI));
  });

  it("THROWS when transferConfidential is the old 3-arg form (missing bytes,bool)", () => {
    const stale = CONTRACT_ABI.map((f) =>
      f.includes("transferConfidential")
        ? "function transferConfidential(address,address,bytes) external payable"
        : f,
    );
    assert.throws(runGuard(stale), /stale or incomplete/);
    assert.throws(runGuard(stale), /transferConfidential\(address,address,bytes,bool\)/);
  });

  it("THROWS when a fee getter is missing (e.g. pre-fee single-feeAmount ABI)", () => {
    const noFeeToken = CONTRACT_ABI.filter((f) => !f.includes("feeToken"));
    assert.throws(runGuard(noFeeToken), /feeToken\(\)/);
  });

  it("names every missing signature in the error message", () => {
    // An interface with none of the required functions.
    const client = Object.create(ConfidentialTransferClient.prototype);
    client.contract = {
      interface: new ethers.Interface([
        "function createConfidentialAccount(bytes elgamalPubkey) external",
      ]),
    };
    let err;
    try {
      client._assertLatestContractAbi();
    } catch (e) {
      err = e;
    }
    assert.ok(err, "guard should have thrown");
    for (const sig of REQUIRED) {
      assert.ok(err.message.includes(sig), `error should list missing signature: ${sig}`);
    }
  });

  // Regression for the exact ethers-v6 pitfall the old try/catch guard missed:
  // getFunction() returns null (not throws) for a missing signature, so a
  // try/catch would silently pass. The current guard must still throw.
  it("catches a stale ABI that ethers-v6 getFunction would have silently returned null for", () => {
    const stale = new ethers.Interface([
      "function transferConfidential(address,address,bytes) external payable",
      "function withdraw(address,uint256,bytes) external",
    ]);
    assert.equal(stale.getFunction(TRANSFER_CONFIDENTIAL_SIGNATURE), null); // does NOT throw
    const client = Object.create(ConfidentialTransferClient.prototype);
    client.contract = { interface: stale };
    assert.throws(() => client._assertLatestContractAbi(), /stale or incomplete/);
  });
});
