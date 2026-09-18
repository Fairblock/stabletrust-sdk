import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  AnonymousTransferClient,
  ConfidentialTransferClient,
  deriveKeys,
} from "../src/index.js";
import { signDeterministicKeyDerivation } from "../src/crypto.js";
import { initializeWasm } from "../src/wasm-loader.js";

const CONFIG = {
  chainId: 84532,
  contractAddress: "0xb6cdAE7ccfEE03e351694c63436D5c5c073aEF84",
};

function genericSignerFor(wallet) {
  return {
    getAddress: () => wallet.getAddress(),
    signTypedData: (domain, types, value) =>
      wallet.signTypedData(domain, types, value),
  };
}

describe("deterministic ElGamal key derivation", () => {
  it("preserves BaseWallet's existing EIP-712 signature bytes", async () => {
    const wallet = ethers.Wallet.createRandom();
    const domain = {
      name: "ConfidentialTokens",
      version: "1",
      chainId: CONFIG.chainId,
      verifyingContract: CONFIG.contractAddress,
    };
    const types = {
      DeriveElGamalKey: [
        { name: "purpose", type: "string" },
        { name: "user", type: "address" },
        { name: "context", type: "bytes32" },
      ],
    };
    const message = {
      purpose: "homomorphic-key-derive-v1",
      user: wallet.address,
      context: ethers.ZeroHash,
    };

    assert.equal(
      signDeterministicKeyDerivation(wallet, domain, types, message),
      await wallet.signTypedData(domain, types, message),
    );
  });

  it("rejects generic Signers whose signature-byte stability is not guaranteed", async () => {
    const wallet = ethers.Wallet.createRandom();
    const signer = genericSignerFor(wallet);
    const wasm = await initializeWasm();
    const client = new AnonymousTransferClient({
      fairycloakUrl: "http://127.0.0.1:1",
      rpcUrl: "http://127.0.0.1:1",
      chainId: CONFIG.chainId,
      diamondAddress: CONFIG.contractAddress,
    });
    const confidentialClient = new ConfidentialTransferClient(
      "http://127.0.0.1:1",
      CONFIG.contractAddress,
      CONFIG.chainId,
    );

    try {
      await assert.rejects(
        deriveKeys(signer, CONFIG, wasm.generate_deterministic_keypair),
        /requires an ethers BaseWallet with a local signing key/i,
      );
      await assert.rejects(
        client.deriveAnonymousKeys(signer, "Account1"),
        /requires an ethers BaseWallet with a local signing key/i,
      );
      await assert.rejects(
        confidentialClient.ensureAccount(signer),
        /requires an ethers BaseWallet with a local signing key/i,
      );
    } finally {
      client.provider.destroy();
      confidentialClient.provider.destroy();
    }
  });

  it("keeps local BaseWallet derivation deterministic", async () => {
    const wallet = ethers.Wallet.createRandom();
    const wasm = await initializeWasm();
    const client = new AnonymousTransferClient({
      fairycloakUrl: "http://127.0.0.1:1",
      rpcUrl: "http://127.0.0.1:1",
      chainId: CONFIG.chainId,
      diamondAddress: CONFIG.contractAddress,
    });

    try {
      const directA = await deriveKeys(
        wallet,
        CONFIG,
        wasm.generate_deterministic_keypair,
      );
      const directB = await deriveKeys(
        wallet,
        CONFIG,
        wasm.generate_deterministic_keypair,
      );
      assert.deepEqual(directA, directB);

      const anonymousA = await client.deriveAnonymousKeys(wallet, "Account1");
      const anonymousB = await client.deriveAnonymousKeys(wallet, "Account1");
      assert.deepEqual(anonymousA, anonymousB);
    } finally {
      client.provider.destroy();
    }
  });
});
