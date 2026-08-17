import test from "node:test";
import assert from "node:assert/strict";

import { ControlledConfidentialTransferClient } from "../src/index.js";

const RPC = "http://127.0.0.1:8545";
const DIAMOND = "0x0000000000000000000000000000000000000001";
const CHAIN_ID = 421614;

test("controlled client preserves auto-apply by default", () => {
  const client = new ControlledConfidentialTransferClient(
    RPC,
    DIAMOND,
    CHAIN_ID,
  );
  assert.equal(client.autoApplyPending, true);
});

test("controlled client can disable automatic applyPending", async () => {
  const client = new ControlledConfidentialTransferClient(
    RPC,
    DIAMOND,
    CHAIN_ID,
    { autoApplyPending: false },
  );

  let called = false;
  client._applyPending = async () => {
    called = true;
  };

  const applied = await client._applyPendingIfNeeded(
    {},
    "private-key",
    DIAMOND,
    "transfer",
  );

  assert.equal(applied, false);
  assert.equal(called, false);
});

test("public applyPending forwards to the existing implementation", async () => {
  const client = new ControlledConfidentialTransferClient(
    RPC,
    DIAMOND,
    CHAIN_ID,
    { autoApplyPending: false },
  );

  const wallet = { id: "wallet" };
  const options = { waitForFinalization: false };
  const receipt = { hash: "0xabc" };
  let seen;

  client._applyPending = async (...args) => {
    seen = args;
    return receipt;
  };

  assert.equal(await client.applyPending(wallet, options), receipt);
  assert.deepEqual(seen, [wallet, options]);
});

test("controlled submissions add 25 percent gas headroom by default", async () => {
  const client = new ControlledConfidentialTransferClient(
    RPC,
    DIAMOND,
    CHAIN_ID,
    { autoApplyPending: false },
  );

  let seenGasLimit;
  const method = async (...args) => {
    const overrides = args.at(-1);
    seenGasLimit = overrides.gasLimit;
    return { hash: "0xabc" };
  };
  method.estimateGas = async () => 162309n;

  const tx = await client._submitWithGasSafety(
    { applyPending: method },
    "applyPending",
  );

  assert.equal(tx.hash, "0xabc");
  assert.equal(seenGasLimit, 202887n);
});
