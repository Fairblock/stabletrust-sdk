// contract ABI signatures + chain address map.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  ERC20_ABI,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  FEE_ACCOUNT_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
  STABLETRUST_CONTRACTS_BY_CHAIN_ID,
  getStabletrustContractAddress,
} from "../src/constants.js";

describe("contract ABI signatures", () => {
  const iface = new ethers.Interface(CONTRACT_ABI);

  it("declares the 4-arg (bytes,bool) transfer + withdraw signatures", () => {
    assert.equal(TRANSFER_CONFIDENTIAL_SIGNATURE, "transferConfidential(address,address,bytes,bool)");
    assert.equal(WITHDRAW_CONFIDENTIAL_SIGNATURE, "withdraw(address,uint256,bytes,bool)");
  });

  it("CONTRACT_ABI contains both 4-arg signatures", () => {
    assert.ok(iface.getFunction(TRANSFER_CONFIDENTIAL_SIGNATURE), "transferConfidential 4-arg missing");
    assert.ok(iface.getFunction(WITHDRAW_CONFIDENTIAL_SIGNATURE), "withdraw 4-arg missing");
  });

  it("withdraw is payable so native fixed request fees can be attached", () => {
    assert.equal(iface.getFunction(WITHDRAW_CONFIDENTIAL_SIGNATURE).stateMutability, "payable");
  });

  it("CONTRACT_ABI no longer contains the old 3-arg signatures", () => {
    assert.equal(iface.getFunction("transferConfidential(address,address,bytes)"), null);
    assert.equal(iface.getFunction("withdraw(address,uint256,bytes)"), null);
  });

  it("ethers v6 getFunction returns null (not throws) for a missing signature", () => {
    const stale = new ethers.Interface([
      "function transferConfidential(address,address,bytes) external payable",
      "function withdraw(address,uint256,bytes) external",
    ]);
    let result;
    assert.doesNotThrow(() => {
      result = stale.getFunction(TRANSFER_CONFIDENTIAL_SIGNATURE);
    });
    assert.equal(result, null);
  });
});

describe("getStabletrustContractAddress + chain map", () => {
  it("resolves known chains (number or string chainId)", () => {
    assert.equal(getStabletrustContractAddress(84532), "0x4a251C9D79faCa20b193630A4ee313af7cBCDD93");
    assert.equal(getStabletrustContractAddress("84532"), "0x4a251C9D79faCa20b193630A4ee313af7cBCDD93");
  });

  it("returns null for unknown / missing chainId", () => {
    assert.equal(getStabletrustContractAddress(999999), null);
    assert.equal(getStabletrustContractAddress(undefined), null);
  });

  it("covers the seven supported chains", () => {
    assert.deepEqual(
      Object.keys(STABLETRUST_CONTRACTS_BY_CHAIN_ID).map(Number).sort((a, b) => a - b),
      [2201, 5042002, 42431, 84532, 42161, 421614, 11155111].sort((a, b) => a - b),
    );
  });

  it("every configured address is a valid, checksummed address", () => {
    for (const [chainId, addr] of Object.entries(STABLETRUST_CONTRACTS_BY_CHAIN_ID)) {
      assert.ok(ethers.isAddress(addr), `chain ${chainId}: "${addr}" is not a valid address`);
      assert.equal(ethers.getAddress(addr), addr, `chain ${chainId}: "${addr}" is not checksummed`);
    }
  });
});

describe("CONTRACT_ABI / ERC20_ABI composition", () => {
  const iface = new ethers.Interface(CONTRACT_ABI);
  const fns = iface.fragments.filter((f) => f.type === "function").map((f) => f.format("sighash"));

  it("exposes exactly the expected 16 functions", () => {
    assert.deepEqual(
      [...fns].sort(),
      [
        "createConfidentialAccount(bytes)",
        "deposit(address,uint256)",
        "getAccountCore(address)",
        "getAvailable(address,address)",
        "getPending(address,address)",
        TRANSFER_CONFIDENTIAL_SIGNATURE,
        WITHDRAW_CONFIDENTIAL_SIGNATURE,
        "applyPending()",
        FEE_TOKEN_SIGNATURE,
        FEE_ACCOUNT_SIGNATURE,
        NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
        NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
        NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
        ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
        ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
        ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
      ].sort(),
    );
  });

  it("preserves named return fields so ethers exposes them by name", () => {
    assert.deepEqual(
      iface.getFunction("getAccountCore(address)").outputs[0].components.map((c) => c.name),
      ["exists", "finalized", "pendingAction", "txId", "elgamalPubkey", "pendingCreditCounter"],
    );
    assert.deepEqual(iface.getFunction("getAvailable(address,address)").outputs.map((o) => o.name), ["c1", "c2"]);
    assert.deepEqual(iface.getFunction("getPending(address,address)").outputs.map((o) => o.name), ["c1", "c2"]);
  });

  it("ERC20_ABI exposes the standard functions both clients use", () => {
    const erc20 = new ethers.Interface(ERC20_ABI);
    for (const sig of [
      "approve(address,uint256)",
      "allowance(address,address)",
      "balanceOf(address)",
      "decimals()",
    ]) {
      assert.ok(erc20.getFunction(sig), `ERC20_ABI missing ${sig}`);
    }
  });
});
