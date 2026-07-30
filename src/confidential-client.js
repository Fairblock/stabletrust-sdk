import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  ERC20_ABI,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
  getStabletrustContractAddress,
} from "./constants.js";
import { deriveKeys, decryptCiphertext, combineCiphertext } from "./crypto.js";
import {
  encodeTransferProof,
  encodeWithdrawProof,
  sleep,
  toContractScale,
  uploadBytesToIpfs,
} from "./utils.js";
import { initializeWasm } from "./wasm-loader.js";
import { encryptRandomness } from "./ibe.js";
import { createRequest, CHAIN_KEY_BY_ID } from "./backend.js";

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
   * @param {Object} [options]
   * @param {string} [options.ipfsUploadUrl] - StableTrust IPFS upload endpoint for off-chain proof uploads
   * @param {string} [options.ipfsApiKey] - Optional bearer token for the StableTrust IPFS upload endpoint
   * @param {string} [options.apiBaseUrl] - StableTrust backend API base URL for request persistence
   */
  constructor(rpcUrl, contractAddressOrChainId, chainId, options = {}) {
    // Validate required config
    if (!rpcUrl) {
      throw new Error("rpcUrl is required");
    }

    let resolvedChainId;
    let resolvedContractAddress;
    let ipfsOptions = options || {};

    if (
      typeof contractAddressOrChainId === "number" &&
      (chainId === undefined || typeof chainId === "object")
    ) {
      resolvedChainId = contractAddressOrChainId;
      resolvedContractAddress = getStabletrustContractAddress(resolvedChainId);
      ipfsOptions = typeof chainId === "object" && chainId !== null ? chainId : ipfsOptions;
    } else {
      resolvedChainId = chainId;
      resolvedContractAddress =
        contractAddressOrChainId ||
        getStabletrustContractAddress(resolvedChainId);
    }

    if (!resolvedChainId) {
      throw new Error("chainId is required");
    }
    if (!resolvedContractAddress) {
      const supportedChainIds = [2201, 5042002, 84532, 11155111, 421614, 42431]
        .map(String)
        .join(", ");
      throw new Error(
        `contractAddress is required for chainId ${resolvedChainId}. No default Stabletrust contract is configured for this chain. Supported chainIds: ${supportedChainIds}`,
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
      ipfsUploadUrl: ipfsOptions.ipfsUploadUrl || null,
      ipfsApiKey: ipfsOptions.ipfsApiKey || null,
      apiBaseUrl: ipfsOptions.apiBaseUrl || null,
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
      this._assertLatestContractAbi();
    } catch (error) {
      throw new Error(
        `Failed to initialize contracts: ${error.message}. Check your RPC URL and contract addresses.`,
      );
    }
  }

  /**
   * Fire-and-forget request row creation
   * @private
   */
  _postRequest(data) {
    const apiBaseUrl = this.config.apiBaseUrl || undefined;
    const payload = {
      chainKey: CHAIN_KEY_BY_ID[this.config.chainId] || String(this.config.chainId),
      chainId: this.config.chainId,
      applicationName: "SDK",
      ...data,
    };
    createRequest(payload, apiBaseUrl).catch((err) => {
      const status = err?.response?.status;
      const body = err?.response?.data;
      console.warn("[StableTrust] Failed to post request:", err.message);
      if (status) console.warn("[StableTrust] Status:", status);
      if (body) console.warn("[StableTrust] Response:", JSON.stringify(body, null, 2));
    });
  }

  /**
   * Extract request/tx ID from receipt logs
   * @private
   */
  _getRequestIdFromReceipt(receipt, eventNames) {
    try {
      const iface = this.contract.interface;
      const contractAddr = this.config.contractAddress.toLowerCase();

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === contractAddr) {
          const txId = this._parseLogItem(iface, log, eventNames);
          if (txId) return txId;
        }
      }

      for (const log of receipt.logs) {
        const txId = this._parseLogItem(iface, log, eventNames);
        if (txId) return txId;
      }

      for (const name of eventNames) {
        try {
          const topicHash = iface.getEvent(name).topicHash;
          for (const log of receipt.logs) {
            if (log.topics[0] === topicHash && log.topics.length >= 3) {
              const txId = BigInt(log.topics[2]).toString();
              if (txId !== "0") return txId;
            }
          }
        } catch {
          // Event not in ABI
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse a single log item to extract txId
   * @private
   */
  _parseLogItem(iface, log, eventNames) {
    try {
      const parsed = iface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });

      if (!parsed || !eventNames.includes(parsed.name)) return null;

      if (parsed.args.txId !== undefined && parsed.args.txId !== null) {
        return parsed.args.txId.toString();
      }
      if (parsed.args.requestId !== undefined && parsed.args.requestId !== null) {
        return parsed.args.requestId.toString();
      }

      let txId;
      if (
        parsed.name === "TransferRequested" ||
        parsed.name === "TransferProcessed"
      ) {
        txId = parsed.args[2];
      } else {
        txId = parsed.args[1];
      }

      return txId !== undefined && txId !== null ? txId.toString() : null;
    } catch {
      return null;
    }
  }

  /**
   * Get requestId from account core state (txId)
   * @private
   */
  async _getRequestIdFromAccountCore(address) {
    try {
      const account = await this.contract.getAccountCore(address);
      const txId = account.txId?.toString?.() ?? String(account.txId);
      return txId && txId !== "0" ? txId : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve a request ID from receipt logs, then account state, then tx hash
   * @private
   */
  async _resolveRequestId(receipt, address, eventNames) {
    let requestId = this._getRequestIdFromReceipt(receipt, eventNames);
    if (!requestId) {
      requestId = await this._getRequestIdFromAccountCore(address);
    }
    if (!requestId || requestId === "0") {
      requestId = receipt.hash;
    }
    return requestId;
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
   * Fail fast when a stale SDK ABI is installed against the latest contract.
   * This catches the common dependency-lock problem where the contract has
   * `bytes,bool` proof methods but node_modules still contains the older ABI.
   * @private
   */
  _assertLatestContractAbi() {
    const requiredSignatures = [
      TRANSFER_CONFIDENTIAL_SIGNATURE,
      WITHDRAW_CONFIDENTIAL_SIGNATURE,
      FEE_TOKEN_SIGNATURE,
      NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
      ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
      ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
    ];

    const missingSignatures = requiredSignatures.filter(
      (signature) => !this.contract.interface.getFunction(signature),
    );
    if (missingSignatures.length > 0) {
      throw new Error(
        `Installed @fairblock/stabletrust ABI is stale or incomplete. Missing ${missingSignatures.join(", ")}. Reinstall/update the SDK.`,
      );
    }
  }

  /**
   * Resolve whether non-anonymous proof bytes should be submitted inline or via
   * StableTrust IPFS. `offchainZKP` is the latest contract flag;
   * `useOffchainVerify` is kept as a deprecated SDK alias for older callers.
   * Tempo keeps the old SDK behaviour of using IPFS by default.
   * @private
   */
  _resolveOffchainZKP(options = {}) {
    if (options.offchainZKP !== undefined) return Boolean(options.offchainZKP);
    if (options.useOffchainVerify !== undefined) return Boolean(options.useOffchainVerify);
    return this.config.chainId === 42431;
  }

  /**
   * Prepare payment for a non-anonymous confidential transfer. Both inline and
   * IPFS proof paths use the same live `nonAnonymousTransferFee`. Native fees
   * are attached as msg.value; ERC-20 fees are approved for the diamond and
   * collected by the contract with transferFrom.
   * @private
   */
  async _prepareNonAnonymousTransferFee(senderWallet) {
    const [feeTokenRaw, feeAmountRaw] = await Promise.all([
      this.contract.feeToken(),
      this.contract.nonAnonymousTransferFee(),
    ]);

    const feeToken = ethers.getAddress(feeTokenRaw);
    const feeAmount = BigInt(feeAmountRaw);

    if (feeAmount === 0n) {
      return { value: 0n };
    }

    if (feeToken === ethers.ZeroAddress) {
      return { value: feeAmount };
    }

    const senderAddress = await senderWallet.getAddress();
    const feeTokenContract = this._getTokenContract(feeToken);
    const [balance, allowance] = await Promise.all([
      feeTokenContract.balanceOf(senderAddress),
      feeTokenContract.allowance(senderAddress, this.config.contractAddress),
    ]);

    if (balance < feeAmount) {
      throw new Error(
        `Insufficient fee token balance. Required: ${feeAmount}, available: ${balance}, fee token: ${feeToken}`,
      );
    }

    if (allowance < feeAmount) {
      const approveTx = await feeTokenContract
        .connect(senderWallet)
        .approve(this.config.contractAddress, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (!approveReceipt || approveReceipt.status === 0) {
        throw new Error("Fee token approval failed");
      }
    }

    return { value: 0n };
  }

  /**
   * For the latest contract, public transfer/withdraw always pass
   * `(bytes proof, bool offchainZKP)`. When `offchainZKP=true`, the bytes arg is
   * the bare CID encoded as UTF-8 bytes. When false, it is the full ABI proof.
   * @private
   */
  async _resolveContractProofArg(encodedProof, proofName, offchainZKP) {
    if (!offchainZKP) {
      return encodedProof;
    }

    try {
      const cid = await uploadBytesToIpfs(encodedProof, proofName, {
        uploadUrl: this.config.ipfsUploadUrl,
        apiKey: this.config.ipfsApiKey,
      });
      const bareCid = String(cid || "").trim().replace(/^ipfs:\/\//i, "");
      if (!bareCid) {
        throw new Error("IPFS upload returned no CID");
      }
      return ethers.toUtf8Bytes(bareCid);
    } catch (ipfsError) {
      throw new Error(`Failed to upload proof to IPFS: ${ipfsError.message}`);
    }
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
   * Amounts are in raw token units (bigint). Note that this differs from the anonymous client, which returns
   * contract scale (amount * 100 / 10^decimals).
   *
   * @param {string} address - Account address
   * @param {string} privateKey - Private key for decryption
   * @param {string} tokenAddress - Token address
   * @returns {Promise<{amount: bigint, available: {amount: bigint, ciphertext: string|null}, pending: {amount: bigint, ciphertext: string|null}}>}
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

    if (pendingBalance.amount > 0n) {
      try {
        await this._applyPending(wallet, {
          waitForFinalization: true,
          tokenAddress,
          pendingAmount: pendingBalance.amount,
        });
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
      const depositAmount = toContractScale(amount, tokenDecimals);

      // Check token balance and allowance in parallel
      const [tokenBalance, allowance] = await Promise.all([
        tokenContract.balanceOf(address),
        tokenContract.allowance(address, this.config.contractAddress),
      ]);
      if (tokenBalance < BigInt(amount)) {
        throw new Error(
          `Insufficient token balance. Required: ${amount}, Available: ${tokenBalance}`,
        );
      }

      const depositOverrides = {};
      if (allowance < BigInt(amount)) {
        const approveTx = await tokenContract
          .connect(wallet)
          .approve(this.config.contractAddress, ethers.MaxUint256);

        const approveReceipt = await approveTx.wait();
        if (!approveReceipt || approveReceipt.status === 0) {
          throw new Error("Token approval failed");
        }
        // Pin the deposit nonce to (approve nonce + 1). The approve was just
        // broadcast from this same EOA; letting ethers resolve the deposit nonce
        // via getTransactionCount can still return the pre-approve count on a fast
        // node and assign the deposit the SAME nonce as the approve, which the node
        // rejects as "nonce too low" (NONCE_EXPIRED).
        depositOverrides.nonce = approveTx.nonce + 1;
      }
      // Perform deposit
      const depositTx = await this.contract
        .connect(wallet)
        .deposit(tokenAddress, depositAmount, depositOverrides);

      const receipt = await depositTx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Deposit transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(address, "deposit");
      }

      const tokenSymbol = await tokenContract.symbol();
      const requestId = await this._resolveRequestId(receipt, address, [
        "DepositRequested",
        "DepositProcessed",
      ]);

      this._postRequest({
        requestId,
        userAddress: address.toLowerCase(),
        operationKind: 1,
        type: "deposit",
        transactionHash: receipt.hash,
        status: "pending",
        details: {
          token: tokenSymbol,
          tokenAddress,
          amount: depositAmount.toString(),
          amountInWei: true,
        },
      });

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
   * @param {bigint|string|number} amount - Amount to transfer (in token units)
   * @param {Object} [options] - Options
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
    const { waitForFinalization = true } = options;
    const offchainZKP = this._resolveOffchainZKP(options);

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
      if (!amount || BigInt(amount) <= 0n) {
        throw new Error("Transfer amount must be greater than 0");
      }
      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const transferAmount = toContractScale(amount, tokenDecimals);

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
      let derivedRecipientPublicKey = recipientAccountInfo.elgamalPubkey;
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

      const balanceSummary = await this.getConfidentialBalance(
        senderAddress,
        derivedSenderKeys.privateKey,
        tokenAddress,
      );
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
          `Proof generation failed: ${
            proof.error || "Unknown error. Check your balance and amount."
          }`,
        );
      }
      const encodedProof = ethers.getBytes(encodeTransferProof(proof.data));
      const transferZkpArg = await this._resolveContractProofArg(
        encodedProof,
        "transfer-proof.bin",
        offchainZKP,
      );
      const txOverrides = await this._prepareNonAnonymousTransferFee(senderWallet);

      const tx = await this.contract.connect(senderWallet).transferConfidential(
        recipientAddress,
        tokenAddress,
        transferZkpArg,
        offchainZKP,
        txOverrides,
      );

      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Transfer transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(senderAddress, "transfer");
      }

      // IBE-encrypt randomness then persist both records (fire-and-forget, after finalization)
      const txHash = receipt.hash;
      const requestId = await this._resolveRequestId(receipt, senderAddress, [
        "TransferRequested",
        "TransferProcessed",
      ]);
      const tokenSymbol = await tokenContract.symbol();

      Promise.all([
        encryptRandomness(senderAddress, proof.data.sender_randomness),
        encryptRandomness(recipientAddress, proof.data.receiver_randomness),
      ])
        .then(([senderEnc, receiverEnc]) => {
          const transferDetails = {
            sender: senderAddress.toLowerCase(),
            recipient: recipientAddress.toLowerCase(),
            token: tokenSymbol,
            tokenAddress,
          };

          const queuedFields =
            senderEnc.queuedEncrypted && receiverEnc.queuedEncrypted
              ? {
                  queuedEncryptedSenderRandomness: senderEnc.queuedEncrypted,
                  queuedEncryptedReceiverRandomness: receiverEnc.queuedEncrypted,
                }
              : {};

          this._postRequest({
            requestId,
            userAddress: senderAddress.toLowerCase(),
            operationKind: 2,
            type: "transfer",
            transactionHash: txHash,
            status: "pending",
            details: transferDetails,
            encryptedSenderRandomness: senderEnc.encrypted,
            encryptedReceiverRandomness: receiverEnc.encrypted,
            ...queuedFields,
          });

          this._postRequest({
            requestId: `received-${requestId}-${recipientAddress.toLowerCase()}`,
            userAddress: recipientAddress.toLowerCase(),
            operationKind: 2,
            type: "received",
            transactionHash: txHash,
            status: "pending",
            details: transferDetails,
            encryptedReceiverRandomness: receiverEnc.encrypted,
            ...(receiverEnc.queuedEncrypted
              ? {
                  queuedEncryptedReceiverRandomness:
                    receiverEnc.queuedEncrypted,
                }
              : {}),
          });
        })
        .catch(() => {});

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
   * @param {bigint|string|number} amount - Amount to withdraw (in token units)
   * @param {Object} [options] - Options
   * @param {boolean} [options.waitForFinalization=true] - Wait for withdrawal finalization
   * @returns {Promise<Object>} Transaction receipt
   */
  async withdraw(wallet, tokenAddress, amount, options = {}) {
    const { waitForFinalization = true } = options;
    const offchainZKP = this._resolveOffchainZKP(options);

    try {
      // Validate inputs
      if (!wallet) {
        throw new Error("Wallet is required");
      }
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!amount || BigInt(amount) <= 0n) {
        throw new Error("Withdrawal amount must be greater than 0");
      }

      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const withdrawAmount = toContractScale(amount, tokenDecimals);

      // Auto-derive keys
      const derivedKeys = await this._deriveKeys(wallet);
      if (!derivedKeys?.privateKey) {
        throw new Error("Failed to derive keys");
      }

      const address = await wallet.getAddress();
      // Fetch balance first — only apply pending if available is insufficient
      let balanceSummary = await this.getConfidentialBalance(
        address,
        derivedKeys.privateKey,
        tokenAddress,
      );

      if (balanceSummary.available.amount < BigInt(amount)) {
        await this._applyPendingIfNeeded(
          wallet,
          derivedKeys.privateKey,
          tokenAddress,
          "withdraw",
        );
        // Re-fetch after applying pending
        balanceSummary = await this.getConfidentialBalance(
          address,
          derivedKeys.privateKey,
          tokenAddress,
        );
      }

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

      // Fetch the contract's per-account txId. Withdraw proofs bind to the *next*
      // tx id (txId + 1), not the current one — the contract increments the counter
      // on every action, and the proof must commit to what it will be after submission.
      const accountInfo = await this.getAccountInfo(address);
      const txId = BigInt(accountInfo.txId ?? 0n);

      // Generate withdrawal proof
      const withdrawInput = {
        current_balance_ciphertext: currentBalanceCiphertext,
        current_balance: Number(currentBalanceContractScale),
        withdraw_amount: Number(withdrawAmount),
        keypair: derivedKeys.privateKey,
        nonce: Number(txId + 1n),
      };

      const wasm = await this._getWasm();
      const proofResult = wasm.generate_withdraw_proof(
        JSON.stringify(withdrawInput),
      );
      const proof = JSON.parse(proofResult);

      if (!proof.success) {
        throw new Error(
          `Withdrawal proof generation failed: ${
            proof.error || "Unknown error. Check your balance and amount."
          }`,
        );
      }

      // Execute withdrawal
      const encodedProof = ethers.getBytes(encodeWithdrawProof(proof.data));
      const withdrawZkpArg = await this._resolveContractProofArg(
        encodedProof,
        "withdraw-proof.bin",
        offchainZKP,
      );

      const tx = await this.contract.connect(wallet).withdraw(
        tokenAddress,
        BigInt(withdrawAmount),
        withdrawZkpArg,
        offchainZKP,
      );

      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) {
        throw new Error("Withdrawal transaction failed");
      }

      if (waitForFinalization) {
        await this._waitForGlobalState(address, "withdraw");
      }

      const requestId = await this._resolveRequestId(receipt, address, [
        "WithdrawRequested",
        "WithdrawProcessed",
      ]);
      const tokenSymbol = await tokenContract.symbol();

      this._postRequest({
        requestId,
        userAddress: address.toLowerCase(),
        operationKind: 4,
        type: "withdraw",
        transactionHash: receipt.hash,
        status: "pending",
        details: {
          token: tokenSymbol,
          tokenAddress,
          amount: withdrawAmount.toString(),
          amountInWei: true,
        },
      });

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
    const { waitForFinalization = true, tokenAddress, pendingAmount } = options;

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

      const requestId = await this._resolveRequestId(receipt, address, [
        "ApplyPendingRequested",
        "ApplyPendingProcessed",
      ]);

      const tokenContract = tokenAddress
        ? this._getTokenContract(tokenAddress)
        : null;
      const tokenSymbol = tokenContract
        ? await tokenContract.symbol()
        : "USD₮0";

      this._postRequest({
        requestId,
        userAddress: address.toLowerCase(),
        operationKind: 3,
        type: "secure claim",
        transactionHash: receipt.hash,
        status: "pending",
        details: {
          token: tokenSymbol,
          ...(tokenAddress ? { tokenAddress } : {}),
          ...(pendingAmount === undefined
            ? {}
            : {
                pendingAmount: pendingAmount.toString(),
                amountInWei: true,
              }),
        },
      });

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
        if (!info.pendingAction) {
          return; // Success
        }
      } catch (error) {
        // If we can't get account info, wait and retry
        console.warn(
          `Warning: Failed to check account state (attempt ${attempts + 1}): ${
            error.message
          }`,
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
   * Get the currently configured fee token. address(0) means native currency.
   *
   * @returns {Promise<string>} Checksummed token address
   */
  async getFeeToken() {
    try {
      return ethers.getAddress(await this.contract.feeToken());
    } catch (error) {
      throw new Error(`Failed to get fee token: ${error.message}`);
    }
  }

  /**
   * Get the fixed fee used by all non-anonymous confidential transfers,
   * regardless of whether the proof is inline or stored on IPFS.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getNonAnonymousTransferFee() {
    try {
      return await this.contract.nonAnonymousTransferFee();
    } catch (error) {
      throw new Error(`Failed to get non-anonymous transfer fee: ${error.message}`);
    }
  }

  /**
   * Get the fixed fee used by anonymous transfers whose proof is stored on IPFS.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousIpfsTransferFee() {
    try {
      return await this.contract.anonymousIpfsTransferFee();
    } catch (error) {
      throw new Error(`Failed to get anonymous IPFS transfer fee: ${error.message}`);
    }
  }

  /**
   * Get the fixed fee used by anonymous transfers whose proof is submitted inline.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousInlineTransferFee() {
    try {
      return await this.contract.anonymousInlineTransferFee();
    } catch (error) {
      throw new Error(`Failed to get anonymous inline transfer fee: ${error.message}`);
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
