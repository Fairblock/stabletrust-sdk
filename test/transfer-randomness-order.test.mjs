import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/confidential-client.js", import.meta.url),
  "utf8",
);

test("confidential transfer starts IBE persistence before optional finalization wait", () => {
  const start = source.indexOf("  async confidentialTransfer(");
  const end = source.indexOf(
    "\n  /**\n   * Withdraw confidential tokens",
    start,
  );

  assert.ok(start >= 0, "confidentialTransfer method not found");
  assert.ok(end > start, "confidentialTransfer method end not found");

  const transferSource = source.slice(start, end);
  const receiptIndex = transferSource.indexOf("const receipt = await tx.wait();");
  const senderRandomnessIndex = transferSource.indexOf(
    "encryptRandomness(senderAddress, proof.data.sender_randomness)",
  );
  const receiverRandomnessIndex = transferSource.indexOf(
    "encryptRandomness(recipientAddress, proof.data.receiver_randomness)",
  );
  const finalizationWaitIndex = transferSource.indexOf(
    'await this._waitForGlobalState(senderAddress, "transfer");',
  );

  assert.ok(receiptIndex >= 0, "transfer receipt wait not found");
  assert.ok(senderRandomnessIndex > receiptIndex, "sender IBE must start after the EVM receipt");
  assert.ok(receiverRandomnessIndex > receiptIndex, "receiver IBE must start after the EVM receipt");
  assert.ok(finalizationWaitIndex > senderRandomnessIndex, "sender IBE must start before finalization wait");
  assert.ok(finalizationWaitIndex > receiverRandomnessIndex, "receiver IBE must start before finalization wait");
});
