import { ethers } from "ethers";
// Pinata uploads API endpoint
// Docs: https://docs.pinata.cloud
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";
const PINATA_JWT = process.env.PINATA_JWT;
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
      `Note: This is a confidential transaction - the amount is not visible on-chain.`,
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
 * @returns {Promise<string>} The CID string.
 */
export async function uploadJsonToIpfs(data) {
  if (!PINATA_JWT) {
    throw new Error("REACT_APP_PINATA_JWT is not set");
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
 * @returns {Promise<string>} The CID string.
 */
export async function uploadBytesToIpfs(bytes, name = "proof.bin") {
  if (!PINATA_JWT) {
    throw new Error("REACT_APP_PINATA_JWT is not set");
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
