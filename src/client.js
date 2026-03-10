import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  ERC20_ABI,
  getStableTrustContractAddress,
} from "./constants.js";
import { deriveKeys, decryptCiphertext, combineCiphertext } from "./crypto.js";
import {
  encodeTransferProof,
  encodeWithdrawProof,
  sleep,
  uploadBytesToIpfs,
} from "./utils.js";
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
   * @param {string} rpcUrl - RPC endpoint URL
   * @param {string|number} contractAddressOrChainId - Contract address or chain ID
   * @param {number} [chainId] - Chain ID when contract address is provided
   */
  constructor(rpcUrl, contractAddressOrChainId, chainId) {
    // Validate required config
    if (!rpcUrl) {
      throw new Error("rpcUrl is required");
    }

    let resolvedChainId;
    let resolvedContractAddress;

    if (typeof contractAddressOrChainId === "number" && chainId === undefined) {
      resolvedChainId = contractAddressOrChainId;
      resolvedContractAddress = getStableTrustContractAddress(resolvedChainId);
    } else {
      resolvedChainId = chainId;
      resolvedContractAddress =
        contractAddressOrChainId ||
        getStableTrustContractAddress(resolvedChainId);
    }

    if (!resolvedChainId) {
      throw new Error("chainId is required");
    }
    if (!resolvedContractAddress) {
      const supportedChainIds = [2201, 1244, 84532, 11155111, 421614, 42431]
        .map(String)
        .join(", ");
      throw new Error(
        `contractAddress is required for chainId ${resolvedChainId}. No default StableTrust contract is configured for this chain. Supported chainIds: ${supportedChainIds}`,
      );
    }
    if (!ethers.isAddress(resolvedContractAddress)) {
      throw new Error(`Invalid contractAddress: ${resolvedContractAddress}`);
    }

    // Build config
    this.config = {
      rpcUrl,
      contractAddress: ethers.getAddress(resolvedContractAddress),
      chainId: Number(resolvedChainId),
    };

    // WASM will be auto-initialized on first use
    this._wasmModule = null;

    // Cache for derived keys — deterministic per wallet+chain+contract, safe to reuse
    this._keyCache = new Map();

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
  async _deriveKeys(wallet) {
    try {
      if (!wallet) {
        throw new Error("Wallet is required");
      }
      const address = await wallet.getAddress();
      if (this._keyCache.has(address)) {
        return this._keyCache.get(address);
      }
      const wasm = await this._getWasm();
      const keys = await deriveKeys(
        wallet,
        {
          chainId: this.config.chainId,
          contractAddress: this.config.contractAddress,
        },
        wasm.generate_deterministic_keypair,
      );
      this._keyCache.set(address, keys);
      return keys;
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
   * @param {number} [options.maxAttempts=225] - Max attempts to wait for finalization
   * @returns {Promise<{publicKey: string, privateKey: string}>} The derived keys
   */
  async ensureAccount(wallet, options = {}) {
    const { waitForFinalization = true, maxAttempts = 225 } = options;

    try {
      const address = await wallet.getAddress();
      const keys = await this._deriveKeys(wallet);
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
          await sleep(400);
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
   * Get total decrypted balance (available + pending) for an address
   *
   * @param {string} address - Account address
   * @param {string} privateKey - Private key for decryption
   * @param {string} tokenAddress - Token address
   * @returns {Promise<{amount: number, available: {amount: number, ciphertext: string|null}, pending: {amount: number, ciphertext: string|null}}>}
   */
  async getConfidentialBalance(address, privateKey, tokenAddress) {
    try {
      const [available, pending] = await Promise.all([
        this._getAvailableBalance(address, privateKey, tokenAddress),
        this._getPendingBalance(address, privateKey, tokenAddress),
      ]);

      return {
        amount: available.amount + pending.amount,
        available,
        pending,
      };
    } catch (error) {
      throw new Error(`Failed to get confidential balance: ${error.message}`);
    }
  }

  /**
   * Get decrypted available balance for an address
   * @private
   */
  async _getAvailableBalance(address, privateKey, tokenAddress) {
    return await this._getBalanceByType(
      address,
      privateKey,
      tokenAddress,
      "available",
    );
  }

  /**
   * Get decrypted pending balance for an address
   * @private
   */
  async _getPendingBalance(address, privateKey, tokenAddress) {
    return await this._getBalanceByType(
      address,
      privateKey,
      tokenAddress,
      "pending",
    );
  }

  /**
   * Shared balance retrieval by type
   * @private
   */
  async _getBalanceByType(address, privateKey, tokenAddress, type) {
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
      if (type === "pending") {
        [c1, c2] = await this.contract.getPending(address, tokenAddress);
      } else {
        [c1, c2] = await this.contract.getAvailable(address, tokenAddress);
      }

      if ((!c1 || c1 === "0x") && (!c2 || c2 === "0x")) {
        return { amount: 0n, ciphertext: null };
      }

      const wasm = await this._getWasm();
      const ciphertext = combineCiphertext(c1, c2);
      const contractAmount = decryptCiphertext(
        ciphertext,
        privateKey,
        wasm.decrypt_ciphertext,
      );
      const tokenAmount = ethers.formatUnits(contractAmount, 2);
      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenUnits = await tokenContract.decimals();

      return {
        amount: ethers.parseUnits(tokenAmount, Number(tokenUnits)),
        ciphertext,
      };
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Apply pending balance if needed (internal helper)
   * @private
   */
  async _applyPendingIfNeeded(wallet, privateKey, tokenAddress, actionLabel) {
    const address = await wallet.getAddress();
    const pendingBalance = await this._getPendingBalance(
      address,
      privateKey,
      tokenAddress,
    );

    if (pendingBalance.amount > 0) {
      try {
        await this._applyPending(wallet, { waitForFinalization: true });
      } catch (error) {
        console.warn(
          `Warning: Failed to apply pending balance before ${actionLabel}: ${error.message}. You may have pending balance that is not yet applied.`,
        );
      }
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
  async confidentialDeposit(wallet, tokenAddress, amount, options = {}) {
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
      const derivedKeys = await this._deriveKeys(wallet);
      await this._applyPendingIfNeeded(
        wallet,
        derivedKeys.privateKey,
        tokenAddress,
        "deposit",
      );

      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const depositAmount =
        (BigInt(amount) * 100n) / 10n ** BigInt(tokenDecimals);

      // Check token balance and allowance in parallel
      const [tokenBalance, allowance] = await Promise.all([
        tokenContract.balanceOf(address),
        tokenContract.allowance(address, this.config.contractAddress),
      ]);
      if (tokenBalance < depositAmount) {
        throw new Error(
          `Insufficient token balance. Required: ${amount}, Available: ${tokenBalance}`,
        );
      }

      if (allowance < amount) {
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
   * @param {Object} [options] - Options
   * @param {boolean} [options.useOffchainVerify=false] - Use offchain verification
   * @param {boolean} [options.waitForFinalization=true] - Wait for transfer finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async confidentialTransfer(
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
      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const transferAmount =
        (BigInt(amount) * 100n) / 10n ** BigInt(tokenDecimals);

      const senderAddress = await senderWallet.getAddress();

      // Derive sender keys and fetch recipient account info in parallel
      const [derivedSenderKeys, recipientAccountInfo] = await Promise.all([
        this._deriveKeys(senderWallet),
        this.getAccountInfo(recipientAddress),
      ]);
      if (!derivedSenderKeys?.privateKey) {
        throw new Error("Failed to derive sender keys");
      }

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

      await this._applyPendingIfNeeded(
        senderWallet,
        derivedSenderKeys.privateKey,
        tokenAddress,
        "transfer",
      );

      const [balanceSummary, fee] = await Promise.all([
        this.getConfidentialBalance(
          senderAddress,
          derivedSenderKeys.privateKey,
          tokenAddress,
        ),
        this.getFeeAmount(),
      ]);
      const derivedCurrentBalanceCiphertext =
        balanceSummary.available.ciphertext;
      const derivedCurrentBalance = balanceSummary.available.amount;

      if (!derivedCurrentBalanceCiphertext) {
        throw new Error(
          "Current balance ciphertext is required. Did you call getConfidentialBalance()?",
        );
      }
      if (balanceSummary.amount < BigInt(amount)) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Total: ${balanceSummary.amount}`,
        );
      }
      if (
        derivedCurrentBalance === undefined ||
        derivedCurrentBalance < BigInt(amount)
      ) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${derivedCurrentBalance}`,
        );
      }

      const currentBalanceContractScale =
        (BigInt(derivedCurrentBalance) * 100n) / 10n ** BigInt(tokenDecimals);

      // Generate proof
      const proofInput = {
        current_balance_ciphertext: derivedCurrentBalanceCiphertext,
        current_balance: Number(currentBalanceContractScale),
        transfer_amount: Number(transferAmount),
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
      const encodedProof = ethers.getBytes(encodeTransferProof(proof.data));
      let transferZkpArg;
      let txOverrides;

      if (this.config.chainId === 42431) {
        // Tempo: upload proof to IPFS and pass an ipfs:// pointer; no native fee
        try {
          const cid = await uploadBytesToIpfs(
            encodedProof,
            "transfer-proof.bin",
          );
          transferZkpArg = ethers.toUtf8Bytes(`ipfs://${cid}`);
        } catch (ipfsError) {
          throw new Error(
            `Failed to upload proof to IPFS: ${ipfsError.message}`,
          );
        }
        txOverrides = { value: 0n };
      } else {
        // Standard chains: pass encoded proof bytes with native fee
        transferZkpArg = encodedProof;
        txOverrides = { value: await this.contract.feeAmount() };
      }

      const tx = await this.contract
        .connect(senderWallet)
        .transferConfidential(
          recipientAddress,
          tokenAddress,
          transferZkpArg,
          useOffchainVerify,
          txOverrides,
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
   * Withdraw confidential tokens to public ERC20
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to withdraw from
   * @param {string} tokenAddress - Token address to withdraw
   * @param {number} amount - Amount to withdraw
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

      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const withdrawAmount =
        (BigInt(amount) * 100n) / 10n ** BigInt(tokenDecimals);

      // Auto-derive keys
      const derivedKeys = await this._deriveKeys(wallet);
      if (!derivedKeys?.privateKey) {
        throw new Error("Failed to derive keys");
      }

      const address = await wallet.getAddress();
      await this._applyPendingIfNeeded(
        wallet,
        derivedKeys.privateKey,
        tokenAddress,
        "withdraw",
      );

      const balanceSummary = await this.getConfidentialBalance(
        address,
        derivedKeys.privateKey,
        tokenAddress,
      );
      const currentBalanceCiphertext = balanceSummary.available.ciphertext;
      const currentBalance = balanceSummary.available.amount;

      if (!currentBalanceCiphertext) {
        throw new Error(
          "Current balance ciphertext is required. Did you call getConfidentialBalance()?",
        );
      }
      if (balanceSummary.amount < BigInt(amount)) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Total: ${balanceSummary.amount}`,
        );
      }
      if (currentBalance === undefined || currentBalance < BigInt(amount)) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${currentBalance}`,
        );
      }

      const currentBalanceContractScale =
        (BigInt(currentBalance) * 100n) / 10n ** BigInt(tokenDecimals);

      // Generate withdrawal proof
      const withdrawInput = {
        current_balance_ciphertext: currentBalanceCiphertext,
        current_balance: Number(currentBalanceContractScale),
        withdraw_amount: Number(withdrawAmount),
        keypair: derivedKeys.privateKey,
      };

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
      const encodedProof = ethers.getBytes(encodeWithdrawProof(proof.data));
      let withdrawZkpArg;

      if (this.config.chainId === 42431) {
        // Tempo: upload proof to IPFS and pass an ipfs:// pointer
        try {
          const cid = await uploadBytesToIpfs(
            encodedProof,
            "withdraw-proof.bin",
          );
          withdrawZkpArg = ethers.toUtf8Bytes(`ipfs://${cid}`);
        } catch (ipfsError) {
          throw new Error(
            `Failed to upload proof to IPFS: ${ipfsError.message}`,
          );
        }
      } else {
        withdrawZkpArg = encodedProof;
      }

      const tx = await this.contract
        .connect(wallet)
        .withdraw(
          tokenAddress,
          BigInt(withdrawAmount),
          withdrawZkpArg,
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
   * Apply pending balance to available balance
   *
   * @param {ethers.Wallet|ethers.Signer} wallet - The wallet to apply pending for
   * @param {Object} [options] - Options
   * @param {boolean} [options.waitForFinalization=true] - Wait for operation finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async _applyPending(wallet, options = {}) {
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
   * Wait for pending action to complete (internal method)
   *
   * @param {string} address - Account address
   * @param {string} actionLabel - Label for error messages
   * @private
   */
  async _waitForGlobalState(address, actionLabel) {
    let attempts = 0;
    const maxAttempts = 450; // 450 * 200ms = 90 seconds max wait
    await sleep(2000);

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

      await sleep(200);
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
   * @param {number} [options.maxAttempts=225] - Maximum polling attempts
   * @param {number} [options.intervalMs=400] - Polling interval in milliseconds
   * @returns {Promise<{amount: number, ciphertext: string}>}
   */
  async _waitForPendingBalance(
    address,
    privateKey,
    tokenAddress,
    options = {},
  ) {
    const { maxAttempts = 225, intervalMs = 400 } = options;
    await sleep(1000);

    try {
      for (let i = 0; i < maxAttempts; i++) {
        const pending = await this._getPendingBalance(
          address,
          privateKey,
          tokenAddress,
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
  async getPublicBalance(address, tokenAddress) {
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
