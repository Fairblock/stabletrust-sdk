//anonymous/unlinkable account-ID validation.
// These rules must match the Fairycloak relay + on-chain contract
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAnonymousAccountId, MAX_ANONYMOUS_ACCOUNT_ID_LENGTH } from "../src/utils.js";

describe("validateAnonymousAccountId", () => {
  it("accepts valid alphanumeric IDs (1..20 chars, case-sensitive)", () => {
    for (const id of ["a", "alice", "Bob123", "A1b2C3", "x".repeat(20)]) {
      assert.doesNotThrow(() => validateAnonymousAccountId(id), `should accept "${id}"`);
    }
  });

  it("rejects empty and non-string values", () => {
    for (const bad of ["", 123, null, undefined, {}, []]) {
      assert.throws(() => validateAnonymousAccountId(bad), /Invalid accountId/);
    }
  });

  it("rejects IDs longer than 20 characters", () => {
    assert.throws(() => validateAnonymousAccountId("x".repeat(21)), /exceeds 20 characters/);
  });

  it("rejects non-alphanumeric IDs (spaces, punctuation, unicode)", () => {
    for (const bad of ["has space", "hi!", "a-b", "under_score", "café", "emoji😀"]) {
      assert.throws(() => validateAnonymousAccountId(bad), /non-alphanumeric/, `should reject "${bad}"`);
    }
  });

  it("uses the provided fieldName in error messages", () => {
    assert.throws(() => validateAnonymousAccountId("", "senderId"), /Invalid senderId/);
    assert.throws(() => validateAnonymousAccountId("bad id", "recipientId"), /Invalid recipientId/);
  });

  it("exports the max length constant (20)", () => {
    assert.equal(MAX_ANONYMOUS_ACCOUNT_ID_LENGTH, 20);
  });
});
