import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  ConfidentialTransferClient,
  ControlledConfidentialTransferClient,
  AnonymousTransferClient,
  WITHDRAW_FEE_PPM_DENOMINATOR,
} from "../src/index.js";

const DIAMOND = "0x1000000000000000000000000000000000000001";
const FEE_TOKEN = "0x2000000000000000000000000000000000000002";
const WITHDRAW_TOKEN = "0x3000000000000000000000000000000000000003";
const USER = "0x4000000000000000000000000000000000000004";

function makePublicClient({ feeToken = FEE_TOKEN, fixedFee = 0n, ppm = 0n, balance = 0n, allowance = 0n } = {}) {
  const client = Object.create(ConfidentialTransferClient.prototype);
  client.config = { contractAddress: DIAMOND };
  client.contract = {
    feeToken: async () => feeToken,
    feeAccount: async () => USER,
    nonAnonymousWithdrawFee: async () => fixedFee,
    nonAnonymousWithdrawFeePpm: async () => ppm,
    anonymousWithdrawFeePpm: async () => 0n,
  };

  let approvals = 0;
  client._getTokenContract = (address) => {
    if (address.toLowerCase() === WITHDRAW_TOKEN.toLowerCase()) {
      return { decimals: async () => 6n };
    }
    return {
      balanceOf: async () => balance,
      allowance: async () => allowance,
      connect: () => ({
        approve: async (spender, amount) => {
          approvals += 1;
          assert.equal(spender, DIAMOND);
          assert.equal(amount, ethers.MaxUint256);
          return { wait: async () => ({ status: 1 }) };
        },
      }),
    };
  };
  const wallet = { getAddress: async () => USER };
  return { client, wallet, approvals: () => approvals };
}

test("withdrawal PPM denominator is one million", () => {
  assert.equal(WITHDRAW_FEE_PPM_DENOMINATOR, 1_000_000n);
});

test("non-anonymous native fixed withdrawal fee is attached as msg.value", async () => {
  const { client, wallet, approvals } = makePublicClient({
    feeToken: ethers.ZeroAddress,
    fixedFee: 500n,
  });
  assert.deepEqual(await client._prepareNonAnonymousWithdrawFee(wallet), { value: 500n });
  assert.equal(approvals(), 0);
});

test("non-anonymous ERC20 fixed withdrawal fee approves when needed", async () => {
  const { client, wallet, approvals } = makePublicClient({
    fixedFee: 500n,
    balance: 1_000n,
    allowance: 10n,
  });
  assert.deepEqual(await client._prepareNonAnonymousWithdrawFee(wallet), { value: 0n });
  assert.equal(approvals(), 1);
});

test("non-anonymous fixed withdrawal fee rejects insufficient fee-token balance", async () => {
  const { client, wallet } = makePublicClient({
    fixedFee: 500n,
    balance: 499n,
    allowance: 1_000n,
  });
  await assert.rejects(
    client._prepareNonAnonymousWithdrawFee(wallet),
    /Insufficient withdrawal fee token balance.*Required: 500.*available: 499/s,
  );
});

test("non-anonymous withdrawal quote applies PPM only to normalized gross withdrawn token", async () => {
  const { client } = makePublicClient({ fixedFee: 77n, ppm: 10_000n });
  const quote = await client.getWithdrawalFeeQuote(WITHDRAW_TOKEN, 1_234_567n);

  assert.deepEqual(quote, {
    grossAmount: 1_230_000n,
    fixedFee: 77n,
    fixedFeeToken: FEE_TOKEN,
    percentageFeePpm: 10_000n,
    estimatedPercentageFee: 12_300n,
    withdrawalToken: WITHDRAW_TOKEN,
    estimatedNetAmount: 1_217_700n,
  });
});

test("controlled submit path injects fixed withdrawal fee before gas estimation", async () => {
  const client = Object.create(ControlledConfidentialTransferClient.prototype);
  client.gasLimitSafetyBps = 0n;
  const wallet = { getAddress: async () => USER };
  let preparedFor;
  client._prepareNonAnonymousWithdrawFee = async (runner) => {
    preparedFor = runner;
    return { value: 321n };
  };

  const calls = [];
  const withdraw = async (...args) => {
    calls.push(["send", args]);
    return { hash: "0x1234" };
  };
  withdraw.estimateGas = async (...args) => {
    calls.push(["estimate", args]);
    return 100_000n;
  };
  const contract = { runner: wallet, withdraw };

  await client._submitWithGasSafety(contract, "withdraw", [WITHDRAW_TOKEN, 10n, "0x12", false]);
  assert.equal(preparedFor, wallet);
  assert.equal(calls[0][0], "estimate");
  assert.deepEqual(calls[0][1].at(-1), { value: 321n });
  assert.equal(calls[1][0], "send");
  assert.deepEqual(calls[1][1].at(-1), { value: 321n, gasLimit: 100_000n });
});

function makeAnonymousClient(routes) {
  const client = Object.create(AnonymousTransferClient.prototype);
  client._fetch = async (method, path) => {
    assert.equal(method, "GET");
    if (!(path in routes)) throw new Error(`Unexpected path: ${path}`);
    return { result: routes[path] };
  };
  return client;
}

test("anonymous client reads the new Fairycloak withdrawal fee routes", async () => {
  const client = makeAnonymousClient({
    "/v1/views/fees/non-anonymous-withdraw-fixed": "101",
    "/v1/views/fees/non-anonymous-withdraw-ppm": "202",
    "/v1/views/fees/anonymous-withdraw-ppm": "303",
  });

  assert.equal(await client.getNonAnonymousWithdrawFee(), 101n);
  assert.equal(await client.getNonAnonymousWithdrawFeePpm(), 202n);
  assert.equal(await client.getAnonymousWithdrawFeePpm(), 303n);
});

test("anonymous prepaid withdrawal requirement includes only the path-specific fixed fee", async () => {
  const client = Object.create(AnonymousTransferClient.prototype);
  const calls = [];
  client.getFeeToken = async () => FEE_TOKEN;
  client.getAnonymousInlineWithdrawFee = async () => {
    calls.push("inline-fixed");
    return 200n;
  };
  client.getAnonymousIpfsWithdrawFee = async () => {
    calls.push("ipfs-fixed");
    return 100n;
  };
  client.getAnonymousWithdrawFeePpm = async () => {
    throw new Error("percentage fee must not be consulted for prepaid requirement");
  };
  client.getPrepaidFeeBalance = async () => 150n;

  await assert.rejects(
    client._assertSufficientWithdrawPrepaidFees("Alice1", false),
    /inline withdrawal.*Required: 200/s,
  );
  await client._assertSufficientWithdrawPrepaidFees("Alice1", true);
  assert.deepEqual(calls, ["inline-fixed", "ipfs-fixed"]);
});

test("anonymous withdrawal quote separates prepaid fixed fee from success-only withdrawn-token fee", async () => {
  const client = Object.create(AnonymousTransferClient.prototype);
  client._fetchTokenDecimals = async () => 6;
  client.getAnonymousInlineWithdrawFee = async () => 55n;
  client.getAnonymousIpfsWithdrawFee = async () => 66n;
  client.getFeeToken = async () => FEE_TOKEN;
  client.getAnonymousWithdrawFeePpm = async () => 1_000n;

  const inline = await client.getAnonymousWithdrawalFeeQuote(WITHDRAW_TOKEN, 2_345_678n);
  assert.equal(inline.grossAmount, 2_340_000n);
  assert.equal(inline.fixedFee, 55n);
  assert.equal(inline.estimatedPercentageFee, 2_340n);
  assert.equal(inline.estimatedNetAmount, 2_337_660n);

  const ipfs = await client.getAnonymousWithdrawalFeeQuote(
    WITHDRAW_TOKEN,
    2_345_678n,
    { offchainZKP: true },
  );
  assert.equal(ipfs.fixedFee, 66n);
  assert.equal(ipfs.percentageFeePpm, 1_000n);
});
