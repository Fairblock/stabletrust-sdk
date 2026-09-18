import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as stabletrust from "../src/index.js";

const declarations = fs.readFileSync(
  new URL("../src/index.d.ts", import.meta.url),
  "utf8",
);

const constantExports = [
  "APPLY_PENDING_SIGNATURE",
  "CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE",
  "DEPOSIT_SIGNATURE",
  "PREDICATE_ATTESTATION_SIGNATURE",
];
const functionExports = [
  "emptyPredicateAttestation",
  "injectPredicateAttestation",
  "isPredicateAttestation",
];

test("Predicate runtime exports have public TypeScript declarations", () => {
  assert.match(declarations, /export type PredicateAttestation\s*=/);

  for (const name of constantExports) {
    assert.equal(typeof stabletrust[name], "string", `${name} runtime export`);
    assert.match(
      declarations,
      new RegExp(`export const ${name}: string;`),
      `${name} declaration`,
    );
  }

  for (const name of functionExports) {
    assert.equal(typeof stabletrust[name], "function", `${name} runtime export`);
    assert.match(
      declarations,
      new RegExp(`export function ${name}\\(`),
      `${name} declaration`,
    );
  }
});
