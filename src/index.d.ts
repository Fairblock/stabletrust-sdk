declare module "@fairblock/stabletrust" {
  import { ethers } from "ethers";

  /**
   * SDK configuration
   */
  export interface SdkConfig {
    rpcUrl: string;
    contractAddress: string;
    chainId: number;
  }

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
   * Default configuration values
   */
  export const DEFAULT_CONFIG: {
    CHAIN_ID: number;
    EXPLORER_URL: string;
  };
}
