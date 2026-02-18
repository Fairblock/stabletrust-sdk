export { ConfidentialTransferClient } from "./client.js";
export { deriveKeys, decryptCiphertext, combineCiphertext } from "./crypto.js";
export { encodeTransferProof, encodeWithdrawProof } from "./utils.js";
export {
  CONTRACT_ABI,
  ERC20_ABI,
  STABLETRUST_CONTRACTS_BY_CHAIN_ID,
  getStableTrustContractAddress,
} from "./constants.js";
// Note: initializeWasm is now internal - WASM auto-initializes on first client use
