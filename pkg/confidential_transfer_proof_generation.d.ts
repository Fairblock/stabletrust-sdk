/* tslint:disable */
/* eslint-disable */
export function generate_withdraw_proof(input: string): string;
export function decrypt_ciphertext(ciphertext_base64: string, keypair_base64: string): string;
/**
 * Generate a deterministic ElGamal keypair from an EIP-712 signature
 */
export function generate_deterministic_keypair(signature_hex: string, domain_context: string): string;
export function test_wasm(): string;
export function generate_transfer_proof(input: string): string;
/**
 * Decode transfer proof from contract input data and extract transfer amount ciphertext
 * handle_index: 0 for sender, 1 for recipient
 */
export function decode_transfer_proof(validity_proof_base64: string, handle_index: number): string;
/**
 * Generate a random ElGamal keypair (for compatibility)
 */
export function generate_keypair(): string;
export function encrypt_amount(amount: bigint, pubkey_base64: string): string;
/**
 * Generate a deterministic ElGamal keypair using legacy method (for backward compatibility)
 */
export function generate_deterministic_keypair_legacy(signature_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly decode_transfer_proof: (a: number, b: number, c: number, d: number) => void;
  readonly decrypt_ciphertext: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly encrypt_amount: (a: number, b: bigint, c: number, d: number) => void;
  readonly generate_deterministic_keypair: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly generate_deterministic_keypair_legacy: (a: number, b: number, c: number) => void;
  readonly generate_keypair: (a: number) => void;
  readonly generate_transfer_proof: (a: number, b: number, c: number) => void;
  readonly generate_withdraw_proof: (a: number, b: number, c: number) => void;
  readonly test_wasm: (a: number) => void;
  readonly __wbindgen_export_0: (a: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_export_3: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
