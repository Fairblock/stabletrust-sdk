import { ethers } from "ethers";

/**
 * Derives ElGamal encryption keys deterministically using the user's wallet signature.
 * This ensures that the user's privacy keys stay tied to their Ethereum account.
 *
 * @param {ethers.Wallet} wallet - The wallet to derive keys for
 * @param {Object} config - Configuration object with chainId and contractAddress
 * @param {Function} generateKeypair - The WASM function for key generation
 * @returns {Promise<{publicKey: string, privateKey: string}>}
 */
export async function deriveKeys(wallet, config, generateKeypair) {
  const domain = {
    name: "ConfidentialTokens",
    version: "1",
    chainId: config.chainId,
    verifyingContract: config.contractAddress,
  };

  const types = {
    DeriveElGamalKey: [
      { name: "purpose", type: "string" },
      { name: "user", type: "address" },
      { name: "context", type: "bytes32" },
    ],
  };

  const contextHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "string"],
      [config.chainId, config.contractAddress, ethers.ZeroAddress, "main"],
    ),
  );
  const userAddress = (await wallet.getAddress()).toLowerCase();
  const message = {
    purpose: "homomorphic-key-derive-v1",
    user: userAddress,
    context: contextHash,
  };

  const signature = await wallet.signTypedData(domain, types, message);
  const domainContext = JSON.stringify({
    chainId: config.chainId.toString(),
    verifyingContract: config.contractAddress,
    user: userAddress,
    purpose: "homomorphic-key-derive-v1",
    version: "1",
  });

  const keypair = JSON.parse(
    generateKeypair(signature.slice(2), domainContext),
  );

  return {
    publicKey: keypair.public_key,
    privateKey: keypair.private_key,
  };
}

/**
 * Decrypts a ciphertext using the private key
 *
 * @param {string} ciphertext - Base64 encoded ciphertext
 * @param {string} privateKey - The private key for decryption
 * @param {Function} decryptFn - The WASM decrypt function
 * @returns {number} The decrypted amount
 */
export function decryptCiphertext(ciphertext, privateKey, decryptFn) {
  try {
    const plainStr = decryptFn(ciphertext, privateKey);
    const result = JSON.parse(plainStr);
    return result.decrypted_amount || 0;
  } catch (e) {
    throw new Error("Decryption failed: " + e.message);
  }
}

/**
 * Combines two elliptic curve points into a single ciphertext
 *
 * @param {string} c1 - First component (hex string)
 * @param {string} c2 - Second component (hex string)
 * @returns {string} Base64 encoded combined ciphertext
 */
export function combineCiphertext(c1, c2) {
  const combined = new Uint8Array(64);
  combined.set(ethers.getBytes(c1), 0);
  combined.set(ethers.getBytes(c2), 32);
  return Buffer.from(combined).toString("base64");
}
