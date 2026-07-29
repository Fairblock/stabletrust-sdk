import { ethers } from "ethers";

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
 * Convert a proof component returned by the WASM/proof generator into the exact
 * bytes carried inside the contract/Fairyport ABI proof tuple. The current proof
 * generator returns base64 text for each proof component; these ASCII bytes are
 * what the Go relayer and CosmWasm contract expect to receive.
 *
 * Hex strings are also accepted for callers that provide raw proof component
 * bytes manually.
 *
 * @param {string|Uint8Array|ArrayBuffer|Array<number>} value
 * @returns {Uint8Array}
 * @private
 */
function _proofPartToBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid proof component: expected non-empty string or bytes");
  }
  if (value.startsWith("0x")) return ethers.getBytes(value);
  return new TextEncoder().encode(value);
}

/**
 * Encodes the ZK-Proof data for a transfer into the format expected by the
 * latest EVM/Fairyport/CosmWasm flow: abi.encode(bytes equalityProof,
 * bytes ciphertextValidityProof, bytes rangeProof).
 *
 * @param {Object} proofData - The proof data object
 * @returns {string} ABI-encoded proof bytes
 */
export function encodeTransferProof(proofData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["bytes", "bytes", "bytes"],
    [
      _proofPartToBytes(proofData.equality_proof),
      _proofPartToBytes(proofData.ciphertext_validity_proof),
      _proofPartToBytes(proofData.range_proof),
    ],
  );
}

/**
 * Encodes the ZK-Proof data for a withdrawal into the format expected by the
 * latest EVM/Fairyport/CosmWasm flow: abi.encode(bytes equalityProof,
 * bytes rangeProof).
 *
 * @param {Object} proofData - The proof data object
 * @returns {string} ABI-encoded proof bytes
 */
export function encodeWithdrawProof(proofData) {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(
    ["bytes", "bytes"],
    [_proofPartToBytes(proofData.equality_proof), _proofPartToBytes(proofData.range_proof)],
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
 * Browser-safe environment lookup.
 *
 * @param {string} name - Environment variable name.
 * @returns {string|undefined}
 * @private
 */
function _env(name) {
  if (typeof process !== "undefined" && process?.env?.[name]) {
    return process.env[name];
  }
  return undefined;
}

/**
 * Resolve StableTrust IPFS upload options from explicit options or environment variables.
 *
 * @param {Object} [options]
 * @param {string} [options.uploadUrl] - StableTrust IPFS upload endpoint.
 * @param {string} [options.ipfsUploadUrl] - Alias for uploadUrl.
 * @param {string} [options.apiKey] - Bearer token for upload endpoint.
 * @param {string} [options.ipfsApiKey] - Alias for apiKey.
 * @returns {{uploadUrl:string, apiKey:string|null}}
 * @private
 */
function _resolveIpfsUploadOptions(options = {}) {
  const uploadUrl =
    options.uploadUrl ||
    options.ipfsUploadUrl ||
    _env("STABLETRUST_IPFS_UPLOAD_URL") ||
    _env("IPFS_UPLOAD_URL");

  if (!uploadUrl) {
    throw new Error(
      "StableTrust IPFS upload URL is not set - pass `ipfsUploadUrl` in the client config or set STABLETRUST_IPFS_UPLOAD_URL",
    );
  }

  return {
    uploadUrl: String(uploadUrl).trim(),
    apiKey:
      options.apiKey ||
      options.ipfsApiKey ||
      _env("STABLETRUST_IPFS_API_KEY") ||
      _env("IPFS_UPLOAD_API_KEY") ||
      null,
  };
}

/**
 * Upload a JSON-serializable object to the configured StableTrust IPFS upload endpoint
 * and return its CID. The object is stored as UTF-8 JSON bytes.
 *
 * @param {any} data - JSON-serializable data to store.
 * @param {Object} [options]
 * @param {string} [options.uploadUrl] - StableTrust IPFS upload endpoint.
 * @param {string} [options.apiKey] - Bearer token for upload endpoint.
 * @returns {Promise<string>} Bare CID string.
 */
export async function uploadJsonToIpfs(data, options = {}) {
  const json = JSON.stringify(data);
  return uploadBytesToIpfs(new TextEncoder().encode(json), "proof.json", options);
}

/**
 * Upload raw proof bytes to the configured StableTrust IPFS upload endpoint and return the bare CID.
 *
 * Expected upload endpoint contract:
 * - POST raw bytes to `uploadUrl`
 * - `Content-Type: application/octet-stream`
 * - optional `Authorization: Bearer <apiKey>`
 * - response JSON contains `{ "cid": "..." }` (also accepts `Hash`/`Cid` for compatibility)
 *
 * @param {Uint8Array|ArrayBuffer|Array<number>} bytes - Raw proof bytes.
 * @param {string} [name='proof.bin'] - Optional proof name, sent as `X-StableTrust-Filename` metadata.
 * @param {Object} [options]
 * @param {string} [options.uploadUrl] - StableTrust IPFS upload endpoint.
 * @param {string} [options.apiKey] - Bearer token for upload endpoint.
 * @returns {Promise<string>} Bare CID string.
 */
export async function uploadBytesToIpfs(bytes, name = "proof.bin", options = {}) {
  const { uploadUrl, apiKey } = _resolveIpfsUploadOptions(options);
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (uint8.length === 0) {
    throw new Error("cannot upload an empty proof to IPFS");
  }

  const headers = {
    "Content-Type": "application/octet-stream",
  };
  if (name) {
    headers["X-StableTrust-Filename"] = String(name);
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: uint8,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`StableTrust IPFS upload failed: ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  let cid;
  if (contentType.includes("application/json")) {
    const jsonRes = await res.json();
    cid = jsonRes?.cid ?? jsonRes?.CID ?? jsonRes?.Cid ?? jsonRes?.Hash ?? jsonRes?.hash;
  } else {
    cid = await res.text();
  }

  cid = String(cid || "").trim().replace(/^ipfs:\/\//i, "");
  if (!cid) {
    throw new Error("StableTrust IPFS upload returned no CID");
  }

  return cid;
}

