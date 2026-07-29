// proof ABI encoding

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { encodeTransferProof, encodeWithdrawProof } from "../src/utils.js";

const abi = ethers.AbiCoder.defaultAbiCoder();
const asciiHex = (s) => ethers.hexlify(new TextEncoder().encode(s));

describe("encodeTransferProof", () => {
  it("encodes 3 base64/text components as their ASCII bytes (not base64-decoded)", () => {
    const encoded = encodeTransferProof({
      equality_proof: "AAA",
      ciphertext_validity_proof: "BBB",
      range_proof: "CCC",
    });
    const [eq, cv, rng] = abi.decode(["bytes", "bytes", "bytes"], encoded);
    assert.equal(eq, asciiHex("AAA"));
    assert.equal(cv, asciiHex("BBB"));
    assert.equal(rng, asciiHex("CCC"));
  });

  it("accepts 0x-hex components as raw bytes", () => {
    const encoded = encodeTransferProof({
      equality_proof: "0x1234",
      ciphertext_validity_proof: "0xabcd",
      range_proof: "0x00ff",
    });
    const [eq, cv, rng] = abi.decode(["bytes", "bytes", "bytes"], encoded);
    assert.equal(eq, "0x1234");
    assert.equal(cv, "0xabcd");
    assert.equal(rng, "0x00ff");
  });

  it("accepts Uint8Array and number[] components", () => {
    const encoded = encodeTransferProof({
      equality_proof: new Uint8Array([1, 2, 3]),
      ciphertext_validity_proof: [4, 5, 6],
      range_proof: new Uint8Array([7, 8, 9]),
    });
    const [eq, cv, rng] = abi.decode(["bytes", "bytes", "bytes"], encoded);
    assert.equal(eq, "0x010203");
    assert.equal(cv, "0x040506");
    assert.equal(rng, "0x070809");
  });

  it("is deterministic for the same input", () => {
    const p = { equality_proof: "x", ciphertext_validity_proof: "y", range_proof: "z" };
    assert.equal(encodeTransferProof(p), encodeTransferProof(p));
  });

  it("throws on an empty or missing component", () => {
    assert.throws(
      () => encodeTransferProof({ equality_proof: "", ciphertext_validity_proof: "b", range_proof: "c" }),
      /invalid proof component/,
    );
    assert.throws(
      () => encodeTransferProof({ ciphertext_validity_proof: "b", range_proof: "c" }),
      /invalid proof component/,
    );
  });
});

describe("encodeWithdrawProof", () => {
  it("encodes 2 components (equality + range) as bytes", () => {
    const encoded = encodeWithdrawProof({ equality_proof: "EE", range_proof: "RR" });
    const [eq, rng] = abi.decode(["bytes", "bytes"], encoded);
    assert.equal(eq, asciiHex("EE"));
    assert.equal(rng, asciiHex("RR"));
  });

  it("uses only equality + range (withdraw is 2-part, ignores ciphertext_validity)", () => {
    const encoded = encodeWithdrawProof({
      equality_proof: "EE",
      range_proof: "RR",
      ciphertext_validity_proof: "IGNORED",
    });
    const decoded = abi.decode(["bytes", "bytes"], encoded);
    assert.equal(decoded.length, 2);
    assert.equal(decoded[0], asciiHex("EE"));
    assert.equal(decoded[1], asciiHex("RR"));
  });

  it("throws on a missing range_proof", () => {
    assert.throws(() => encodeWithdrawProof({ equality_proof: "EE" }), /invalid proof component/);
  });
});
