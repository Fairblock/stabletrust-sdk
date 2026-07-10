import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { AnonymousTransferClient } from "../src/anonymous-client.js";
import { ConfidentialTransferClient } from "../src/confidential-client.js";

const DIAMOND = "0x1000000000000000000000000000000000000001";
const FEE_TOKEN = "0x2000000000000000000000000000000000000002";
const SENDER = "0x3000000000000000000000000000000000000003";

function makeAnonymousClient(routes) {
  const client = Object.create(AnonymousTransferClient.prototype);
  client._fetch = async (method, path) => {
    assert.equal(method, "GET");
    if (!(path in routes)) throw new Error(`Unexpected path: ${path}`);
    return { result: routes[path] };
  };
  return client;
}

test("anonymous fee getters use the new Fairycloak endpoints", async () => {
  const client = makeAnonymousClient({
    "/v1/views/fees/non-anonymous": "101",
    "/v1/views/fees/anonymous-ipfs": "202",
    "/v1/views/fees/anonymous-inline": "303",
  });

  assert.equal(await client.getNonAnonymousTransferFee(), 101n);
  assert.equal(await client.getAnonymousIpfsTransferFee(), 202n);
  assert.equal(await client.getAnonymousInlineTransferFee(), 303n);
});

test("anonymous prepaid check selects inline and IPFS fees independently", async () => {
  const calls = [];
  const client = Object.create(AnonymousTransferClient.prototype);
  client.getFeeToken = async () => FEE_TOKEN;
  client.getAnonymousInlineTransferFee = async () => {
    calls.push("inline");
    return 300n;
  };
  client.getAnonymousIpfsTransferFee = async () => {
    calls.push("ipfs");
    return 100n;
  };
  client.getPrepaidFeeBalance = async () => 150n;

  await assert.rejects(
    client._assertSufficientPrepaidFees("Alice1", false),
    /inline transfer.*Required: 300/s,
  );
  await client._assertSufficientPrepaidFees("Alice1", true);
  assert.deepEqual(calls, ["inline", "ipfs"]);
});

function makeConfidentialClient({ feeToken, feeAmount, balance = 0n, allowance = 0n }) {
  const client = Object.create(ConfidentialTransferClient.prototype);
  client.config = { contractAddress: DIAMOND };
  client.contract = {
    feeToken: async () => feeToken,
    nonAnonymousTransferFee: async () => feeAmount,
  };

  let approvals = 0;
  client._getTokenContract = () => ({
    balanceOf: async (address) => {
      assert.equal(address, SENDER);
      return balance;
    },
    allowance: async (owner, spender) => {
      assert.equal(owner, SENDER);
      assert.equal(spender, DIAMOND);
      return allowance;
    },
    connect: () => ({
      approve: async (spender, amount) => {
        approvals += 1;
        assert.equal(spender, DIAMOND);
        assert.equal(amount, ethers.MaxUint256);
        return { wait: async () => ({ status: 1 }) };
      },
    }),
  });

  const wallet = { getAddress: async () => SENDER };
  return { client, wallet, approvals: () => approvals };
}

test("non-anonymous native fee is attached for both proof paths", async () => {
  const { client, wallet, approvals } = makeConfidentialClient({
    feeToken: ethers.ZeroAddress,
    feeAmount: 450n,
  });

  assert.deepEqual(await client._prepareNonAnonymousTransferFee(wallet), {
    value: 450n,
  });
  assert.equal(approvals(), 0);
});

test("non-anonymous ERC-20 fee approves the diamond when required", async () => {
  const { client, wallet, approvals } = makeConfidentialClient({
    feeToken: FEE_TOKEN,
    feeAmount: 450n,
    balance: 1000n,
    allowance: 100n,
  });

  assert.deepEqual(await client._prepareNonAnonymousTransferFee(wallet), {
    value: 0n,
  });
  assert.equal(approvals(), 1);
});

test("non-anonymous ERC-20 fee reuses sufficient allowance", async () => {
  const { client, wallet, approvals } = makeConfidentialClient({
    feeToken: FEE_TOKEN,
    feeAmount: 450n,
    balance: 1000n,
    allowance: 450n,
  });

  assert.deepEqual(await client._prepareNonAnonymousTransferFee(wallet), {
    value: 0n,
  });
  assert.equal(approvals(), 0);
});

test("non-anonymous ERC-20 fee fails before submission when balance is insufficient", async () => {
  const { client, wallet } = makeConfidentialClient({
    feeToken: FEE_TOKEN,
    feeAmount: 450n,
    balance: 449n,
    allowance: 1000n,
  });

  await assert.rejects(
    client._prepareNonAnonymousTransferFee(wallet),
    /Insufficient fee token balance.*Required: 450.*available: 449/s,
  );
});
