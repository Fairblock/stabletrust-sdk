// contract ABI signatures + chain address map.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  ERC20_ABI,
  PREDICATE_ATTESTATION_SIGNATURE,
  CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
  DEPOSIT_SIGNATURE,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  APPLY_PENDING_SIGNATURE,
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

  it("declares the upgraded Attestation-bearing non-anonymous signatures", () => {
    assert.equal(PREDICATE_ATTESTATION_SIGNATURE, "(string,uint256,address,bytes)");
    assert.equal(
      CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
      "createConfidentialAccount(bytes,(string,uint256,address,bytes))",
    );
    assert.equal(
      DEPOSIT_SIGNATURE,
      "deposit(address,uint256,(string,uint256,address,bytes))",
    );
    assert.equal(
      TRANSFER_CONFIDENTIAL_SIGNATURE,
      "transferConfidential(address,address,bytes,bool,(string,uint256,address,bytes))",
    );
    assert.equal(
      APPLY_PENDING_SIGNATURE,
      "applyPending((string,uint256,address,bytes))",
    );
    assert.equal(
      WITHDRAW_CONFIDENTIAL_SIGNATURE,
      "withdraw(address,uint256,bytes,bool,(string,uint256,address,bytes))",
    );
  });

  it("CONTRACT_ABI contains all five upgraded entrypoints", () => {
    for (const signature of [
      CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
      DEPOSIT_SIGNATURE,
      TRANSFER_CONFIDENTIAL_SIGNATURE,
      APPLY_PENDING_SIGNATURE,
      WITHDRAW_CONFIDENTIAL_SIGNATURE,
    ]) {
      assert.ok(iface.getFunction(signature), `${signature} missing`);
    }
  });

  it("withdraw remains payable so native fixed request fees can be attached", () => {
    assert.equal(iface.getFunction(WITHDRAW_CONFIDENTIAL_SIGNATURE).stateMutability, "payable");
  });

  it("CONTRACT_ABI no longer contains any of the five legacy selectors", () => {
    for (const signature of [
      "createConfidentialAccount(bytes)",
      "deposit(address,uint256)",
      "transferConfidential(address,address,bytes,bool)",
      "applyPending()",
      "withdraw(address,uint256,bytes,bool)",
    ]) {
      assert.equal(iface.getFunction(signature), null, `${signature} should be absent`);
    }
  });

  it("ethers v6 getFunction returns null (not throws) for a missing signature", () => {
    const stale = new ethers.Interface([
      "function transferConfidential(address,address,bytes,bool) external payable",
      "function withdraw(address,uint256,bytes,bool) external payable",
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
    assert.equal(getStabletrustContractAddress(421614), "0x147C6D8cA1a4784Ed76d98b0E3CcA41C38a49A5f");
    assert.equal(getStabletrustContractAddress("421614"), "0x147C6D8cA1a4784Ed76d98b0E3CcA41C38a49A5f");
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
        CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
        DEPOSIT_SIGNATURE,
        "getAccountCore(address)",
        "getAvailable(address,address)",
        "getPending(address,address)",
        TRANSFER_CONFIDENTIAL_SIGNATURE,
        WITHDRAW_CONFIDENTIAL_SIGNATURE,
        APPLY_PENDING_SIGNATURE,
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
