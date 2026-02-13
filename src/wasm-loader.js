import init, {
  generate_deterministic_keypair,
  generate_transfer_proof,
  generate_withdraw_proof,
  decrypt_ciphertext,
} from "../pkg/confidential_transfer_proof_generation.js";

let isInitialized = false;
let initPromise = null;

/**
 * Initialize the WASM module
 * This must be called before using the SDK
 *
 * In browsers, the WASM file is automatically loaded using bundler's asset handling.
 * In Node.js, the WASM file is loaded from the filesystem.
 *
 * @param {Buffer|Uint8Array|string|URL} [input] - Optional custom WASM file path, URL, or buffer
 * @returns {Promise<Object>} WASM module functions
 */
export async function initializeWasm(input) {
  // Return existing initialization if already in progress or complete
  if (initPromise) {
    await initPromise;
    return {
      generate_deterministic_keypair,
      generate_transfer_proof,
      generate_withdraw_proof,
      decrypt_ciphertext,
    };
  }

  if (isInitialized) {
    return {
      generate_deterministic_keypair,
      generate_transfer_proof,
      generate_withdraw_proof,
      decrypt_ciphertext,
    };
  }

  // Create initialization promise
  initPromise = (async () => {
    try {
      // Detect Node.js environment
      const isNode =
        typeof process !== "undefined" &&
        process.versions != null &&
        process.versions.node != null;

      if (input) {
        // User provided custom input
        await init(input);
      } else if (isNode) {
        // Node.js: Load from filesystem
        const fs = await import("fs");
        const path = await import("path");
        const { fileURLToPath } = await import("url");

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const wasmPath = path.resolve(
          __dirname,
          "../pkg/confidential_transfer_proof_generation_bg.wasm",
        );
        const wasmBuffer = fs.readFileSync(wasmPath);

        await init(wasmBuffer);
      } else {
        // Browser: Let the generated code handle it automatically
        // It will use new URL(..., import.meta.url) which bundlers handle correctly
        await init();
      }

      isInitialized = true;
    } catch (error) {
      initPromise = null; // Reset on failure so it can be retried
      throw new Error(
        `Failed to initialize WASM module: ${error.message}. ` +
          `Make sure the WASM file exists at the expected location.`,
      );
    }
  })();

  await initPromise;

  return {
    generate_deterministic_keypair,
    generate_transfer_proof,
    generate_withdraw_proof,
    decrypt_ciphertext,
  };
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
