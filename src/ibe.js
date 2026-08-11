import { timelockEncrypt } from "./vendor/ts-ibe/index.js";

const IBE_PUBKEY_URL =
  "https://anon-testnet-api.fairblock.network/fairyring/keyshare/pubkey";

/** @type {{ active: string, queued: string | null } | null} */
let cachedIbePublicKeys = null;

function extractPublicKey(pubkeyObj) {
  return pubkeyObj?.public_key || pubkeyObj?.pubkey || null;
}

/**
 * Build IBE identity: address (lowercase) + chain public key.
 * @param {string} userAddress
 * @param {string} publicKey
 * @returns {string}
 */
function buildIbeId(userAddress, publicKey) {
  return userAddress.toLowerCase() + publicKey;
}

async function getIbePublicKeys() {
  if (cachedIbePublicKeys) return cachedIbePublicKeys;

  const response = await fetch(IBE_PUBKEY_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch IBE public key: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const active = extractPublicKey(data?.active_pubkey);
  const queued = extractPublicKey(data?.queued_pubkey);

  if (!active) {
    throw new Error("Active IBE public key not found in chain API response");
  }

  cachedIbePublicKeys = { active, queued: queued || null };
  return cachedIbePublicKeys;
}

/**
 * Encrypts a base64-encoded randomness (PedersenOpening) using IBE.
 * Always encrypts under the active pubkey; also encrypts under the queued
 * pubkey when the chain reports one (backup for key rotation).
 *
 * Identity is address.toLowerCase() + chain pk (active or queued).
 *
 * @param {string} userAddress - Wallet address used as part of the IBE identity
 * @param {string} randomnessBase64 - Base64-encoded randomness
 * @returns {Promise<{
 *   encrypted: string,
 *   encryptedId: string,
 *   queuedEncrypted: string | null,
 *   queuedEncryptedId: string | null
 * }>}
 *   Hex-encoded IBE ciphertexts plus the identities used for each
 */
export async function encryptRandomness(userAddress, randomnessBase64) {
  const { active, queued } = await getIbePublicKeys();
  const randomnessBuffer = Buffer.from(randomnessBase64, "base64");

  // Active ciphertext → identity address.toLowerCase() + activePk
  const encryptedId = buildIbeId(userAddress, active);
  const encrypted = await timelockEncrypt(encryptedId, active, randomnessBuffer);

  // Queued ciphertext → identity address.toLowerCase() + queuedPk
  let queuedEncrypted = null;
  let queuedEncryptedId = null;
  if (queued) {
    queuedEncryptedId = buildIbeId(userAddress, queued);
    queuedEncrypted = await timelockEncrypt(
      queuedEncryptedId,
      queued,
      randomnessBuffer,
    );
  }

  return { encrypted, encryptedId, queuedEncrypted, queuedEncryptedId };
}
