import { timelockEncrypt } from "./vendor/ts-ibe/index.js";

const IBE_PUBKEY_URL =
  "https://anon-testnet-api.fairblock.network/fairyring/keyshare/pubkey";

/** @type {{ active: string, queued: string | null } | null} */
let cachedIbePublicKeys = null;

function extractPublicKey(pubkeyObj) {
  return pubkeyObj?.public_key || pubkeyObj?.pubkey || null;
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
 * @param {string} userAddress - Wallet address used as the IBE identity
 * @param {string} randomnessBase64 - Base64-encoded randomness
 * @returns {Promise<{ encrypted: string, queuedEncrypted: string | null }>}
 *   Hex-encoded IBE ciphertexts
 */
export async function encryptRandomness(userAddress, randomnessBase64) {
  const { active, queued } = await getIbePublicKeys();
  const id = userAddress.toLowerCase();
  const randomnessBuffer = Buffer.from(randomnessBase64, "base64");

  const [encrypted, queuedEncrypted] = await Promise.all([
    timelockEncrypt(id, active, randomnessBuffer),
    queued ? timelockEncrypt(id, queued, randomnessBuffer) : Promise.resolve(null),
  ]);

  return { encrypted, queuedEncrypted };
}
