declare module "@fairblock/stabletrust" {
  import { ethers } from "ethers";

  // ─────────────────── AnonymousTransferClient ────────────────────────────

  export interface AnonymousTransferClientConfig {
    /** Fairycloak relay server base URL, e.g. "http://127.0.0.1:8080" */
    fairycloakUrl: string;
    /** Chain ID — used to auto-resolve the contract address for supported networks */
    chainId: number | string;
    /** EVM JSON-RPC URL */
    rpcUrl: string;
    /** Optional override for the diamond contract address. Auto-resolved from chainId if omitted. */
    diamondAddress?: string;
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
    /**
     * The *next* contract-level per-account transaction ID ("user tx-id + 1").
     * Withdraw proofs commit to the txId the account will have **after** the
     * withdrawal is processed — pass `txId + 1`, not the current `txId`.
     *
     * - Confidential accounts: `Number(getAccountInfo(address).txId) + 1`
     * - Anonymous accounts:    `getAnonymousAccountInfo(accountId).txId + 1n`
     *
     * This is NOT the Ethereum account nonce, and NOT the EIP-712 `authNonce`.
     */
    nonce: number | bigint;
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
  }

  export interface TransferToAnonymousParams {
    recipientId: string;
    token: string;
    /** Pre-computed ZK proof hex. Required if elGamalPrivateKey is not provided. */
    proof?: string;
    /** ElGamal private key (base64) for auto-proof generation. */
    elGamalPrivateKey?: string;
    /** Transfer amount in token units (e.g. 2000000 for 2 USDC). Required for auto-proof. */
    amount?: bigint | string | number;
    /** Recipient ElGamal public key (base64). Auto-resolved from the chain if omitted. */
    destinationPublicKey?: string;
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

  export interface DepositFeesOptions extends DeadlineOptions {
    gasLimit?: bigint;
  }

  export interface WithdrawFeesParams {
    /** Fee token address (use `getFeeToken()` to get the active token). */
    token: string;
    /** Destination EVM address to receive the withdrawn tokens. */
    destination: string;
    /** Amount in raw ERC-20 units of the fee token. */
    amount: bigint | string | number;
  }

  export interface WithdrawAllFeesParams {
    /** Destination EVM address to receive all withdrawn fee tokens. */
    destination: string;
  }

  /**
   * AnonymousTransferClient — SDK class for anonymous confidential transfers via the Fairycloak relay.
   *
   * All operations (except `deposit`) are gas-free for the user — Fairycloak pays gas.
   * `deposit` requires the user to sign and pay for a raw EVM transaction.
   *
   * ### Anonymous account ID rules
   * Every `accountId` / `senderAccountId` / `recipientId` passed to this client must:
   * - be a non-empty string
   * - be at most {@link MAX_ANONYMOUS_ACCOUNT_ID_LENGTH} (20) characters
   * - contain only alphanumeric characters (A-Z, a-z, 0-9)
   * - be treated as case-sensitive (no normalization is applied)
   *
   * IDs that violate these rules are rejected with a descriptive error before any
   * network request is made. See `validateAnonymousAccountId`.
   */
  export class AnonymousTransferClient {
    constructor(config: AnonymousTransferClientConfig);

    // ── on-chain reads ──────────────────────────────────────────────

    /**
     * Get on-chain core state for an anonymous account.
     */
    getAnonymousAccountInfo(accountId: string): Promise<AnonymousAccountInfo>;

    /**
     * Read the current authNonce for an anonymous account.
     */
    getAuthNonce(accountId: string): Promise<bigint>;

    /**
     * Check whether an address is an authorised signer for an anonymous account.
     */
    isAuthorizedSigner(
      accountId: string,
      signerAddress: string,
    ): Promise<boolean>;

    /**
     * Get the decrypted balance summary (available + pending) for an anonymous account.
     * Returns plain numbers in the same units as the amounts passed to deposit/transfer/withdraw.
     * Use `.available` and `.pending` for individual balances, `.amount` for the total.
     */
    getBalance(
      accountId: string,
      tokenAddress: string,
      elGamalPrivateKey: string,
    ): Promise<AnonymousAccountBalance>;

    /**
     * Get the decrypted available and pending balances, including raw ciphertexts.
     * Use `getBalance` for a simpler numeric summary.
     */
    getAnonymousBalance(
      accountId: string,
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
      accountId: string,
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

    // ── prepaid fee reads ───────────────────────────────────────────

    /**
     * Get the currently configured fee token address from the contract.
     * Deposits via `depositFees` must use this token.
     */
    getFeeToken(): Promise<string>;

    /**
     * Get the protocol fee amount in raw ERC-20 units of the fee token.
     * This is the amount deducted per anonymous transfer. Returns 0n if no fee is set.
     */
    getFeeAmount(): Promise<bigint>;

    /**
     * Get the prepaid fee balance for an anonymous account and token (raw ERC-20 units).
     * Use `getFeeToken()` to get the active fee token address.
     */
    getPrepaidFeeBalance(accountId: string, token: string): Promise<bigint>;

    // ── prepaid fee actions ─────────────────────────────────────────

    /**
     * Deposit tokens into the prepaid fee reserve for an anonymous account.
     * The user wallet pays gas for this raw EVM transaction.
     * Handles ERC-20 approval automatically.
     *
     * The fee token is read from the contract — use `getFeeToken()` to see it.
     * Use `getFeeAmount()` to see how much is deducted per transfer.
     *
     * @param amount Amount in raw ERC-20 units of the active fee token
     */
    depositFees(
      authWallet: ethers.Wallet,
      accountId: string,
      amount: bigint | string | number,
      options?: DepositFeesOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Withdraw a specific amount from the prepaid fee reserve. The relay pays gas.
     * Supports historical fee tokens (after a fee-token rotation).
     */
    withdrawFees(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: string,
      params: WithdrawFeesParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Withdraw all prepaid fee balances across all (including historical) fee tokens.
     * The relay pays gas.
     */
    withdrawAllFees(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: string,
      params: WithdrawAllFeesParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    // ── Fairycloak operations ───────────────────────────────────────

    /**
     * Create a new anonymous account. The relay pays gas.
     * @param accountId Caller-chosen account ID. Must be a non-empty, case-sensitive,
     *   alphanumeric string of at most {@link MAX_ANONYMOUS_ACCOUNT_ID_LENGTH} (20) characters.
     * @param elgamalPublicKey Base64 or "0x"-prefixed hex (32 bytes)
     */
    createAccount(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: string,
      elgamalPublicKey: string,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Update the set of authorised signers. The relay pays gas.
     * Pass ethers.Wallet objects or raw uncompressed hex pubkey strings.
     */
    updateAuthKeys(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: string,
      keys: UpdateAuthKeysParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Deposit tokens. The user pays gas for this raw EVM transaction.
     * Handles ERC-20 approval automatically.
     */
    deposit(
      authWallet: ethers.Wallet,
      accountId: string,
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
      accountId: string,
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
      senderAccountId: string,
      params: TransferToAnonymousParams,
      options?: DeadlineOptions,
    ): Promise<FairycloakResponse>;

    /**
     * Apply a pending balance (move incoming credit to available). The relay pays gas.
     */
    applyPending(
      authWallet: ethers.Wallet | ethers.Signer,
      accountId: string,
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
      accountId: string,
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
    | 5042002
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
  export interface ConfidentialDepositOptions {
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
     * @param chainId Chain ID (uses default Stabletrust contract for known networks)
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
      options?: ConfidentialDepositOptions,
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
   * Maximum allowed length for an anonymous account ID (20 characters).
   */
  export const MAX_ANONYMOUS_ACCOUNT_ID_LENGTH: number;

  /**
   * Validate an anonymous account ID.
   *
   * Rules (must match the Fairycloak relay and on-chain contract):
   * - Non-empty string
   * - At most {@link MAX_ANONYMOUS_ACCOUNT_ID_LENGTH} (20) characters
   * - Alphanumeric characters only (A-Z, a-z, 0-9)
   * - Case-sensitive (no normalization is applied)
   *
   * @throws {Error} If `accountId` violates any of the above rules.
   */
  export function validateAnonymousAccountId(
    accountId: string,
    fieldName?: string,
  ): void;

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
   * Stabletrust contract addresses by chain id
   */
  export const STABLETRUST_CONTRACTS_BY_CHAIN_ID: Record<number, string>;

  /**
   * Resolve Stabletrust contract address by chain id
   */
  export function getStabletrustContractAddress(chainId: number): string | null;
}
