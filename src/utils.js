import { ethers } from "ethers";
// Pinata uploads API endpoint
// Docs: https://docs.pinata.cloud
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

// Anonymous account ID constraints (must match the Fairycloak relay and on-chain contract rules)
export const MAX_ANONYMOUS_ACCOUNT_ID_LENGTH = 20;
const ANONYMOUS_ACCOUNT_ID_REGEX = /^[A-Za-z0-9]+$/;

/**
 * Validate an anonymous account ID against the rules enforced by the Fairycloak
 * relay and the on-chain contract:
 *  - non-empty
 *  - at most 20 characters
 *  - alphanumeric characters only (A-Z, a-z, 0-9)
 *  - case-sensitive (no normalization is applied)
 *
 * @param {string} accountId - The anonymous account ID to validate.
 * @param {string} [fieldName="accountId"] - Name of the field, used in error messages.
 * @throws {Error} If the account ID violates any of the above rules.
 */
export function validateAnonymousAccountId(accountId, fieldName = "accountId") {
  const RULES =
    `${fieldName} must be a non-empty string of at most ${MAX_ANONYMOUS_ACCOUNT_ID_LENGTH} characters, ` +
    `containing only alphanumeric characters (A-Z, a-z, 0-9). IDs are case-sensitive.`;

  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error(`Invalid ${fieldName}: ${RULES}`);
  }
  if (accountId.length > MAX_ANONYMOUS_ACCOUNT_ID_LENGTH) {
    throw new Error(
      `Invalid ${fieldName} "${accountId}": exceeds ${MAX_ANONYMOUS_ACCOUNT_ID_LENGTH} characters (got ${accountId.length}). ${RULES}`,
    );
  }
  if (!ANONYMOUS_ACCOUNT_ID_REGEX.test(accountId)) {
    throw new Error(`Invalid ${fieldName} "${accountId}": contains non-alphanumeric characters. ${RULES}`);
  }
}
/**
 * Encodes the ZK-Proof data for a transfer into a format the Solidity contract expects.
 *
 * @param {Object} proofData - The proof data object
 * @returns {string} Encoded proof bytes
 */
export function encodeTransferProof(proofData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["string", "string", "string"],
    [
      proofData.equality_proof,
      proofData.ciphertext_validity_proof,
      proofData.range_proof,
    ],
  );
}

/**
 * Encodes the ZK-Proof data for a withdrawal.
 *
 * @param {Object} proofData - The proof data object
 * @returns {string} Encoded proof bytes
 */
export function encodeWithdrawProof(proofData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["string", "string"],
    [proofData.equality_proof, proofData.range_proof],
  );
}

/**
 * Convert a raw ERC-20 token amount to the contract's 2-decimal scale
 * (`rawAmount * 100 / 10^decimals`).
 *
 * Throws when the amount rounds to zero and warns when a sub-cent remainder
 * is dropped, so callers never silently no-op or lose precision.
 *
 * @param {bigint|string|number} rawAmount - Amount in raw ERC-20 units
 * @param {bigint|number} tokenDecimals - Token decimals
 * @returns {bigint} Amount in contract scale
 * @throws {Error} If the amount rounds to 0 in contract scale
 */
export function toContractScale(rawAmount, tokenDecimals) {
  const raw = BigInt(rawAmount);
  const divisor = 10n ** BigInt(tokenDecimals);
  const scaled = (raw * 100n) / divisor;

  if (scaled <= 0n) {
    throw new Error(
      `Amount too small: ${raw} raw units rounds to 0 in contract scale`,
    );
  }
  if ((raw * 100n) % divisor !== 0n) {
    console.warn(
      `Amount ${raw} is not fully representable in contract scale (2 decimals); the sub-cent remainder will be dropped.`,
    );
  }

  return scaled;
}

/**
 * Delays execution for a specified time
 *
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logs a transaction with optional privacy note
 *
 * @param {string} hash - Transaction hash
 * @param {string} explorerUrl - Block explorer base URL
 * @param {boolean} isConfidential - Whether the transaction is confidential
 */
export function logTransaction(hash, explorerUrl, isConfidential = false) {
  console.log(`Transaction submitted: ${explorerUrl}${hash}`);
  if (isConfidential) {
    console.log(
      `Note: This is a confidential transaction - the amount is not visible onchain.`,
    );
  }
}

/**
 * Waits for a condition to be true with timeout
 *
 * @param {Function} conditionFn - Async function that returns boolean
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} intervalMs - Interval between attempts in milliseconds
 * @param {string} actionLabel - Label for logging
 * @returns {Promise<void>}
 * @throws {Error} If timeout is reached
 */
export async function waitForCondition(
  conditionFn,
  maxAttempts = 60,
  intervalMs = 3000,
  actionLabel = "operation",
) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await conditionFn()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${actionLabel}`);
}

/**
 * Upload a JSON-serializable object to IPFS and return its CID (as a string).
 * The object will be stored as a UTF-8 JSON blob.
 *
 * @param {any} data - JSON-serializable data to store.
 * @param {string} [jwt] - Pinata JWT. Falls back to `process.env.PINATA_JWT` when omitted.
 * @returns {Promise<string>} The CID string.
 */
export async function uploadJsonToIpfs(data, jwt) {
  const PINATA_JWT = jwt || process.env.PINATA_JWT;
  if (!PINATA_JWT) {
    throw new Error(
      "Pinata JWT is not set - pass `pinataJwt` in the client config or set PINATA_JWT in the environment",
    );
  }

  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: "application/json" });

  const form = new FormData();
  form.append("file", blob, "proof.json");
  form.append("network", "public");
  form.append("name", "zk-proof");

  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed: ${text}`);
  }

  const jsonRes = await res.json();
  return jsonRes?.data?.cid?.toString();
}

/**
 * Upload raw bytes to IPFS (Pinata) and return the CID.
 *
 * @param {Uint8Array|ArrayBuffer} bytes - Raw proof bytes.
 * @param {string} [name='proof.bin'] - Optional file name metadata.
 * @param {string} [jwt] - Pinata JWT. Falls back to `process.env.PINATA_JWT` when omitted.
 * @returns {Promise<string>} The CID string.
 */
export async function uploadBytesToIpfs(bytes, name = "proof.bin", jwt) {
  const PINATA_JWT = jwt || process.env.PINATA_JWT;
  if (!PINATA_JWT) {
    throw new Error(
      "Pinata JWT is not set - pass `pinataJwt` in the client config or set PINATA_JWT in the environment",
    );
  }

  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const blob = new Blob([uint8], { type: "application/octet-stream" });

  const form = new FormData();
  form.append("file", blob, name);
  form.append("network", "public");
  form.append("name", name);

  const res = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed: ${text}`);
  }

  const jsonRes = await res.json();
  return jsonRes?.data?.cid?.toString();
}
