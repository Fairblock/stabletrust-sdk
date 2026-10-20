import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnonymousTransferClient } from "../src/index.js";

function clientReturning(result) {
  const client = Object.create(AnonymousTransferClient.prototype);
  client._fetch = async () => ({ result });
  return client;
}

describe("Fairycloak unsigned integer response parsing", () => {
  it("accepts exact non-negative integer representations", async () => {
    for (const [input, expected] of [
      ["0", 0n],
      ["12345678901234567890", 12345678901234567890n],
      ["0x2a", 42n],
      [42, 42n],
      [42n, 42n],
    ]) {
      const client = clientReturning(input);
      assert.equal(await client.getAnonymousCreateAccountFee(), expected);
    }
  });

  it("rejects malformed, negative, fractional, and unsafe values", async () => {
    for (const input of [
      "not-an-integer",
      "",
      "   ",
      "-1",
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      true,
      {},
    ]) {
      const client = clientReturning(input);
      await assert.rejects(
        client.getAnonymousCreateAccountFee(),
        /invalid Fairycloak unsigned integer field "anonymousCreateAccountFee"/i,
        `should reject ${String(input)}`,
      );
    }
  });

  it("allows absent counters only for accounts that do not exist", async () => {
    const missing = Object.create(AnonymousTransferClient.prototype);
    missing._fetch = async () => ({ result: { exists: false } });
    assert.deepEqual(await missing.getAnonymousAccountInfo("Missing1"), {
      exists: false,
      finalized: false,
      hasPendingAction: false,
      txId: 0n,
      elgamalPubkey: "0x",
      authNonce: 0n,
    });

    const existing = Object.create(AnonymousTransferClient.prototype);
    existing._fetch = async () => ({ result: { exists: true } });
    await assert.rejects(
      existing.getAnonymousAccountInfo("Existing1"),
      /invalid Fairycloak unsigned integer field "txId"/i,
    );
  });

  it("does not hide malformed counters on missing accounts", async () => {
    const client = Object.create(AnonymousTransferClient.prototype);
    client._fetch = async () => ({
      result: {
        exists: false,
        tx_id: "not-an-integer",
        auth_nonce: "0",
      },
    });
    await assert.rejects(
      client.getAnonymousAccountInfo("Missing1"),
      /invalid Fairycloak unsigned integer field "txId"/i,
    );
  });

  it("rejects malformed prepaid balances through the public getter", async () => {
    const client = clientReturning("not-an-integer");
    await assert.rejects(
      client.getPrepaidFeeBalance(
        "Account1",
        "0x1000000000000000000000000000000000000001",
      ),
      /invalid Fairycloak unsigned integer field "prepaidFeeBalance"/i,
    );
  });
});
