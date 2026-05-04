import { timelockEncrypt } from "./vendor/ts-ibe/index.js";

const IBE_PUBKEY_URL =
  "https://testnet-api.fairblock.network/fairyring/keyshare/pubkey";

let cachedIbePublicKey = null;

async function getActiveIbePublicKey() {
  if (cachedIbePublicKey) return cachedIbePublicKey;

  const response = await fetch(IBE_PUBKEY_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch IBE public key: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const publicKey = data?.active_pubkey?.public_key || data?.active_pubkey?.pubkey;

  if (!publicKey) {
    throw new Error("Active IBE public key not found in chain API response");
  }

  cachedIbePublicKey = publicKey;
  return cachedIbePublicKey;
}

/**
 * Encrypts a base64-encoded randomness (PedersenOpening) using IBE.
 * @param {string} userAddress - Wallet address used as the IBE identity
 * @param {string} randomnessBase64 - Base64-encoded randomness
 * @returns {Promise<string>} Hex-encoded IBE ciphertext
 */
export async function encryptRandomness(userAddress, randomnessBase64) {
  const ibePublicKey = await getActiveIbePublicKey();
  const id = userAddress.toLowerCase();
  const randomnessBuffer = Buffer.from(randomnessBase64, "base64");
  return timelockEncrypt(id, ibePublicKey, randomnessBuffer);
}
