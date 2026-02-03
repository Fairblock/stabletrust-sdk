import { ethers } from "ethers";

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
