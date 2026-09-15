import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

import { ConfidentialTransferClient } from "../src/index.js";
import {
  emptyPredicateAttestation,
  injectPredicateAttestation,
  isPredicateAttestation,
} from "../src/predicate-contract.js";
import {
  CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
  DEPOSIT_SIGNATURE,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  APPLY_PENDING_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
} from "../src/constants.js";

const RPC = "http://127.0.0.1:8545";
const DIAMOND = "0x0000000000000000000000000000000000000001";
const TOKEN = "0x0000000000000000000000000000000000000002";
const RECIPIENT = "0x0000000000000000000000000000000000000003";
const CHAIN_ID = 421614;

const EMPTY = ["", 0n, ethers.ZeroAddress, "0x"];

test("emptyPredicateAttestation returns the disabled-mode tuple", () => {
  const first = emptyPredicateAttestation();
  const second = emptyPredicateAttestation();
  assert.deepEqual(first, EMPTY);
  assert.deepEqual(second, EMPTY);
  assert.notEqual(first, second, "each call should receive a fresh tuple");
  assert.equal(isPredicateAttestation(first), true);
});

test("injectPredicateAttestation upgrades all five legacy SDK call shapes", () => {
  assert.deepEqual(
    injectPredicateAttestation("createConfidentialAccount", ["0x1234"]),
    ["0x1234", EMPTY],
  );
  assert.deepEqual(
    injectPredicateAttestation("deposit", [TOKEN, 7n]),
    [TOKEN, 7n, EMPTY],
  );
  assert.deepEqual(
    injectPredicateAttestation("transferConfidential", [
      RECIPIENT,
      TOKEN,
      "0xabcd",
      false,
    ]),
    [RECIPIENT, TOKEN, "0xabcd", false, EMPTY],
  );
  assert.deepEqual(
    injectPredicateAttestation("applyPending", []),
    [EMPTY],
  );
  assert.deepEqual(
    injectPredicateAttestation("withdraw", [TOKEN, 9n, "0xabcd", true]),
    [TOKEN, 9n, "0xabcd", true, EMPTY],
  );
});

test("transaction overrides remain after the injected attestation", () => {
  const overrides = { value: 1n, nonce: 7 };
  assert.deepEqual(
    injectPredicateAttestation("transferConfidential", [
      RECIPIENT,
      TOKEN,
      "0xabcd",
      false,
      overrides,
    ]),
    [RECIPIENT, TOKEN, "0xabcd", false, EMPTY, overrides],
  );
  assert.deepEqual(
    injectPredicateAttestation("applyPending", [overrides]),
    [EMPTY, overrides],
  );
});

test("explicit real attestations are not replaced", () => {
  const attestation = [
    "predicate-uuid",
    123456789n,
    RECIPIENT,
    "0x1234",
  ];
  const overrides = { value: 1n };

  assert.equal(
    injectPredicateAttestation("deposit", [TOKEN, 7n, attestation])[2],
    attestation,
  );
  assert.deepEqual(
    injectPredicateAttestation("withdraw", [
      TOKEN,
      9n,
      "0xabcd",
      false,
      attestation,
      overrides,
    ]),
    [TOKEN, 9n, "0xabcd", false, attestation, overrides],
  );
});

test("exported client populates the upgraded selectors with empty attestations", async () => {
  const client = new ConfidentialTransferClient(RPC, DIAMOND, CHAIN_ID);

  const calls = [
    {
      method: "createConfidentialAccount",
      signature: CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
      args: ["0x1234"],
      attestationIndex: 1,
    },
    {
      method: "deposit",
      signature: DEPOSIT_SIGNATURE,
      args: [TOKEN, 7n],
      attestationIndex: 2,
    },
    {
      method: "transferConfidential",
      signature: TRANSFER_CONFIDENTIAL_SIGNATURE,
      args: [RECIPIENT, TOKEN, "0xabcd", false],
      attestationIndex: 4,
    },
    {
      method: "applyPending",
      signature: APPLY_PENDING_SIGNATURE,
      args: [],
      attestationIndex: 0,
    },
    {
      method: "withdraw",
      signature: WITHDRAW_CONFIDENTIAL_SIGNATURE,
      args: [TOKEN, 9n, "0xabcd", false],
      attestationIndex: 4,
    },
  ];

  for (const entry of calls) {
    const populated = await client.contract[entry.method].populateTransaction(
      ...entry.args,
    );
    const decoded = client.contract.interface.decodeFunctionData(
      entry.signature,
      populated.data,
    );
    assert.equal(decoded[entry.attestationIndex][0], "");
    assert.equal(decoded[entry.attestationIndex][1], 0n);
    assert.equal(decoded[entry.attestationIndex][2], ethers.ZeroAddress);
    assert.equal(decoded[entry.attestationIndex][3], "0x");
  }
});
