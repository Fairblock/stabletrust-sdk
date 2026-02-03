import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import init, {
  generate_deterministic_keypair,
  generate_transfer_proof,
  generate_withdraw_proof,
  decrypt_ciphertext,
} from "../pkg/confidential_transfer_proof_generation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isInitialized = false;

/**
 * Initialize the WASM module
 * This must be called before using the SDK
 *
 * @param {Buffer|Uint8Array|string} [wasmPath] - Optional custom WASM file path or buffer
 * @returns {Promise<Object>} WASM module functions
 */
export async function initializeWasm(wasmPath) {
  if (isInitialized) {
    return {
      generate_deterministic_keypair,
      generate_transfer_proof,
      generate_withdraw_proof,
      decrypt_ciphertext,
    };
  }

  try {
    let wasmBuffer;

    if (wasmPath) {
      // If a custom path or buffer is provided
      if (typeof wasmPath === "string") {
        wasmBuffer = fs.readFileSync(wasmPath);
      } else {
        wasmBuffer = wasmPath;
      }
    } else {
      // Use the bundled WASM file
      const defaultWasmPath = path.resolve(
        __dirname,
        "../pkg/confidential_transfer_proof_generation_bg.wasm",
      );
      wasmBuffer = fs.readFileSync(defaultWasmPath);
    }

    await init(wasmBuffer);
    isInitialized = true;

    return {
      generate_deterministic_keypair,
      generate_transfer_proof,
      generate_withdraw_proof,
      decrypt_ciphertext,
    };
  } catch (error) {
    throw new Error(
      `Failed to initialize WASM module: ${error.message}. ` +
        `Make sure the WASM file exists at the expected location.`,
    );
  }
}

/**
 * Check if WASM module is initialized
 * @returns {boolean}
 */
export function isWasmInitialized() {
  return isInitialized;
}

/**
 * Export WASM functions (they will only work after initialization)
 */
export {
  generate_deterministic_keypair,
  generate_transfer_proof,
  generate_withdraw_proof,
  decrypt_ciphertext,
};
