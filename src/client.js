import { ethers } from "ethers";
import { CONTRACT_ABI, ERC20_ABI, DEFAULT_CONFIG } from "./constants.js";
import { deriveKeys, decryptCiphertext, combineCiphertext } from "./crypto.js";
import { encodeTransferProof, encodeWithdrawProof, sleep } from "./utils.js";
import { initializeWasm } from "./wasm-loader.js";

// Auto-initialize WASM on first use
let wasmModulePromise = null;

function getWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = initializeWasm();
  }
  return wasmModulePromise;
}

/**
 * ConfidentialTransferClient - Main SDK class for confidential transfers
 */
export class ConfidentialTransferClient {
  /**
   * Create a new ConfidentialTransferClient instance
   *
   * @param {Object} config - Configuration object
   * @param {string} config.rpcUrl - RPC endpoint URL
   * @param {string} config.contractAddress - Confidential transfer contract address
   * @param {number} [config.chainId] - Chain ID (default: 421614)
   * @param {string} [config.explorerUrl] - Block explorer URL
   */
  constructor(config) {
    // Validate required config
    if (!config) {
      throw new Error("Configuration object is required");
    }
    if (!config.rpcUrl) {
      throw new Error("config.rpcUrl is required");
    }
    if (!config.contractAddress) {
      throw new Error("config.contractAddress is required");
    }

    // Merge config with defaults
    this.config = {
      chainId: DEFAULT_CONFIG.CHAIN_ID,
      explorerUrl: DEFAULT_CONFIG.EXPLORER_URL,
      ...config,
    };

    // WASM will be auto-initialized on first use
    this._wasmModule = null;

    try {
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      this.contract = new ethers.Contract(
        this.config.contractAddress,
        CONTRACT_ABI,
        this.provider,
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize contracts: ${error.message}. Check your RPC URL and contract addresses.`,
      );
    }
  }

  /**
   * Get WASM module (auto-initializes if needed)
   * @private
   */
  async _getWasm() {
    if (!this._wasmModule) {
      this._wasmModule = await getWasmModule();
    }
    return this._wasmModule;
  }

  /**
   * Get token contract for a specific token
   * @private
   */
  _getTokenContract(tokenAddress) {
    return new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
  }

  /**
   * Derive encryption keys for a wallet
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to derive keys for
   * @returns {Promise<{publicKey: string, privateKey: string}>}
   */
  async deriveKeys(wallet) {
    try {
      if (!wallet) {
        throw new Error("Wallet is required");
      }
      const wasm = await this._getWasm();
      return await deriveKeys(
        wallet,
        {
          chainId: this.config.chainId,
          contractAddress: this.config.contractAddress,
        },
        wasm.generate_deterministic_keypair,
      );
    } catch (error) {
      throw new Error(`Failed to derive keys: ${error.message}`);
    }
  }

  /**
   * Get account information from the contract
   *
   * @param {string} address - Account address
   * @returns {Promise<Object>} Account core information
   */
  async getAccountInfo(address) {
    try {
      if (!address || !ethers.isAddress(address)) {
        throw new Error(`Invalid address: ${address}`);
      }
      return await this.contract.getAccountCore(address);
    } catch (error) {
      throw new Error(`Failed to get account info: ${error.message}`);
    }
  }

  /**
   * Create a confidential account if it doesn't exist and wait for finalization
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to create account for
   * @param {Object} [options] - Options
   * @param {boolean} [options.waitForFinalization=true] - Wait for account finalization
   * @param {number} [options.maxAttempts=30] - Max attempts to wait for finalization
   * @returns {Promise<{publicKey: string, privateKey: string}>} The derived keys
   */
  async ensureAccount(wallet, options = {}) {
    const { waitForFinalization = true, maxAttempts = 30 } = options;

    try {
      const address = await wallet.getAddress();
      const keys = await this.deriveKeys(wallet);
      let accountInfo = await this.getAccountInfo(address);

      if (!accountInfo.exists) {
        const tx = await this.contract
          .connect(wallet)
          .createConfidentialAccount(Buffer.from(keys.publicKey, "base64"));

        const receipt = await tx.wait();
        if (!receipt || receipt.status === 0) {
          throw new Error("Account creation transaction failed");
        }

        // Refresh account info after creation
        accountInfo = await this.getAccountInfo(address);
      }

      if (waitForFinalization) {
        let attempts = 0;
        while (!accountInfo.finalized && attempts < maxAttempts) {
          await sleep(2000);
          accountInfo = await this.getAccountInfo(address);
          attempts++;
        }

        if (!accountInfo.finalized) {
          throw new Error(
            `Account finalization timeout after ${maxAttempts} attempts. The account was created but may not be ready yet.`,
          );
        }
      }

      return keys;
    } catch (error) {
      if (error.message.includes("Account finalization timeout")) {
        throw error;
      }
      throw new Error(`Failed to ensure account: ${error.message}`);
    }
  }

  /**
   * Get decrypted balance for an address
   *
   * @param {string} address - Account address
   * @param {string} privateKey - Private key for decryption
   * @param {string} tokenAddress - Token address
   * @param {Object} [options] - Options
   * @param {string} [options.type='available'] - Balance type: 'available' or 'pending'
   * @returns {Promise<{amount: number, ciphertext: string|null}>}
   */
  async getBalance(address, privateKey, tokenAddress, options = {}) {
    const { type = "available" } = options;

    try {
      if (!address || !ethers.isAddress(address)) {
        throw new Error(`Invalid address: ${address}`);
      }
      if (!privateKey) {
        throw new Error("Private key is required for decryption");
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }

      let c1, c2;
      if (type.toLowerCase() === "pending") {
        [c1, c2] = await this.contract.getPending(address, tokenAddress);
      } else {
        [c1, c2] = await this.contract.getAvailable(address, tokenAddress);
      }

      if ((!c1 || c1 === "0x") && (!c2 || c2 === "0x")) {
        return { amount: 0, ciphertext: null };
      }

      const wasm = await this._getWasm();
      const ciphertext = combineCiphertext(c1, c2);
      const amount = decryptCiphertext(
        ciphertext,
        privateKey,
        wasm.decrypt_ciphertext,
      );

      return { amount, ciphertext };
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Deposit tokens into confidential account
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to deposit from
   * @param {string} tokenAddress - Token address to deposit
   * @param {bigint|string|number} amount - Amount to deposit (in token units)
   * @param {Object} [options] - Options
   * @param {boolean} [options.waitForFinalization=true] - Wait for deposit finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async deposit(wallet, tokenAddress, amount, options = {}) {
    const { waitForFinalization = true } = options;

    try {
      if (!wallet) {
        throw new Error("Wallet is required");
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!amount || BigInt(amount) <= 0) {
        throw new Error("Amount must be greater than 0");
      }

      const address = await wallet.getAddress();
      const depositAmount = BigInt(amount);
      const tokenContract = this._getTokenContract(tokenAddress);

      // Check token balance
      const tokenBalance = await tokenContract.balanceOf(address);
      if (tokenBalance < depositAmount) {
        throw new Error(
          `Insufficient token balance. Required: ${depositAmount}, Available: ${tokenBalance}`,
        );
      }

      // Check and approve if needed
      const allowance = await tokenContract.allowance(
        address,
        this.config.contractAddress,
      );

      if (allowance < depositAmount) {
        const approveTx = await tokenContract
          .connect(wallet)
          .approve(this.config.contractAddress, ethers.MaxUint256);

        const approveReceipt = await approveTx.wait();
        if (!approveReceipt || approveReceipt.status === 0) {
          throw new Error("Token approval failed");
        }
      }

      // Perform deposit
      const depositTx = await this.contract
        .connect(wallet)
        .deposit(tokenAddress, depositAmount);

      const receipt = await depositTx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Deposit transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(address, "deposit");
      }

      return receipt;
    } catch (error) {
      if (error.message.includes("Insufficient token balance")) {
        throw error;
      }
      throw new Error(`Failed to deposit: ${error.message}`);
    }
  }

  /**
   * Transfer confidential tokens to another address
   *
   * @param {ethers.Wallet|ethers.Signer} senderWallet - Sender's wallet
   * @param {string} recipientAddress - Recipient's address
   * @param {string} tokenAddress - Token address to transfer
   * @param {number} amount - Amount to transfer
   * @param {Object} senderKeys - Sender's encryption keys
   * @param {string} recipientPublicKey - Recipient's public key
   * @param {string} currentBalanceCiphertext - Current balance ciphertext
   * @param {number} currentBalance - Current balance (decrypted)
   * @param {Object} [options] - Options
   * @param {boolean} [options.useOffchainVerify=false] - Use offchain verification
   * @param {boolean} [options.waitForFinalization=true] - Wait for transfer finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async transfer(
    senderWallet,
    recipientAddress,
    tokenAddress,
    amount,
    options = {},
  ) {
    const { useOffchainVerify = false, waitForFinalization = true } = options;

    try {
      // Validate inputs
      if (!senderWallet) {
        throw new Error("Sender wallet is required");
      }
      if (!recipientAddress || !ethers.isAddress(recipientAddress)) {
        throw new Error(`Invalid recipient address: ${recipientAddress}`);
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!amount || amount <= 0) {
        throw new Error("Transfer amount must be greater than 0");
      }

      const senderAddress = await senderWallet.getAddress();

      // Auto-derive sender keys
      const derivedSenderKeys = await this.deriveKeys(senderWallet);
      if (!derivedSenderKeys?.privateKey) {
        throw new Error("Failed to derive sender keys");
      }

      // Auto-derive recipient public key
      const recipientAccountInfo = await this.getAccountInfo(recipientAddress);
      if (!recipientAccountInfo.exists) {
        throw new Error(
          `Recipient account does not exist. Address: ${recipientAddress}`,
        );
      }
      let derivedRecipientPublicKey = recipientAccountInfo.pubkey;
      if (!derivedRecipientPublicKey) {
        throw new Error("Recipient public key is required");
      }
      // Convert hex bytes to base64 if needed
      if (
        typeof derivedRecipientPublicKey === "string" &&
        derivedRecipientPublicKey.startsWith("0x")
      ) {
        derivedRecipientPublicKey = Buffer.from(
          derivedRecipientPublicKey.slice(2),
          "hex",
        ).toString("base64");
      }

      // Auto-fetch current balance
      const balanceInfo = await this.getBalance(
        senderAddress,
        derivedSenderKeys.privateKey,
        tokenAddress,
      );
      if (!balanceInfo) {
        throw new Error("Failed to fetch sender balance");
      }
      const derivedCurrentBalanceCiphertext = balanceInfo.ciphertext;
      const derivedCurrentBalance = balanceInfo.amount;

      if (!derivedCurrentBalanceCiphertext) {
        throw new Error(
          "Current balance ciphertext is required. Did you call getBalance()?",
        );
      }
      if (
        derivedCurrentBalance === undefined ||
        derivedCurrentBalance < amount
      ) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${derivedCurrentBalance}`,
        );
      }

      // Generate proof
      const proofInput = {
        current_balance_ciphertext: derivedCurrentBalanceCiphertext,
        current_balance:
          typeof derivedCurrentBalance === "bigint"
            ? derivedCurrentBalance.toString()
            : derivedCurrentBalance,
        transfer_amount:
          typeof amount === "bigint" ? amount.toString() : amount,
        source_keypair: derivedSenderKeys.privateKey,
        destination_pubkey: derivedRecipientPublicKey,
      };

      const wasm = await this._getWasm();
      const proofResult = wasm.generate_transfer_proof(
        JSON.stringify(proofInput),
      );
      const proof = JSON.parse(proofResult);

      if (!proof.success) {
        throw new Error(
          `Proof generation failed: ${proof.error || "Unknown error. Check your balance and amount."}`,
        );
      }

      // Get fee and execute transfer
      const fee = await this.contract.feeAmount();
      const tx = await this.contract
        .connect(senderWallet)
        .transferConfidential(
          recipientAddress,
          tokenAddress,
          ethers.getBytes(encodeTransferProof(proof.data)),
          useOffchainVerify,
          { value: fee },
        );

      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Transfer transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(senderAddress, "transfer");
      }

      return receipt;
    } catch (error) {
      const message = error?.message ?? String(error);
      if (
        message.includes("Insufficient balance") ||
        message.includes("Proof generation failed")
      ) {
        throw error;
      }
      throw new Error(`Failed to transfer: ${message}`);
    }
  }

  /**
   * Apply pending balance to available balance
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to apply pending for
   * @param {Object} [options] - Options
   * @param {boolean} [options.waitForFinalization=true] - Wait for operation finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async applyPending(wallet, options = {}) {
    const { waitForFinalization = true } = options;

    try {
      if (!wallet) {
        throw new Error("Wallet is required");
      }

      const address = await wallet.getAddress();

      const tx = await this.contract.connect(wallet).applyPending();
      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        throw new Error("Apply pending transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(address, "apply pending");
      }

      return receipt;
    } catch (error) {
      throw new Error(`Failed to apply pending: ${error.message}`);
    }
  }

  /**
   * Withdraw confidential tokens to public ERC20
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to withdraw from
   * @param {string} tokenAddress - Token address to withdraw
   * @param {number} amount - Amount to withdraw
   * @param {Object} keys - Encryption keys
   * @param {string} currentBalanceCiphertext - Current balance ciphertext
   * @param {number} currentBalance - Current balance (decrypted)
   * @param {Object} [options] - Options
   * @param {boolean} [options.useOffchainVerify=false] - Use offchain verification
   * @param {boolean} [options.waitForFinalization=true] - Wait for withdrawal finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async withdraw(wallet, tokenAddress, amount, options = {}) {
    const { useOffchainVerify = false, waitForFinalization = true } = options;

    try {
      // Validate inputs
      if (!wallet) {
        throw new Error("Wallet is required");
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!amount || amount <= 0) {
        throw new Error("Withdrawal amount must be greater than 0");
      }

      // Auto-derive keys
      const derivedKeys = await this.deriveKeys(wallet);
      if (!derivedKeys?.privateKey) {
        throw new Error("Failed to derive keys");
      }

      const balanceInfo = await this.getBalance(
        wallet.address,
        derivedKeys.privateKey,
        tokenAddress,
        {
          type: "available",
        },
      );
      if (!balanceInfo) {
        throw new Error("Failed to fetch sender balance");
      }
      const currentBalanceCiphertext = balanceInfo.ciphertext;
      const currentBalance = balanceInfo.amount;

      if (!currentBalanceCiphertext) {
        throw new Error(
          "Current balance ciphertext is required. Did you call getBalance()?",
        );
      }
      if (currentBalance === undefined || currentBalance < amount) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${currentBalance}`,
        );
      }

      const address = await wallet.getAddress();
      console.log(typeof amount === "bigint" ? amount.toString() : amount);

      // Generate withdrawal proof
      const withdrawInput = {
        current_balance_ciphertext: currentBalanceCiphertext,
        current_balance:
          typeof currentBalance === "bigint"
            ? Number(currentBalance)
            : currentBalance,
        withdraw_amount: typeof amount === "bigint" ? Number(amount) : amount,
        keypair: derivedKeys.privateKey,
      };

      console.log("Starting generate_withdraw_proof");
      console.log("withdrawInput:", JSON.stringify(withdrawInput, null, 2));

      const wasm = await this._getWasm();
      const proofResult = wasm.generate_withdraw_proof(
        JSON.stringify(withdrawInput),
      );
      const proof = JSON.parse(proofResult);

      if (!proof.success) {
        throw new Error(
          `Withdrawal proof generation failed: ${proof.error || "Unknown error. Check your balance and amount."}`,
        );
      }

      // Execute withdrawal
      const tx = await this.contract
        .connect(wallet)
        .withdraw(
          tokenAddress,
          BigInt(amount),
          ethers.getBytes(encodeWithdrawProof(proof.data)),
          useOffchainVerify,
        );

      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Withdrawal transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(address, "withdraw");
      }

      return receipt;
    } catch (error) {
      const message = error?.message ?? String(error);
      if (
        message.includes("Insufficient balance") ||
        message.includes("proof generation failed")
      ) {
        throw error;
      }
      throw new Error(`Failed to withdraw: ${message}`);
    }
  }

  /**
   * Wait for pending action to complete (internal method)
   *
   * @param {string} address - Account address
   * @param {string} actionLabel - Label for error messages
   * @private
   */
  async _waitForGlobalState(address, actionLabel) {
    // Initial cooldown to allow the relayer/indexer to pick up the transaction
    await sleep(10000);

    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      try {
        const info = await this.contract.getAccountCore(address);
        if (!info.hasPendingAction) {
          return; // Success
        }
      } catch (error) {
        // If we can't get account info, wait and retry
        console.warn(
          `Warning: Failed to check account state (attempt ${attempts + 1}): ${error.message}`,
        );
      }

      await sleep(3000);
      attempts++;
    }

    throw new Error(
      `Timeout waiting for ${actionLabel} to complete. The transaction may still be processing. Please check your account later.`,
    );
  }

  /**
   * Wait for pending balance to appear
   *
   * @param {string} address - Account address
   * @param {string} privateKey - Private key for decryption
   * @param {string} tokenAddress - Token address
   * @param {Object} [options] - Options
   * @param {number} [options.maxAttempts=60] - Maximum polling attempts
   * @param {number} [options.intervalMs=3000] - Polling interval in milliseconds
   * @returns {Promise<{amount: number, ciphertext: string}>}
   */
  async waitForPendingBalance(address, privateKey, tokenAddress, options = {}) {
    const { maxAttempts = 60, intervalMs = 3000 } = options;

    try {
      for (let i = 0; i < maxAttempts; i++) {
        const pending = await this.getBalance(
          address,
          privateKey,
          tokenAddress,
          {
            type: "pending",
          },
        );

        if (pending.amount > 0) {
          return pending;
        }

        await sleep(intervalMs);
      }

      throw new Error(
        `Timeout waiting for pending balance after ${maxAttempts} attempts. The transfer may still be processing.`,
      );
    } catch (error) {
      if (error.message.includes("Timeout waiting for pending balance")) {
        throw error;
      }
      throw new Error(`Failed to wait for pending balance: ${error.message}`);
    }
  }

  /**
   * Get the current fee amount for confidential transfers
   *
   * @returns {Promise<bigint>} Fee amount in wei
   */
  async getFeeAmount() {
    try {
      return await this.contract.feeAmount();
    } catch (error) {
      throw new Error(`Failed to get fee amount: ${error.message}`);
    }
  }

  /**
   * Get ERC20 token balance
   *
   * @param {string} address - Account address
   * @param {string} tokenAddress - Token address
   * @returns {Promise<bigint>} Token balance
   */
  async getTokenBalance(address, tokenAddress) {
    try {
      if (!address || !ethers.isAddress(address)) {
        throw new Error(`Invalid address: ${address}`);
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      const tokenContract = this._getTokenContract(tokenAddress);
      return await tokenContract.balanceOf(address);
    } catch (error) {
      throw new Error(`Failed to get token balance: ${error.message}`);
    }
  }
}
