declare module "@fairblock/stabletrust" {
  import { ethers } from "ethers";

  // ─────────────────── AnonymousTransferClient ────────────────────────────

  export interface AnonymousTransferClientConfig {
    /** Fairycloak relay server base URL, e.g. "http://127.0.0.1:8080" */
    fairycloakUrl: string;
    /** Diamond contract address (EVM mirror) */
    diamondAddress: string;
    /** Chain ID */
    chainId: number | string;
    /** EVM JSON-RPC URL */
    rpcUrl: string;
    /** Optional API key for Fairycloak */
    apiKey?: string;
  }

  export interface AnonymousAccountInfo {
    exists: boolean;
    finalized: boolean;
    hasPendingAction: boolean;
    txId: bigint;
    elgamalPubkey: string;
    authNonce: bigint;
  }

  export interface FairycloakResponse {
    request_id: string;
    tx_hash?: string;
    status: string;
    action?: string;
    [key: string]: unknown;
  }

  export interface RequestEventHistory {
    request_id: string;
    events: Array<{
      request_id: string;
      sequence: number;
      type: string;
      action: string;
      status: string;
      created_at: string;
      [key: string]: unknown;
    }>;
  }

  export interface TransferProofParams {
    currentBalanceCiphertext: string;
    currentBalanceContractScale: number;
    transferAmountContractScale: number;
    destinationPublicKey: string;
  }

  export interface WithdrawProofParams {
    currentBalanceCiphertext: string;
    currentBalanceContractScale: number;
    withdrawAmountContractScale: number;
  }

  export interface TransferToPublicParams {
    recipient: string;
    token: string;
    /** Pre-computed ZK proof hex. Required if elGamalPrivateKey is not provided. */
    proof?: string;
    /** ElGamal private key (base64) for auto-proof generation. */
    elGamalPrivateKey?: string;
    /** Transfer amount in token units (e.g. 3000000 for 3 USDC). Required for auto-proof. */
    amount?: bigint | string | number;
    /** Recipient ElGamal public key (base64). Auto-resolved from the chain if omitted. */
    destinationPublicKey?: string;
    useOffchainVerify?: boolean;
  }

  export interface TransferToAnonymousParams {
    recipientId: number | bigint;
    token: string;
    /** Pre-computed ZK proof hex. Required if elGamalPrivateKey is not provided. */
    proof?: string;
    /** ElGamal private key (base64) for auto-proof generation. */
    elGamalPrivateKey?: string;
    /** Transfer amount in token units (e.g. 2000000 for 2 USDC). Required for auto-proof. */
    amount?: bigint | string | number;
    /** Recipient ElGamal public key (base64). Auto-resolved from the chain if omitted. */
    destinationPublicKey?: string;
    useOffchainVerify?: boolean;
  }

  export interface WithdrawParams {
    destination: string;
    token: string;
    /** Withdrawal amount in token units. */
    plainAmount: bigint | string | number;
    /** Pre-computed ZK proof hex. Required if elGamalPrivateKey is not provided. */
    proof?: string;
    /** ElGamal private key (base64) for auto-proof generation. Contract scale is derived automatically. */
    elGamalPrivateKey?: string;
    useOffchainVerify?: boolean;
  }

  export interface AnonymousAccountBalance {
    /** Total balance: available + pending. Same units as amounts passed to deposit/transfer/withdraw. */
    amount: number;
    /** Spendable balance (already settled on-chain). */
    available: number;
    /** Incoming balance not yet applied via applyPending(). */
    pending: number;
  }

  export interface AnonymousBalanceEntry {
    /** Decrypted balance in contract-scale units (plainAmount × tokenMul). */
    amount: number;
    /** Base64 combined ciphertext, or null if no balance exists. */
    ciphertext: string | null;
  }

  export interface AnonymousBalance {
    available: AnonymousBalanceEntry;
    pending: AnonymousBalanceEntry;
  }

  export interface UpdateAuthKeysParams {
    add?: Array<string | ethers.Wallet>;
    remove?: Array<string | ethers.Wallet>;
  }

  export interface WaitForRequestOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }

  export interface DeadlineOptions {
    deadlineOffset?: number;
  }

  export interface DepositOptions extends DeadlineOptions {
    gasLimit?: bigint;
  }

  /**
   * AnonymousTransferClient — SDK class for anonymous confidential transfers via the Fairycloak relay.
   *
   * All operations (except `deposit`) are gas-free for the user — Fairycloak pays gas.
   * `deposit` requires the user to sign and pay for a raw EVM transaction.
   */
  export class AnonymousTransferClient {
    constructor(config: AnonymousTransferClientConfig);

    // ── on-chain reads ──────────────────────────────────────────────

    /**
     * Get on-chain core state for an anonymous account.
     */
    getAnonymousAccountInfo(
      accountId: number | bigint,
    ): Promise<AnonymousAccountInfo>;

    /**
     * Read the current authNonce for an anonymous account.
     */
    getAuthNonce(accountId: number | bigint): Promise<bigint>;

    /**
     * Read the next anonymous account ID that will be assigned.
     */
    getNextAccountId(): Promise<bigint>;

    /**
     * Check whether an address is an authorised signer for an anonymous account.
     */
    isAuthorizedSigner(
      accountId: number | bigint,
      signerAddress: string,
    ): Promise<boolean>;

    /**
     * Get the decrypted balance summary (available + pending) for an anonymous account.
     * Returns plain numbers in the same units as the amounts passed to deposit/transfer/withdraw.
     * Use `.available` and `.pending` for individual balances, `.amount` for the total.
     */
    getBalance(
      accountId: number | bigint,
      tokenAddress: string,
      elGamalPrivateKey: string,
    ): Promise<AnonymousAccountBalance>;

    /**
     * Get the decrypted available and pending balances, including raw ciphertexts.
     * Use `getBalance` for a simpler numeric summary.
     */
    getAnonymousBalance(
      accountId: number | bigint,
      tokenAddress: string,
      elGamalPrivateKey: string,
    ): Promise<AnonymousBalance>;

    // ── key derivation ──────────────────────────────────────────────

    /**
     * Derive a deterministic ElGamal keypair for an anonymous account.
     * Tied to (chainId, diamondAddress, accountId, authWallet).
     */
    deriveAnonymousKeys(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: number | bigint,
    ): Promise<Keys>;

    // ── proof generation ────────────────────────────────────────────

    /**
     * Generate a ZK transfer proof via WASM.
     * Pass the returned string to `transferToPublic` or `transferToAnonymous`.
     */
    generateTransferProof(
      elGamalPrivateKey: string,
      params: TransferProofParams,
    ): Promise<string>;

    /**
     * Generate a ZK withdraw proof via WASM.
     * Pass the returned string to `withdraw`.
     */
    generateWithdrawProof(
      elGamalPrivateKey: string,
      params: WithdrawProofParams,
    ): Promise<string>;

    // ── Fairycloak operations ───────────────────────────────────────

    /**
     * Create a new anonymous account. The relay pays gas.
     * @param elgamalPublicKey Base64 or "0x"-prefixed hex (32 bytes)
     */
    createAccount(
      authWallet: ethers.Wallet | ethers.Signer,
      elgamalPublicKey: string,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Update the set of authorised signers. The relay pays gas.
     * Pass ethers.Wallet objects or raw uncompressed hex pubkey strings.
     */
    updateAuthKeys(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: number | bigint,
      keys: UpdateAuthKeysParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Deposit tokens. The user pays gas for this raw EVM transaction.
     * Handles ERC-20 approval automatically.
     */
    deposit(
      authWallet: ethers.Wallet,
      accountId: number | bigint,
      tokenAddress: string,
      amount: bigint | string | number,
      options?: DepositOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Transfer from an anonymous account to a public EVM address. The relay pays gas.
     *
     * Auto-proof: pass `elGamalPrivateKey`, `transferAmountContractScale`, and `destinationPublicKey`.
     * Manual proof: pass a pre-computed `proof` hex string from `generateTransferProof()`.
     */
    transferToPublic(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: number | bigint,
      params: TransferToPublicParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Transfer between two anonymous accounts. The relay pays gas.
     *
     * Auto-proof: pass `elGamalPrivateKey`, `transferAmountContractScale`, and `destinationPublicKey`.
     * Manual proof: pass a pre-computed `proof` hex string from `generateTransferProof()`.
     */
    transferToAnonymous(
      authWallet: ethers.Wallet | ethers.Signer,
      senderAccountId: number | bigint,
      params: TransferToAnonymousParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Apply a pending balance (move incoming credit to available). The relay pays gas.
     */
    applyPending(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: number | bigint,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Withdraw from an anonymous account to a public address. The relay pays gas.
     *
     * Auto-proof: pass `elGamalPrivateKey` and `withdrawAmountContractScale` — the SDK fetches
     * the ciphertext and generates the proof internally.
     * Manual proof: pass a pre-computed `proof` hex string from `generateWithdrawProof()`.
     */
    withdraw(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: number | bigint,
      params: WithdrawParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    // ── request tracking ────────────────────────────────────────────

    /**
     * Get the current status of a Fairycloak request.
     * Terminal statuses: completed | failed
     * Tx statuses: confirmed | mined | submitted
     */
    getRequestStatus(requestId: string): Promise<FairycloakResponse>;

    /**
     * Fetch durable event history for a request.
     */
    getRequestEvents(
      requestId: string,
      options?: { afterSeq?: number; limit?: number },
    ): Promise<RequestEventHistory>;

    /**
     * Poll until a request reaches a terminal state (completed/confirmed/failed).
     */
    waitForRequest(
      requestId: string,
      options?: WaitForRequestOptions,
    ): Promise<FairycloakResponse>;
  }

  /**
   * SDK configuration
   */
  export interface SdkConfig {
    rpcUrl: string;
    contractAddress: string;
    chainId: number;
  }

  export type StableTrustChainId =
    | 1244
    | 2201
    | 42431
    | 84532
    | 421614
    | 11155111;

  /**
   * Encryption keys
   */
  export interface Keys {
    publicKey: string;
    privateKey: string;
  }

  /**
   * Balance information
   */
  export interface Balance {
    amount: number;
    ciphertext: string | null;
  }

  /**
   * Confidential balance summary
   */
  export interface ConfidentialBalance {
    amount: number;
    available: Balance;
    pending: Balance;
  }

  /**
   * Account options
   */
  export interface AccountOptions {
    waitForFinalization?: boolean;
    maxAttempts?: number;
  }

  /**
   * Deposit options
   */
  export interface DepositOptions {
    waitForFinalization?: boolean;
  }

  /**
   * Transfer options
   */
  export interface TransferOptions {
    useOffchainVerify?: boolean;
    waitForFinalization?: boolean;
  }

  /**
   * Withdraw options
   */
  export interface WithdrawOptions {
    useOffchainVerify?: boolean;
    waitForFinalization?: boolean;
  }

  /**
   * Main SDK client class
   * WASM auto-initializes on first use - no manual initialization required!
   */
  export class ConfidentialTransferClient {
    /**
     * Create a new ConfidentialTransferClient
     * @param rpcUrl RPC endpoint URL
     * @param chainId Chain ID (uses default StableTrust contract for known networks)
     */
    constructor(rpcUrl: string, chainId: number);

    /**
     * Create a new ConfidentialTransferClient
     * @param rpcUrl RPC endpoint URL
     * @param contractAddress Confidential transfer contract address
     * @param chainId Chain ID
     */
    constructor(rpcUrl: string, contractAddress: string, chainId: number);

    /**
     * Get account information from the contract
     */
    getAccountInfo(address: string): Promise<any>;

    /**
     * Create a confidential account if it doesn't exist and wait for finalization
     */
    ensureAccount(
      wallet: ethers.Wallet | ethers.Signer,
      options?: AccountOptions,
    ): Promise<Keys>;

    /**
     * Get total decrypted balance (available + pending) for an address
     * @param address Account address
     * @param privateKey Private key for decryption
     * @param tokenAddress Token contract address
     */
    getConfidentialBalance(
      address: string,
      privateKey: string,
      tokenAddress: string,
    ): Promise<ConfidentialBalance>;

    /**
     * Deposit tokens into confidential account
     * @param wallet Wallet to deposit from
     * @param tokenAddress Token contract address to deposit
     * @param amount Amount to deposit
     * @param options Deposit options
     */
    confidentialDeposit(
      wallet: ethers.Wallet | ethers.Signer,
      tokenAddress: string,
      amount: bigint | string | number,
      options?: DepositOptions,
    ): Promise<ethers.ContractTransactionReceipt>;

    /**
     * Transfer confidential tokens to another address
     * All necessary data is derived automatically - you only need the wallet and recipient info
     * @param senderWallet Sender's wallet
     * @param recipientAddress Recipient's address
     * @param tokenAddress Token contract address to transfer
     * @param amount Amount to transfer
     * @param options Transfer options
     */
    confidentialTransfer(
      senderWallet: ethers.Wallet | ethers.Signer,
      recipientAddress: string,
      tokenAddress: string,
      amount: number,
      options?: TransferOptions,
    ): Promise<ethers.ContractTransactionReceipt>;

    /**
     * Withdraw confidential tokens to public ERC20
     * @param wallet Wallet to withdraw to
     * @param tokenAddress Token contract address to withdraw
     * @param amount Amount to withdraw
     * @param options Withdrawal options
     */
    withdraw(
      wallet: ethers.Wallet | ethers.Signer,
      tokenAddress: string,
      amount: number,
      options?: WithdrawOptions,
    ): Promise<ethers.ContractTransactionReceipt>;

    /**
     * Get the current fee amount for confidential transfers
     */
    getFeeAmount(): Promise<bigint>;

    /**
     * Get the public ERC20 balance for an address (for comparison with confidential balance)
     * @param address Account address
     * @param tokenAddress Token contract address
     */
    getPublicBalance(address: string, tokenAddress: string): Promise<bigint>;
  }

  /**
   * Cryptography utilities
   */

  /**
   * Derive encryption keys for a wallet
   */
  export function deriveKeys(
    wallet: ethers.Wallet | ethers.Signer,
    domainContext: { chainId: number; contractAddress: string },
    generateKeypairFn: (signature: string, context: string) => string,
  ): Promise<Keys>;

  /**
   * Decrypt a ciphertext using a private key
   */
  export function decryptCiphertext(
    ciphertext: string,
    privateKey: string,
    decryptFn: (ciphertext: string, privateKey: string) => string,
  ): number;

  /**
   * Combine two ciphertext parts (c1, c2)
   */
  export function combineCiphertext(c1: string, c2: string): string;

  /**
   * Utilities
   */

  /**
   * Encode a transfer proof for contract submission
   */
  export function encodeTransferProof(proof: any): string;

  /**
   * Encode a withdraw proof for contract submission
   */
  export function encodeWithdrawProof(proof: any): string;

  /**
   * Constants
   */

  /**
   * Contract ABI
   */
  export const CONTRACT_ABI: any[];

  /**
   * ERC20 ABI
   */
  export const ERC20_ABI: any[];

  /**
   * StableTrust contract addresses by chain id
   */
  export const STABLETRUST_CONTRACTS_BY_CHAIN_ID: Record<number, string>;

  /**
   * Resolve StableTrust contract address by chain id
   */
  export function getStableTrustContractAddress(chainId: number): string | null;
}
