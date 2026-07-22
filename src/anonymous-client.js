import { ethers } from "ethers";
import { initializeWasm } from "./wasm-loader.js";
import {
  encodeTransferProof,
  encodeWithdrawProof,
  validateAnonymousAccountId,
  uploadBytesToIpfs,
} from "./utils.js";
import { ERC20_ABI, getStabletrustContractAddress } from "./constants.js";

// EIP-712 domain for anonymous operations (LibAnonAuth domain name)
const ANON_DOMAIN_NAME = "ConfidentialMirrorAnonymous";
const ANON_DOMAIN_VERSION = "1";

// Default deadline offset: 1 hour
const DEFAULT_DEADLINE_OFFSET = 3600;

// Minimal ABI — only used for deposit/fee calldata encoding (reads go through Fairycloak views)
const DEPOSIT_INTERFACE = new ethers.Interface([
  "function depositAnonymous(string accountId, address token, uint256 plainAmount, uint256 authNonce, uint256 deadline, bytes authSig) external",
]);

const ADD_FEES_INTERFACE = new ethers.Interface([
  "function addFees(string accountId, address token, uint256 amount, uint256 authNonce, uint256 deadline, bytes signature) external payable",
]);

const WITHDRAW_FEES_INTERFACE = new ethers.Interface([
  "function withdrawFees(string accountId, address token, address destination, uint256 amount, uint256 authNonce, uint256 deadline, bytes signature) external",
]);

const WITHDRAW_ALL_FEES_INTERFACE = new ethers.Interface([
  "function withdrawAllFees(string accountId, address destination, uint256 authNonce, uint256 deadline, bytes signature) external",
]);

/**
 * Internal helper to parse values as BigInt, handling hex strings and null/undefined.
 * @private
 */
function _parseBigInt(v) {
  if (v == null || v === "") return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * AnonymousTransferClient — SDK class for anonymous confidential transfers via the Fairycloak relay.
 *
 * Anonymous transfers are routed through the Fairycloak HTTP relay server instead of being
 * submitted directly on-chain. The relay pays gas for all managed transactions; the user only
 * signs EIP-712 authorisation payloads (and a raw EVM transaction for deposits).
 *
 * ### Anonymous account ID rules
 * Every `accountId` / `senderAccountId` / `recipientId` accepted by this client must:
 *   - be a non-empty string
 *   - be at most 20 characters long
 *   - contain only alphanumeric characters (A-Z, a-z, 0-9)
 *   - be treated as case-sensitive (no normalization is applied)
 *
 * IDs that don't follow these rules are rejected with a descriptive error before any
 * network request is made.
 */
export class AnonymousTransferClient {
  /**
   * @param {Object} config
   * @param {string} config.fairycloakUrl - Fairycloak relay base URL, e.g. "http://127.0.0.1:8080"
   * @param {number|string} config.chainId - Chain ID (used to auto-resolve the contract address)
   * @param {string} config.rpcUrl - EVM JSON-RPC endpoint (used for on-chain reads and raw-tx signing)
   * @param {string} [config.diamondAddress] - Optional override for the diamond contract address
   * @param {string} [config.apiKey] - Optional Fairycloak API key
   * @param {string} [config.ipfsUploadUrl] - StableTrust IPFS upload endpoint used when `offchainZKP: true`
   * @param {string} [config.ipfsApiKey] - Optional bearer token for the StableTrust IPFS upload endpoint
   * @param {string} [config.ipfsGatewayUrl] - Optional read gateway base URL, e.g. "https://ipfs.example.com"
   */
  constructor({ fairycloakUrl, diamondAddress, chainId, rpcUrl, apiKey, ipfsUploadUrl, ipfsApiKey, ipfsGatewayUrl } = {}) {
    if (!fairycloakUrl) throw new Error("fairycloakUrl is required");
    if (!chainId) throw new Error("chainId is required");
    if (!rpcUrl) throw new Error("rpcUrl is required");

    const resolvedDiamondAddress =
      diamondAddress || getStabletrustContractAddress(chainId);
    if (!resolvedDiamondAddress || !ethers.isAddress(resolvedDiamondAddress)) {
      throw new Error(
        `No contract address found for chainId ${chainId}. Pass a diamondAddress explicitly or use a supported chainId.`,
      );
    }

    this.fairycloakUrl = fairycloakUrl.replace(/\/$/, "");
    this.diamondAddress = ethers.getAddress(resolvedDiamondAddress);
    this.chainId = Number(chainId);
    this.rpcUrl = rpcUrl;
    this.apiKey = apiKey || null;
    this.ipfsUploadUrl = ipfsUploadUrl || null;
    this.ipfsApiKey = ipfsApiKey || null;
    this.ipfsGatewayUrl = ipfsGatewayUrl ? ipfsGatewayUrl.replace(/\/$/, "") : null;

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this._wasmModule = null;
  }

  // ─────────────────────── private helpers ───────────────────────

  async _getWasm() {
    if (!this._wasmModule) {
      this._wasmModule = await initializeWasm();
    }
    return this._wasmModule;
  }

  _buildDomain() {
    return {
      name: ANON_DOMAIN_NAME,
      version: ANON_DOMAIN_VERSION,
      chainId: this.chainId,
      verifyingContract: this.diamondAddress,
    };
  }

  _makeDeadline(offsetSeconds = DEFAULT_DEADLINE_OFFSET) {
    return Math.floor(Date.now() / 1000) + offsetSeconds;
  }

  /**
   * Send an HTTP request to Fairycloak. Throws on non-2xx responses.
   * @private
   */
  async _fetch(method, path, body) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;

    const res = await fetch(`${this.fairycloakUrl}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        data?.error?.message ?? data?.error ?? text ?? `HTTP ${res.status}`;
      throw new Error(`Fairycloak ${method} ${path} (${res.status}): ${msg}`);
    }
    return data;
  }

  /**
   * Resolve a wallet/address/pubkey to a checksummed EVM address.
   * Accepts: ethers.Wallet/Signer, an address string, or an uncompressed hex pubkey string.
   * @private
   */
  async _resolveSignerAddress(walletOrAddress) {
    if (typeof walletOrAddress === "string") {
      if (ethers.isAddress(walletOrAddress))
        return ethers.getAddress(walletOrAddress);
      return ethers.computeAddress(walletOrAddress); // hex pubkey → address
    }
    if (typeof walletOrAddress.getAddress === "function") {
      return await walletOrAddress.getAddress();
    }
    throw new Error(
      "Expected an ethers.Wallet/Signer, an address string, or an uncompressed hex public-key string",
    );
  }

  // ─────────────── token decimal / scale helpers ─────────────────

  /**
   * Fetch and cache token decimals.
   * @private
   */
  async _fetchTokenDecimals(tokenAddress) {
    if (!this._tokenDecimals) this._tokenDecimals = {};
    const key = tokenAddress.toLowerCase();
    if (this._tokenDecimals[key] !== undefined) return this._tokenDecimals[key];
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const decimals = Number(await contract.decimals());
    this._tokenDecimals[key] = decimals;
    return decimals;
  }

  /**
   * Convert a raw ERC-20 token amount to contract scale.
   *
   * The anonymous contract stores balances and takes deposit/withdraw amounts in
   * **contract scale**: `rawAmount * 100 / 10^decimals`.  For a 6-decimal token
   * (USDC) that means 0.1 USDC = 100_000 raw → 10 contract scale.
   *
   * @param {string} tokenAddress
   * @param {bigint} rawAmount - Amount in raw ERC-20 units (wei-scaled by token decimals)
   * @returns {Promise<bigint>} Amount in contract scale
   * @private
   */
  async _toContractScale(tokenAddress, rawAmount) {
    const decimals = await this._fetchTokenDecimals(tokenAddress);
    const divisor = 10n ** BigInt(decimals);
    if ((rawAmount * 100n) % divisor !== 0n) {
      console.warn(
        `Amount ${rawAmount} is not fully representable in contract scale (2 decimals); the sub-cent remainder will be dropped.`,
      );
    }
    return (rawAmount * 100n) / divisor;
  }

  // ─────────────────────── on-chain reads ────────────────────────

  /**
   * Get on-chain core state for an anonymous account.
   *
   * @param {string} accountId
   * @returns {Promise<{exists:boolean, finalized:boolean, hasPendingAction:boolean, txId:bigint, elgamalPubkey:string, authNonce:bigint}>}
   */
  async getAnonymousAccountInfo(accountId) {
    validateAnonymousAccountId(accountId, "accountId");
    try {
      const data = await this._fetch(
        "GET",
        `/v1/views/anonymous/accounts/${accountId}/core`,
      );
      // Support both { result: {...} } and flat response shapes
      const r =
        data.result != null && typeof data.result === "object"
          ? data.result
          : data;
      return {
        exists: r.exists ?? false,
        finalized: r.finalized ?? false,
        // Fairycloak may use snake_case or camelCase
        hasPendingAction: r.pending_action ?? r.pendingAction ?? false,
        txId: _parseBigInt(r.tx_id ?? r.txId),
        elgamalPubkey: r.elgamal_pubkey ?? r.elgamalPubkey ?? "0x",
        authNonce: _parseBigInt(r.auth_nonce ?? r.authNonce),
      };
    } catch (e) {
      throw new Error(`Failed to get anonymous account info: ${e.message}`);
    }
  }

  /**
   * Read the current authNonce for an anonymous account from the chain.
   *
   * @param {string} accountId
   * @returns {Promise<bigint>}
   */
  async getAuthNonce(accountId) {
    const info = await this.getAnonymousAccountInfo(accountId);
    return info.authNonce;
  }

  /**
   * Check whether an address is an authorised signer for an anonymous account.
   *
   * @param {string} accountId
   * @param {string} signerAddress
   * @returns {Promise<boolean>}
   */
  async isAuthorizedSigner(accountId, signerAddress) {
    validateAnonymousAccountId(accountId, "accountId");
    const data = await this._fetch(
      "GET",
      `/v1/views/anonymous/accounts/${accountId}/authorized-signers/${signerAddress}`,
    );
    return data.result === true || data.result === "true";
  }

  // ─────────────── anonymous balance reads ───────────────────────

  /**
   * Fetch the raw combined ciphertext (base64) for an anonymous account's balance.
   * Returns null when no balance has been set yet.
   *
   * @param {string} accountId
   * @param {string} tokenAddress
   * @param {"available"|"pending"} [type="available"]
   * @returns {Promise<string|null>} Base64 ciphertext or null
   * @private
   */
  async _getAnonymousCiphertext(accountId, tokenAddress, type = "available") {
    const path =
      type === "pending"
        ? `/v1/views/anonymous/accounts/${accountId}/pending/${tokenAddress}`
        : `/v1/views/anonymous/accounts/${accountId}/available/${tokenAddress}`;

    const data = await this._fetch("GET", path);
    const { c1, c2 } = data.result;

    if ((!c1 || c1 === "0x") && (!c2 || c2 === "0x")) return null;

    const combined = new Uint8Array(64);
    combined.set(ethers.getBytes(c1), 0);
    combined.set(ethers.getBytes(c2), 32);
    return Buffer.from(combined).toString("base64");
  }

  /**
   * Decrypt an anonymous account's balance from the chain.
   * Returns amount in **contract scale** (the raw WASM-decrypted value).
   *
   * @param {string} accountId
   * @param {string} tokenAddress
   * @param {string} elGamalPrivateKey - Base64 private key
   * @param {"available"|"pending"} [type="available"]
   * @returns {Promise<{amount: number, ciphertext: string|null}>}
   * @private
   */
  async _decryptAnonymousBalance(
    accountId,
    tokenAddress,
    elGamalPrivateKey,
    type = "available",
  ) {
    const ciphertext = await this._getAnonymousCiphertext(
      accountId,
      tokenAddress,
      type,
    );
    if (!ciphertext) return { amount: 0, ciphertext: null };
    const wasm = await this._getWasm();
    let result;
    try {
      result = JSON.parse(wasm.decrypt_ciphertext(ciphertext, elGamalPrivateKey));
    } catch (e) {
      throw new Error(
        `Decryption failed. Is the elGamalPrivateKey correct for this accountId? (${e?.message ?? e})`,
      );
    }
    return { amount: result.decrypted_amount ?? 0, ciphertext };
  }

  /**
   * Get the decrypted available **and** pending balances for an anonymous account.
   *
   * Amounts are returned in **contract scale** (the encrypted integer stored on-chain,
   * equivalent to `tokenAmount × 100 / 10^decimals`).
   *
   * @param {string} accountId
   * @param {string} tokenAddress - ERC-20 token address
   * @param {string} elGamalPrivateKey - ElGamal private key (base64) for decryption
   * @returns {Promise<{available: {amount: number, ciphertext: string|null}, pending: {amount: number, ciphertext: string|null}}>}
   */
  async getAnonymousBalance(accountId, tokenAddress, elGamalPrivateKey) {
    validateAnonymousAccountId(accountId, "accountId");
    if (!ethers.isAddress(tokenAddress))
      throw new Error(`Invalid token address: ${tokenAddress}`);
    if (!elGamalPrivateKey) throw new Error("elGamalPrivateKey is required");

    const [available, pending] = await Promise.all([
      this._decryptAnonymousBalance(
        accountId,
        tokenAddress,
        elGamalPrivateKey,
        "available",
      ),
      this._decryptAnonymousBalance(
        accountId,
        tokenAddress,
        elGamalPrivateKey,
        "pending",
      ),
    ]);
    return { available, pending };
  }

  // ────────────────── key derivation ─────────────────────────────

  /**
   * Derive a deterministic ElGamal keypair for an anonymous account from an auth wallet.
   * Internally signs a typed-data message unique to (chainId, diamondAddress, accountId, authWallet)
   * and feeds the signature into the WASM key derivation function.
   *
   * Store the returned `privateKey` securely — it cannot be recovered without the wallet.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet
   * @param {string} accountId
   * @returns {Promise<{publicKey:string, privateKey:string}>} Base-64 encoded keypair
   */
  async deriveAnonymousKeys(authWallet, accountId) {
    validateAnonymousAccountId(accountId, "accountId");
    try {
      const wasm = await this._getWasm();
      const address = await authWallet.getAddress();

      const domain = {
        name: "ConfidentialTokens",
        version: "1",
        chainId: this.chainId,
        verifyingContract: this.diamondAddress,
      };
      const types = {
        DeriveAnonymousElGamalKey: [
          { name: "purpose", type: "string" },
          { name: "accountId", type: "string" },
          { name: "user", type: "address" },
          { name: "context", type: "bytes32" },
        ],
      };
      const contextHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "string", "string"],
          [
            this.chainId,
            this.diamondAddress,
            String(accountId),
            "anonymous-main",
          ],
        ),
      );
      const message = {
        purpose: "anonymous-elgamal-key-derive-v1",
        accountId: String(accountId),
        user: address.toLowerCase(),
        context: contextHash,
      };

      const signature = await authWallet.signTypedData(domain, types, message);
      const domainContext = JSON.stringify({
        chainId: this.chainId.toString(),
        verifyingContract: this.diamondAddress,
        user: address.toLowerCase(),
        accountId: String(accountId),
        purpose: "anonymous-elgamal-key-derive-v1",
        version: "1",
      });

      const keypair = JSON.parse(
        wasm.generate_deterministic_keypair(signature.slice(2), domainContext),
      );
      return {
        publicKey: keypair.public_key,
        privateKey: keypair.private_key,
      };
    } catch (e) {
      throw new Error(`Failed to derive anonymous keys: ${e.message}`);
    }
  }

  // ─────────────────── proof generation helpers ──────────────────

  /**
   * Generate a ZK transfer proof using the WASM module.
   *
   * Pass the result's `proofHex` directly to `transferToPublic` or `transferToAnonymous`.
   *
   * @param {string} elGamalPrivateKey - ElGamal private key (base64)
   * @param {Object} params
   * @param {string}  params.currentBalanceCiphertext   - Combined ciphertext (base64, 64 bytes)
   * @param {number}  params.currentBalanceContractScale - Balance in contract scale (token_amount × 100 / 10^decimals)
   * @param {number}  params.transferAmountContractScale - Transfer amount in the same scale
   * @param {string}  params.destinationPublicKey       - Recipient ElGamal pubkey (base64)
   * @returns {Promise<string>} ABI-encoded proof as "0x..." hex
   */
  async generateTransferProof(
    elGamalPrivateKey,
    {
      currentBalanceCiphertext,
      currentBalanceContractScale,
      transferAmountContractScale,
      destinationPublicKey,
    },
  ) {
    const wasm = await this._getWasm();
    const input = {
      current_balance_ciphertext: currentBalanceCiphertext,
      current_balance: currentBalanceContractScale,
      transfer_amount: transferAmountContractScale,
      source_keypair: elGamalPrivateKey,
      destination_pubkey: destinationPublicKey,
    };
    const result = JSON.parse(
      wasm.generate_transfer_proof(JSON.stringify(input)),
    );
    if (!result.success)
      throw new Error(
        `Transfer proof generation failed: ${result.error ?? "unknown error"}`,
      );
    return (
      "0x" +
      Buffer.from(ethers.getBytes(encodeTransferProof(result.data))).toString(
        "hex",
      )
    );
  }

  /**
   * Generate a ZK withdraw proof using the WASM module.
   *
   * Pass the result's `proofHex` directly to `withdraw`.
   *
   * @param {string} elGamalPrivateKey - ElGamal private key (base64)
   * @param {Object} params
   * @param {string}         params.currentBalanceCiphertext    - Combined ciphertext (base64, 64 bytes)
   * @param {number}         params.currentBalanceContractScale - Balance in contract scale
   * @param {number}         params.withdrawAmountContractScale - Withdraw amount in the same scale
   * @param {number|bigint}  params.nonce  - Next user tx-id: pass `accountInfo.txId + 1n` (NOT the current txId)
   * @returns {Promise<string>} ABI-encoded proof as "0x..." hex
   */
  async generateWithdrawProof(
    elGamalPrivateKey,
    {
      currentBalanceCiphertext,
      currentBalanceContractScale,
      withdrawAmountContractScale,
      nonce,
    },
  ) {
    if (nonce === undefined || nonce === null)
      throw new Error("nonce is required for withdraw proof generation");

    const wasm = await this._getWasm();
    const input = {
      current_balance_ciphertext: currentBalanceCiphertext,
      current_balance: currentBalanceContractScale,
      withdraw_amount: withdrawAmountContractScale,
      keypair: elGamalPrivateKey,
      nonce: Number(nonce),
    };
    const result = JSON.parse(
      wasm.generate_withdraw_proof(JSON.stringify(input)),
    );
    if (!result.success)
      throw new Error(
        `Withdraw proof generation failed: ${result.error ?? "unknown error"}`,
      );
    return (
      "0x" +
      Buffer.from(ethers.getBytes(encodeWithdrawProof(result.data))).toString(
        "hex",
      )
    );
  }

  // ───────────────── off-chain ZKP (IPFS) helpers ─────────────────

  /**
   * Upload ABI-encoded proof bytes to the configured StableTrust IPFS upload endpoint for an
   * off-chain ZKP transfer and return the bare CID. With off-chain ZKP, only this CID
   * (<=128 bytes) is placed on-chain;
   * Fairyport later fetches the full proof from IPFS and verifies it off-chain.
   *
   * @param {string} proofHex - "0x…" ABI-encoded proof hex (from generateTransferProof)
   * @returns {Promise<string>} bare CID (no "ipfs://" prefix)
   * @private
   */
  async _uploadProofToIpfs(proofHex) {
    if (!proofHex) throw new Error("cannot upload an empty proof to IPFS");
    const bytes = ethers.getBytes(proofHex);
    const cid = await uploadBytesToIpfs(bytes, "anon-transfer-proof.bin", {
      uploadUrl: this.ipfsUploadUrl,
      apiKey: this.ipfsApiKey,
    });
    if (!cid) {
      throw new Error(
        "IPFS upload returned no CID (check STABLETRUST_IPFS_UPLOAD_URL / STABLETRUST_IPFS_API_KEY)",
      );
    }
    return String(cid).trim();
  }

  /**
   * Resolve a transfer/withdraw `proof` payload and its EIP-712 `proofHash`, for `offchainZKP`.
   *
   * - `offchainZKP=false` (inline proof, default): the payload is the proof hex and
   *   `proofHash = keccak256(proof bytes)` - the original architecture, unchanged.
   * - `offchainZKP=true` (off-chain ZKP): the payload is a bare IPFS CID and
   *   `proofHash = keccak256(utf8 bytes of the CID)`. This matches the Fairycloak relay and the
   *   on-chain contract, which store the CID and verify the proof off-chain.
   *
   * @param {Object} p
   * @param {boolean} p.offchainZKP
   * @param {string} [p.proofHex] - "0x…" proof hex (auto mode, or inline manual mode)
   * @param {string} [p.cid] - pre-uploaded bare CID (manual mode + offchainZKP)
   * @returns {Promise<{proofPayload: string, proofHash: string}>}
   * @private
   */
  async _resolveProofPayload({ offchainZKP, proofHex, cid }) {
    if (!offchainZKP) {
      const hex = proofHex.startsWith("0x") ? proofHex : `0x${proofHex}`;
      return { proofPayload: hex, proofHash: ethers.keccak256(hex) };
    }
    const resolvedCid = (cid ?? (await this._uploadProofToIpfs(proofHex)))
      .toString()
      .trim()
      .replace(/^ipfs:\/\//i, "");
    if (!resolvedCid) {
      throw new Error("off-chain ZKP transfer requires a non-empty IPFS CID");
    }
    return {
      proofPayload: resolvedCid,
      proofHash: ethers.keccak256(ethers.toUtf8Bytes(resolvedCid)),
    };
  }

  // ─────────────────── Fairycloak operations ─────────────────────

  /**
   * Create a new anonymous account via Fairycloak.
   *
   * The relay submits the `createAnonymousAccount` transaction and pays gas.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Initial auth signer
   * @param {string} accountId - Caller-chosen account ID. Must be a non-empty, case-sensitive,
   *   alphanumeric string of at most 20 characters.
   * @param {string} elgamalPublicKey - ElGamal public key as base64 or "0x"-prefixed hex (32 bytes)
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600] - Deadline in seconds from now
   * @returns {Promise<{request_id:string, tx_hash:string, status:string, action:string}>}
   * @throws {Error} If `accountId` doesn't follow the anonymous account ID rules (see class docs).
   */
  async createAccount(authWallet, accountId, elgamalPublicKey, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      const authAddress = await authWallet.getAddress();

      // Normalise elgamal key to hex
      const elgamalHex = elgamalPublicKey.startsWith("0x")
        ? elgamalPublicKey
        : "0x" + Buffer.from(elgamalPublicKey, "base64").toString("hex");

      const clientRequestId = ethers.hexlify(ethers.randomBytes(32));
      const deadline = this._makeDeadline(deadlineOffset);

      //  Prepaid-fee funding (fees-for-all-ops) 
      // The relayer submits create... the fee payer must fund an initial deposit
      // in the active fee token and approve the diamond so it can pull it into
      // escrow. The create fee is charged from it and the remainder becomes the
      // account's prepaid balance once creation finalises.
      const [feeToken, minInitialDeposit, createFee] = await Promise.all([
        this.getFeeToken(),
        this.getAnonymousMinimumInitialFeeDeposit(),
        this.getAnonymousCreateAccountFee(),
      ]);
      const feePayer = authAddress;
      const initialFeeDeposit =
        options.initialFeeDeposit != null
          ? BigInt(options.initialFeeDeposit)
          : minInitialDeposit;
      if (initialFeeDeposit < minInitialDeposit)
        throw new Error(
          `initialFeeDeposit (${initialFeeDeposit}) is below the contract minimum (${minInitialDeposit})`,
        );
      if (initialFeeDeposit < createFee)
        throw new Error(
          `initialFeeDeposit (${initialFeeDeposit}) is below the create-account fee (${createFee})`,
        );

      if (feeToken === ethers.ZeroAddress) {
        throw new Error(
          "Active fee token is native (address 0); relayer-submitted create is unsupported for native fees " +
            "because the contract requires the fee payer to submit the tx. Configure an ERC-20 fee token or use a raw-tx create path.",
        );
      }

      if (initialFeeDeposit > 0n) {
        const walletWithProvider = authWallet.connect
          ? authWallet.connect(this.provider)
          : authWallet;
        const tokenContract = new ethers.Contract(
          feeToken,
          ERC20_ABI,
          walletWithProvider,
        );
        const [balance, allowance] = await Promise.all([
          tokenContract.balanceOf(feePayer),
          tokenContract.allowance(feePayer, this.diamondAddress),
        ]);
        if (balance < initialFeeDeposit)
          throw new Error(
            `Insufficient fee-token balance for initial deposit. Required: ${initialFeeDeposit}, available: ${balance} (token ${feeToken})`,
          );
        if (allowance < initialFeeDeposit) {
          const approveTx = await tokenContract.approve(
            this.diamondAddress,
            ethers.MaxUint256,
          );
          const receipt = await approveTx.wait();
          if (!receipt || receipt.status === 0)
            throw new Error("Fee token approval failed");
        }
      }

      // EIP-712 struct hashes for dynamic fields
      const initialSignersHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address[]"],
          [[authAddress]],
        ),
      );
      const elgamalPubkeyHash = ethers.keccak256(elgamalHex);

      const domain = this._buildDomain();
      const types = {
        AnonymousCreate: [
          { name: "accountId", type: "string" },
          { name: "initialSignersHash", type: "bytes32" },
          { name: "elgamalPubkeyHash", type: "bytes32" },
          { name: "clientRequestId", type: "bytes32" },
          { name: "feePayer", type: "address" },
          { name: "feeToken", type: "address" },
          { name: "initialFeeDeposit", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId,
        initialSignersHash,
        elgamalPubkeyHash,
        clientRequestId,
        feePayer,
        feeToken,
        initialFeeDeposit,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/accounts", {
        account_id: accountId,
        elgamal_pubkey: elgamalHex,
        auth_signers: [authAddress],
        client_request_id: clientRequestId,
        fee_payer: feePayer,
        fee_token: feeToken,
        initial_fee_deposit: initialFeeDeposit.toString(),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak")) throw e;
      throw new Error(`Failed to create anonymous account: ${msg}`);
    }
  }

  /**
   * Create an anonymous account if it doesn't already exist, and (optionally) wait
   * until it has settled (no pending CW→EVM action) before returning.
   *
   * Looks the account up by `accountId` first — if it already exists on-chain this
   * skips account creation entirely (idempotent re-runs with a stable `accountId`).
   * Note that an auth signer can only ever be bound to a single anonymous account,
   * so reusing a wallet across different `accountId`s will still fail at creation time.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Initial auth signer
   * @param {string} accountId - Caller-chosen account ID. Must be a non-empty, case-sensitive,
   *   alphanumeric string of at most 20 characters.
   * @param {string} elgamalPublicKey - ElGamal public key as base64 or "0x"-prefixed hex (32 bytes)
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600] - Deadline in seconds from now
   * @param {boolean} [options.waitUntilReady=true] - Poll until `hasPendingAction` is false
   * @param {number} [options.timeoutMs=180000] - Max time to wait for creation/readiness
   * @param {number} [options.pollIntervalMs=2000]
   * @returns {Promise<{accountId:string, accountInfo:Object, created:boolean}>}
   * @throws {Error} If `accountId` doesn't follow the anonymous account ID rules (see class docs).
   */
  async ensureAnonymousAccount(authWallet, accountId, elgamalPublicKey, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const {
      deadlineOffset = DEFAULT_DEADLINE_OFFSET,
      waitUntilReady = true,
      timeoutMs = 180_000,
      pollIntervalMs = 2000,
    } = options;

    const cutoff = Date.now() + timeoutMs;
    const waitForReady = async () => {
      let info = await this.getAnonymousAccountInfo(accountId);
      while (waitUntilReady && info.hasPendingAction) {
        if (Date.now() > cutoff) {
          throw new Error(
            `Timeout waiting for anonymous account ${accountId} to become ready`,
          );
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        info = await this.getAnonymousAccountInfo(accountId);
      }
      return info;
    };

    let accountInfo = await this.getAnonymousAccountInfo(accountId);
    if (accountInfo.exists) {
      accountInfo = await waitForReady();
      return { accountId, accountInfo, created: false };
    }

    const failIfAlreadyUsed = async (err) => {
      if (typeof err === "string" && err.includes("already used")) {
        const address = await authWallet.getAddress();
        throw new Error(
          `Signer ${address} is already bound to a different anonymous account, ` +
            `but no account exists with accountId "${accountId}". ` +
            `The provided accountId is likely incorrect — each auth signer can only ` +
            `ever be registered to a single anonymous account.`,
        );
      }
    };

    const created = await this.createAccount(authWallet, accountId, elgamalPublicKey, {
      deadlineOffset,
    });
    if (created.status === "failed" || created.error) {
      await failIfAlreadyUsed(created.error);
      throw new Error(
        `Failed to create anonymous account ${accountId}: ${created.error ?? "request failed"}`,
      );
    }

    const finalRequest = await this.waitForRequest(created.request_id, { timeoutMs });
    if (finalRequest.status === "failed" || finalRequest.error) {
      await failIfAlreadyUsed(finalRequest.error);
      throw new Error(
        `Failed to create anonymous account ${accountId}: ${finalRequest.error ?? "request failed"}`,
      );
    }

    while (!accountInfo.exists) {
      if (Date.now() > cutoff) {
        throw new Error(
          `Timeout waiting for anonymous account ${accountId} to be created`,
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      accountInfo = await this.getAnonymousAccountInfo(accountId);
    }

    accountInfo = await waitForReady();
    return { accountId, accountInfo, created: true };
  }

  /**
   * Update the set of authorised signers for an anonymous account via Fairycloak.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - A currently authorised signer
   * @param {string} accountId
   * @param {Object} keys
   * @param {Array<string|ethers.Wallet|ethers.Signer>} [keys.add=[]]    - Addresses/wallets/pubkeys to add
   * @param {Array<string|ethers.Wallet|ethers.Signer>} [keys.remove=[]] - Addresses/wallets/pubkeys to remove
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async updateAuthKeys(
    authWallet,
    accountId,
    { add = [], remove = [] } = {},
    options = {},
  ) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const addAddresses = await Promise.all(
        add.map((w) => this._resolveSignerAddress(w)),
      );
      const removeAddresses = await Promise.all(
        remove.map((w) => this._resolveSignerAddress(w)),
      );

      const addSignersHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [addAddresses]),
      );
      const removeSignersHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address[]"],
          [removeAddresses],
        ),
      );

      const domain = this._buildDomain();
      const types = {
        AnonymousUpdateKeys: [
          { name: "accountId", type: "string" },
          { name: "addSignersHash", type: "bytes32" },
          { name: "removeSignersHash", type: "bytes32" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        addSignersHash,
        removeSignersHash,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/keys/update", {
        account_id: accountId,
        add_signers: addAddresses,
        remove_signers: removeAddresses,
        auth_nonce: String(authNonce),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak")) throw e;
      throw new Error(`Failed to update auth keys: ${msg}`);
    }
  }

  /**
   * Deposit tokens into an anonymous account by forwarding a user-signed raw EVM transaction.
   *
   * The user's wallet pays gas for this transaction (unlike other operations where Fairycloak
   * pays gas). Fairycloak validates and broadcasts the raw tx unchanged.
   *
   * Steps performed internally:
   *   1. ERC-20 approve (if allowance is insufficient)
   *   2. Sign EIP-712 deposit auth payload
   *   3. Build and sign the raw `depositAnonymous(...)` EVM transaction
   *   4. Submit to Fairycloak `/v1/anonymous/deposit/raw-tx`
   *
   * @param {ethers.Wallet} authWallet - Wallet that owns the tokens and signs the tx
   * @param {string} accountId - Target anonymous account ID
   * @param {string} tokenAddress - ERC-20 token address
   * @param {bigint|string|number} amount - Amount in token units (wei-scaled by token decimals)
   * @param {Object} [options]
   * @param {number}  [options.deadlineOffset=3600]
   * @param {bigint}  [options.gasLimit=600000n]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async deposit(authWallet, accountId, tokenAddress, amount, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET, gasLimit = 600000n } =
      options;
    try {
      if (!ethers.isAddress(tokenAddress))
        throw new Error(`Invalid token address: ${tokenAddress}`);
      const amountBig = BigInt(amount);
      if (amountBig <= 0n) throw new Error("Amount must be greater than 0");

      const depositorAddress = await authWallet.getAddress();
      const walletWithProvider = authWallet.connect
        ? authWallet.connect(this.provider)
        : authWallet;

      // 1. Approve if needed
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        walletWithProvider,
      );

      const [balance, allowance] = await Promise.all([
        tokenContract.balanceOf(depositorAddress),
        tokenContract.allowance(depositorAddress, this.diamondAddress),
      ]);

      if (balance < amountBig)
        throw new Error(
          `Insufficient token balance. Required: ${amountBig}, Available: ${balance}`,
        );

      if (allowance < amountBig) {
        const approveTx = await tokenContract.approve(
          this.diamondAddress,
          ethers.MaxUint256,
        );
        const receipt = await approveTx.wait();
        if (!receipt || receipt.status === 0)
          throw new Error("Token approval failed");
      }

      // Convert raw ERC-20 units → contract scale.
      // The contract stores and accepts amounts as `rawAmount * 100 / 10^decimals`
      // and internally calls `safeTransferFrom(user, contract, plainAmount * tokenMul)`
      // where `tokenMul = 10^decimals / 100`.  Passing raw units here would cause the
      // contract to attempt a 10_000× larger transfer on a 6-decimal token, reverting.
      const plainAmountContractScale = await this._toContractScale(
        tokenAddress,
        amountBig,
      );
      if (plainAmountContractScale <= 0n)
        throw new Error(
          `Amount too small: ${amountBig} raw units rounds to 0 in contract scale`,
        );

      // 2. EIP-712 deposit auth signature
      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const domain = this._buildDomain();
      const types = {
        AnonymousDeposit: [
          { name: "accountId", type: "string" },
          { name: "token", type: "address" },
          { name: "plainAmount", type: "uint256" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        token: tokenAddress,
        plainAmount: plainAmountContractScale,
        authNonce,
        deadline: BigInt(deadline),
      };

      const authSig = await authWallet.signTypedData(domain, types, value);

      // 3. Build and sign the raw depositAnonymous transaction
      const calldata = DEPOSIT_INTERFACE.encodeFunctionData(
        "depositAnonymous",
        [
          accountId,
          tokenAddress,
          plainAmountContractScale,
          authNonce,
          BigInt(deadline),
          authSig,
        ],
      );

      const [nonce, feeData] = await Promise.all([
        this.provider.getTransactionCount(depositorAddress),
        this.provider.getFeeData(),
      ]);

      let txObj;
      if (feeData.maxFeePerGas) {
        txObj = {
          to: this.diamondAddress,
          data: calldata,
          nonce,
          chainId: BigInt(this.chainId),
          gasLimit,
          maxFeePerGas: (feeData.maxFeePerGas * 12n) / 10n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
          value: 0n,
        };
      } else {
        txObj = {
          to: this.diamondAddress,
          data: calldata,
          nonce,
          chainId: BigInt(this.chainId),
          gasLimit,
          gasPrice: (feeData.gasPrice * 11n) / 10n,
          value: 0n,
        };
      }

      const signedTx = await authWallet.signTransaction(txObj);

      // 4. Submit to Fairycloak
      return await this._fetch("POST", "/v1/anonymous/deposit/raw-tx", {
        raw_tx: signedTx,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Insufficient"))
        throw e;
      throw new Error(`Failed to deposit: ${msg}`);
    }
  }

  /**
   * Transfer from an anonymous account to a public EVM address via Fairycloak.
   *
   * **Auto-proof mode** (recommended): provide `elGamalPrivateKey`, `amount` (in token units),
   * and `destinationPublicKey`. The SDK fetches the ciphertext from the chain, decrypts the
   * current balance, and generates the ZK proof automatically.
   *
   * **Manual proof mode**: provide a pre-computed `proof` hex string from `generateTransferProof()`.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Authorised signer for the anonymous account
   * @param {string} accountId - Sender's anonymous account ID
   * @param {Object} params
   * @param {string}  params.recipient             - Recipient EVM address (must have a confidential account)
   * @param {string}  params.token                - Token address
   * @param {string}  [params.proof]              - Pre-computed ZK proof ("0x..." hex)
   * @param {string}  [params.elGamalPrivateKey]  - ElGamal private key (base64) for auto-proof
   * @param {bigint|string|number} [params.amount] - Transfer amount in token units for auto-proof
   * @param {string}  [params.destinationPublicKey] - Recipient ElGamal pubkey (base64) for auto-proof
   * @param {Object}  [options]
   * @param {number}  [options.deadlineOffset=3600]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async transferToPublic(
    authWallet,
    accountId,
    {
      recipient,
      token,
      proof,
      elGamalPrivateKey,
      amount,
      destinationPublicKey,
      offchainZKP = false,
    },
    options = {},
  ) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      if (!ethers.isAddress(recipient))
        throw new Error(`Invalid recipient address: ${recipient}`);
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);

      // `proofHex` holds the "0x…" proof (supplied or auto-generated below).
      const manualProof = Boolean(proof);
      let proofHex;
      let cid;
      if (manualProof) {
        if (offchainZKP) {
          cid = proof;
        } else {
          proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
        }
      } else {
        if (!elGamalPrivateKey)
          throw new Error("Either proof or elGamalPrivateKey must be provided");
        if (amount === undefined || amount === null)
          throw new Error("amount is required when auto-generating proof");

        // Convert raw ERC-20 units → contract scale for proof generation
        const transferAmountContractScale = Number(
          await this._toContractScale(token, BigInt(amount)),
        );

        // Auto-resolve destinationPublicKey from the recipient's on-chain confidential account
        let destPubkey = destinationPublicKey;
        if (!destPubkey) {
          const recipientData = await this._fetch(
            "GET",
            `/v1/views/accounts/${recipient}/core`,
          );
          if (!recipientData.result.exists)
            throw new Error(
              `Recipient ${recipient} has no confidential account on-chain`,
            );
          destPubkey = Buffer.from(
            ethers.getBytes(recipientData.result.elgamal_pubkey),
          ).toString("base64");
        }

        const { ciphertext, amount: currentBalance } =
          await this._decryptAnonymousBalance(
            accountId,
            token,
            elGamalPrivateKey,
            "available",
          );
        if (!ciphertext)
          throw new Error(
            "No available balance found for this anonymous account and token",
          );

        proofHex = await this.generateTransferProof(elGamalPrivateKey, {
          currentBalanceCiphertext: ciphertext,
          currentBalanceContractScale: currentBalance,
          transferAmountContractScale,
          destinationPublicKey: destPubkey,
        });
      }

      await this._assertSufficientPrepaidFees(accountId, offchainZKP);

      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      // Resolve the proof payload (inline hex vs off-chain IPFS CID) and its EIP-712 hash.
      const { proofPayload, proofHash } = await this._resolveProofPayload({
        offchainZKP,
        proofHex,
        cid,
      });

      const domain = this._buildDomain();
      const types = {
        AnonymousTransferToPublic: [
          { name: "senderId", type: "string" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "proofHash", type: "bytes32" },
          { name: "offchainZKP", type: "bool" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        senderId: String(accountId),
        recipient,
        token,
        proofHash,
        offchainZKP,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/transfers/public", {
        sender_id: accountId,
        recipient,
        token,
        proof: proofPayload,
        offchain_zkp: offchainZKP,
        auth_nonce: String(authNonce),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Invalid")) throw e;
      throw new Error(`Failed to transfer to public: ${msg}`);
    }
  }

  /**
   * Transfer from one anonymous account to another via Fairycloak.
   *
   * **Auto-proof mode** (recommended): provide `elGamalPrivateKey`, `amount` (in token units),
   * and `destinationPublicKey`. The SDK fetches the ciphertext, decrypts the balance, and generates
   * the ZK proof automatically.
   *
   * **Manual proof mode**: provide a pre-computed `proof` hex string from `generateTransferProof()`.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Authorised signer for the sender account
   * @param {string} senderAccountId
   * @param {Object} params
   * @param {string}        params.recipientId              - Recipient anonymous account ID
   * @param {string}        params.token                   - Token address
   * @param {string}        [params.proof]                 - Pre-computed ZK proof ("0x..." hex)
   * @param {string}        [params.elGamalPrivateKey]     - ElGamal private key (base64) for auto-proof
   * @param {bigint|string|number} [params.amount]         - Transfer amount in token units for auto-proof
   * @param {string}        [params.destinationPublicKey]  - Recipient ElGamal pubkey (base64) for auto-proof
   * @param {Object}  [options]
   * @param {number}  [options.deadlineOffset=3600]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async transferToAnonymous(
    authWallet,
    senderAccountId,
    {
      recipientId,
      token,
      proof,
      elGamalPrivateKey,
      amount,
      destinationPublicKey,
      offchainZKP = false,
    },
    options = {},
  ) {
    validateAnonymousAccountId(senderAccountId, "senderAccountId");
    validateAnonymousAccountId(recipientId, "recipientId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);

      // In manual mode + offchainZKP the caller passes a CID (not proof hex),, otherwise
      // `proofHex` holds the "0x…" proof 
      const manualProof = Boolean(proof);
      let proofHex;
      let cid;
      if (manualProof) {
        if (offchainZKP) {
          cid = proof;
        } else {
          proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
        }
      } else {
        if (!elGamalPrivateKey)
          throw new Error("Either proof or elGamalPrivateKey must be provided");
        if (amount === undefined || amount === null)
          throw new Error("amount is required when auto-generating proof");

        // Convert raw ERC-20 units → contract scale for proof generation
        const transferAmountContractScale = Number(
          await this._toContractScale(token, BigInt(amount)),
        );

        // Auto-resolve destinationPublicKey from the recipient's anonymous account on-chain
        let destPubkey = destinationPublicKey;
        if (!destPubkey) {
          const recipientData = await this._fetch(
            "GET",
            `/v1/views/anonymous/accounts/${recipientId}/core`,
          );
          if (!recipientData.result.exists)
            throw new Error(
              `Recipient anonymous account ${recipientId} does not exist on-chain`,
            );
          destPubkey = Buffer.from(
            ethers.getBytes(recipientData.result.elgamal_pubkey),
          ).toString("base64");
        }

        const { ciphertext, amount: currentBalance } =
          await this._decryptAnonymousBalance(
            senderAccountId,
            token,
            elGamalPrivateKey,
            "available",
          );
        if (!ciphertext)
          throw new Error(
            "No available balance found for this anonymous account and token",
          );

        proofHex = await this.generateTransferProof(elGamalPrivateKey, {
          currentBalanceCiphertext: ciphertext,
          currentBalanceContractScale: currentBalance,
          transferAmountContractScale,
          destinationPublicKey: destPubkey,
        });
      }

      await this._assertSufficientPrepaidFees(senderAccountId, offchainZKP);

      const authNonce = await this.getAuthNonce(senderAccountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const { proofPayload, proofHash } = await this._resolveProofPayload({
        offchainZKP,
        proofHex,
        cid,
      });

      const domain = this._buildDomain();
      const types = {
        AnonymousTransferToAnonymous: [
          { name: "senderId", type: "string" },
          { name: "recipientId", type: "string" },
          { name: "token", type: "address" },
          { name: "proofHash", type: "bytes32" },
          { name: "offchainZKP", type: "bool" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        senderId: String(senderAccountId),
        recipientId: String(recipientId),
        token,
        proofHash,
        offchainZKP,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/transfers/anonymous", {
        sender_id: senderAccountId,
        recipient_id: recipientId,
        token,
        proof: proofPayload,
        offchain_zkp: offchainZKP,
        auth_nonce: String(authNonce),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Invalid")) throw e;
      throw new Error(`Failed to transfer to anonymous: ${msg}`);
    }
  }

  /**
   * Apply a pending balance for an anonymous account via Fairycloak.
   *
   * After receiving an anonymous-to-anonymous transfer, the recipient must call
   * this to move the pending credit into their available balance.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet
   * @param {string} accountId
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async applyPending(authWallet, accountId, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const domain = this._buildDomain();
      const types = {
        AnonymousApplyPending: [
          { name: "accountId", type: "string" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/apply", {
        account_id: accountId,
        auth_nonce: String(authNonce),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak")) throw e;
      throw new Error(`Failed to apply pending: ${msg}`);
    }
  }

  /**
   * Withdraw from an anonymous account to a public EVM address via Fairycloak.
   *
   * **Auto-proof mode** (recommended): provide `elGamalPrivateKey`. The SDK fetches the token
   * decimals, derives the contract-scale amount from `plainAmount`, and generates the ZK proof
   * automatically.
   *
   * **Manual proof mode**: provide a pre-computed `proof` hex string from `generateWithdrawProof()`.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Authorised signer for the anonymous account
   * @param {string} accountId
   * @param {Object} params
   * @param {string}             params.destination       - Destination EVM address
   * @param {string}             params.token            - Token address
   * @param {bigint|string|number} params.plainAmount    - Withdrawal amount in token units
   * @param {string}             [params.proof]          - Pre-computed ZK proof ("0x..." hex)
   * @param {string}             [params.elGamalPrivateKey] - ElGamal private key (base64) for auto-proof
   * @param {boolean}            [params.offchainZKP=false] - When true, upload the proof to IPFS and put
   *   only its CID on-chain (needs `ipfsUploadUrl`/`ipfsApiKey` config or the StableTrust IPFS env vars)
   * @param {Object}  [options]
   * @param {number}  [options.deadlineOffset=3600]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async withdraw(
    authWallet,
    accountId,
    {
      destination,
      token,
      plainAmount,
      proof,
      elGamalPrivateKey,
      offchainZKP = false,
    },
    options = {},
  ) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      if (!ethers.isAddress(destination))
        throw new Error(`Invalid destination address: ${destination}`);
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);

      const amountBig = BigInt(plainAmount);

      // Convert raw ERC-20 units → contract scale.
      // The contract's withdrawAnonymous expects plainAmount in contract scale
      // and internally calls `safeTransfer(destination, plainAmount * tokenMul)`.
      const withdrawAmountContractScale = await this._toContractScale(
        token,
        amountBig,
      );
      if (withdrawAmountContractScale <= 0n)
        throw new Error(
          `Amount too small: ${amountBig} raw units rounds to 0 in contract scale`,
        );

      // Single call — gives us both txId (proof nonce) and authNonce (EIP-712 sig).
      // txId is the contract's per-account transaction counter ("user tx-id").
      // Withdraw proofs bind to the *next* tx id (txId + 1) — the contract increments
      // on every action, and the proof must commit to what the counter will be after
      // submission. authNonce is the separate EIP-712 replay-protection nonce.
      const accountInfo = await this.getAnonymousAccountInfo(accountId);
      const authNonce = accountInfo.authNonce;
      const txId = accountInfo.txId;

      // In manual mode + offchainZKP the caller passes a CID (not proof hex)
      const manualProof = Boolean(proof);
      let proofHex;
      let cid;
      if (manualProof) {
        if (offchainZKP) {
          cid = proof;
        } else {
          proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
        }
      } else {
        if (!elGamalPrivateKey)
          throw new Error("Either proof or elGamalPrivateKey must be provided");

        const { ciphertext, amount: currentBalance } =
          await this._decryptAnonymousBalance(
            accountId,
            token,
            elGamalPrivateKey,
            "available",
          );
        if (!ciphertext)
          throw new Error(
            "No available balance found for this anonymous account and token",
          );

        proofHex = await this.generateWithdrawProof(elGamalPrivateKey, {
          currentBalanceCiphertext: ciphertext,
          currentBalanceContractScale: currentBalance,
          withdrawAmountContractScale: Number(withdrawAmountContractScale),
          nonce: txId + 1n,  // proof binds to *next* txId (current + 1)
        });
      }
      const deadline = this._makeDeadline(deadlineOffset);

      // Resolve the proof payload (inline hex vs off-chain IPFS CID) and its EIP-712 hash.
      const { proofPayload, proofHash } = await this._resolveProofPayload({
        offchainZKP,
        proofHex,
        cid,
      });

      const domain = this._buildDomain();
      const types = {
        AnonymousWithdraw: [
          { name: "accountId", type: "string" },
          { name: "destination", type: "address" },
          { name: "token", type: "address" },
          { name: "plainAmount", type: "uint256" },
          { name: "proofHash", type: "bytes32" },
          { name: "offchainZKP", type: "bool" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        destination,
        token,
        plainAmount: withdrawAmountContractScale,
        proofHash,
        offchainZKP,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/withdraw", {
        account_id: accountId,
        destination,
        token,
        plain_amount: String(withdrawAmountContractScale),
        proof: proofPayload,
        offchain_zkp: offchainZKP,
        auth_nonce: String(authNonce),
        deadline: String(deadline),
        signature,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Invalid")) throw e;
      throw new Error(`Failed to withdraw: ${msg}`);
    }
  }

  /**
   * Get total, available, and pending balance (contract scale).
   *
   * @param {string} accountId
   * @param {string} tokenAddress
   * @param {string} elGamalPrivateKey
   * @returns {Promise<{ amount: number, available: number, pending: number }>}
   */
  async getBalance(accountId, tokenAddress, elGamalPrivateKey) {
    validateAnonymousAccountId(accountId, "accountId");
    try {
      if (!ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!elGamalPrivateKey) {
        throw new Error("elGamalPrivateKey is required");
      }

      const { available, pending } = await this.getAnonymousBalance(
        accountId,
        tokenAddress,
        elGamalPrivateKey,
      );

      const availableAmt = available?.amount ?? 0;
      const pendingAmt = pending?.amount ?? 0;

      return {
        amount: availableAmt + pendingAmt,
        available: availableAmt,
        pending: pendingAmt,
      };
    } catch (e) {
      throw new Error(`Failed to get balance: ${e.message}`);
    }
  }

  // ─────────────────── prepaid fee reads ─────────────────────────

  /**
   * Get the currently configured fee token address from the contract.
   *
   * Deposits via `depositFees` must use this token. Rotate-aware: the fee token
   * can change over time, but existing balances for old tokens remain withdrawable.
   *
   * @returns {Promise<string>} Checksummed ERC-20 token address (or address(0) if none set)
   */
  async getFeeToken() {
    try {
      const data = await this._fetch("GET", "/v1/views/fee-token");
      const raw = data.result ?? data;
      const addr = typeof raw === "string" ? raw : raw.feeToken ?? raw;
      return ethers.getAddress(addr);
    } catch (e) {
      throw new Error(`Failed to get fee token: ${e.message}`);
    }
  }

  /**
   * Fixed fee charged when creating an anonymous account.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousCreateAccountFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/anonymous-create");
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous create-account fee: ${e.message}`);
    }
  }

  /**
   * Minimum initial fee deposit required at account creation.
   *
   * @returns {Promise<bigint>} Amount in raw fee-token units
   */
  async getAnonymousMinimumInitialFeeDeposit() {
    try {
      const data = await this._fetch(
        "GET",
        "/v1/views/fees/anonymous-minimum-initial-deposit",
      );
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(
        `Failed to get anonymous minimum initial fee deposit: ${e.message}`,
      );
    }
  }

  /**
   * Fixed fee charged for an auth-key update.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousUpdateKeysFee() {
    try {
      const data = await this._fetch(
        "GET",
        "/v1/views/fees/anonymous-update-keys",
      );
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous update-keys fee: ${e.message}`);
    }
  }

  /**
   * Fixed fee charged for an apply-pending operation.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousApplyPendingFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/anonymous-apply");
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous apply-pending fee: ${e.message}`);
    }
  }

  /**
   * Fixed fee charged for an IPFS-proof withdraw.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousIpfsWithdrawFee() {
    try {
      const data = await this._fetch(
        "GET",
        "/v1/views/fees/anonymous-withdraw-ipfs",
      );
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous IPFS withdraw fee: ${e.message}`);
    }
  }

  /**
   * Fixed fee charged for an inline-proof withdraw.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousInlineWithdrawFee() {
    try {
      const data = await this._fetch(
        "GET",
        "/v1/views/fees/anonymous-withdraw-inline",
      );
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(
        `Failed to get anonymous inline withdraw fee: ${e.message}`,
      );
    }
  }

  /**
   * Get the fixed fee used by all non-anonymous confidential transfers.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getNonAnonymousTransferFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/non-anonymous");
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get non-anonymous transfer fee: ${e.message}`);
    }
  }

  /**
   * Get the fixed fee used by anonymous transfers with proofs stored on IPFS.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousIpfsTransferFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/anonymous-ipfs");
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous IPFS transfer fee: ${e.message}`);
    }
  }

  /**
   * Get the fixed fee used by anonymous transfers with proofs submitted inline.
   *
   * @returns {Promise<bigint>} Fee amount in raw fee-token units
   */
  async getAnonymousInlineTransferFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/anonymous-inline");
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get anonymous inline transfer fee: ${e.message}`);
    }
  }

  /**
   * Get the prepaid fee balance for an anonymous account and token (in raw fee-token units).
   *
   * @param {string} accountId
   * @param {string} token - ERC-20 token address (use `getFeeToken()` to get the active fee token)
   * @returns {Promise<bigint>}
   */
  async getPrepaidFeeBalance(accountId, token) {
    validateAnonymousAccountId(accountId, "accountId");
    try {
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);
      const data = await this._fetch(
        "GET",
        `/v1/views/anonymous/accounts/${accountId}/prepaid-fees/${token}`,
      );
      return _parseBigInt(data.result ?? data);
    } catch (e) {
      throw new Error(`Failed to get prepaid fee balance: ${e.message}`);
    }
  }

  /**
   * Check that the anonymous account has sufficient prepaid fees to cover one transfer.
   * Throws a descriptive error if the balance is insufficient.
   * @private
   */
  async _assertSufficientPrepaidFees(accountId, offchainZKP) {
    const feePromise = offchainZKP
      ? this.getAnonymousIpfsTransferFee()
      : this.getAnonymousInlineTransferFee();
    const [feeToken, feeAmount] = await Promise.all([
      this.getFeeToken(),
      feePromise,
    ]);
    if (feeAmount === 0n) return; // no fee configured for this path

    const balance = await this.getPrepaidFeeBalance(accountId, feeToken);
    if (balance < feeAmount) {
      const path = offchainZKP ? "IPFS" : "inline";
      throw new Error(
        `Insufficient prepaid fee balance for anonymous account "${accountId}" (${path} transfer). ` +
          `Required: ${feeAmount} (raw units of fee token ${feeToken}), ` +
          `available: ${balance}. ` +
          `Call depositFees(wallet, accountId, amount) to top up the prepaid fee reserve. ` +
          `Use getFeeToken() and the matching anonymous fee getter to check the required amount.`,
      );
    }
  }

  // ─────────────────── prepaid fee actions ────────────────────────

  /**
   * Deposit tokens into the prepaid fee reserve for an anonymous account.
   *
   * Mirrors `deposit()` from a transaction-signing perspective: the user wallet pays
   * gas and signs the raw EVM transaction. Fairycloak validates and broadcasts it.
   *
   * Steps:
   *   1. Fetch the active fee token from the contract
   *   2. ERC-20 approve if allowance is insufficient
   *   3. Sign EIP-712 AnonymousAddFees authorisation payload
   *   4. Build and sign the raw `addFees(...)` EVM transaction
   *   5. Submit to Fairycloak `/v1/anonymous/fees/add/raw-tx`
   *
   * @param {ethers.Wallet} authWallet - Wallet that owns the tokens and pays gas
   * @param {string} accountId - Target anonymous account ID
   * @param {bigint|string|number} amount - Amount in raw fee-token units (wei for native currency)
   * @param {Object} [options]
   * @param {number}  [options.deadlineOffset=3600]
   * @param {bigint}  [options.gasLimit=300000n]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async depositFees(authWallet, accountId, amount, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET, gasLimit = 300000n } =
      options;
    try {
      const amountBig = BigInt(amount);
      if (amountBig <= 0n) throw new Error("Amount must be greater than 0");

      const feeToken = await this.getFeeToken();
      const isNative = feeToken === ethers.ZeroAddress;

      const depositorAddress = await authWallet.getAddress();
      const walletWithProvider = authWallet.connect
        ? authWallet.connect(this.provider)
        : authWallet;

      if (isNative) {
        // Native currency: check wallet balance, no ERC-20 approve needed
        const balance = await this.provider.getBalance(depositorAddress);
        if (balance < amountBig)
          throw new Error(
            `Insufficient native balance. Required: ${amountBig}, available: ${balance}`,
          );
      } else {
        // ERC-20: approve if needed
        const tokenContract = new ethers.Contract(
          feeToken,
          ERC20_ABI,
          walletWithProvider,
        );

        const [balance, allowance] = await Promise.all([
          tokenContract.balanceOf(depositorAddress),
          tokenContract.allowance(depositorAddress, this.diamondAddress),
        ]);

        if (balance < amountBig)
          throw new Error(
            `Insufficient fee token balance. Required: ${amountBig}, available: ${balance}`,
          );

        if (allowance < amountBig) {
          const approveTx = await tokenContract.approve(
            this.diamondAddress,
            ethers.MaxUint256,
          );
          const receipt = await approveTx.wait();
          if (!receipt || receipt.status === 0)
            throw new Error("Fee token approval failed");
        }
      }

      // 2. EIP-712 AnonymousAddFees signature
      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const domain = this._buildDomain();
      const types = {
        AnonymousAddFees: [
          { name: "accountId", type: "string" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        token: feeToken,
        amount: amountBig,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      // 3. Build and sign the raw addFees transaction
      const calldata = ADD_FEES_INTERFACE.encodeFunctionData("addFees", [
        accountId,
        feeToken,
        amountBig,
        authNonce,
        BigInt(deadline),
        signature,
      ]);

      const [nonce, feeData] = await Promise.all([
        this.provider.getTransactionCount(depositorAddress),
        this.provider.getFeeData(),
      ]);

      const txValue = isNative ? amountBig : 0n;
      let txObj;
      if (feeData.maxFeePerGas) {
        txObj = {
          to: this.diamondAddress,
          data: calldata,
          nonce,
          chainId: BigInt(this.chainId),
          gasLimit,
          maxFeePerGas: (feeData.maxFeePerGas * 12n) / 10n,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
          value: txValue,
        };
      } else {
        txObj = {
          to: this.diamondAddress,
          data: calldata,
          nonce,
          chainId: BigInt(this.chainId),
          gasLimit,
          gasPrice: (feeData.gasPrice * 11n) / 10n,
          value: txValue,
        };
      }

      const signedTx = await authWallet.signTransaction(txObj);

      // 4. Submit to Fairycloak
      return await this._fetch("POST", "/v1/anonymous/fees/add/raw-tx", {
        raw_tx: signedTx,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (
        msg.startsWith("Fairycloak") ||
        msg.startsWith("Insufficient") ||
        msg.startsWith("No fee token")
      )
        throw e;
      throw new Error(`Failed to deposit fees: ${msg}`);
    }
  }

  /**
   * Build and sign a raw EVM transaction targeting the diamond, for the user-funded
   * raw-tx flows (withdrawFees / withdrawAllFees). The wallet that signs pays the gas.
   * Supports both EIP-1559 and legacy fee markets. Nonce/chainId/fees are supplied
   * explicitly, so `authWallet` does not need to be provider-connected.
   * @private
   */
  async _signRawDiamondTx(authWallet, calldata, value, gasLimit) {
    const fromAddress = await authWallet.getAddress();
    const [nonce, feeData] = await Promise.all([
      this.provider.getTransactionCount(fromAddress),
      this.provider.getFeeData(),
    ]);
    let txObj;
    if (feeData.maxFeePerGas) {
      txObj = {
        to: this.diamondAddress,
        data: calldata,
        nonce,
        chainId: BigInt(this.chainId),
        gasLimit,
        maxFeePerGas: (feeData.maxFeePerGas * 12n) / 10n,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
        value,
      };
    } else {
      txObj = {
        to: this.diamondAddress,
        data: calldata,
        nonce,
        chainId: BigInt(this.chainId),
        gasLimit,
        gasPrice: (feeData.gasPrice * 11n) / 10n,
        value,
      };
    }
    return authWallet.signTransaction(txObj);
  }

  /**
   * Withdraw a specific amount from the prepaid fee reserve.
   *
   * User-funded raw-transaction model (like deposit/addFees): the anonymous signer
   * authorises the inner operation via EIP-712, and the same wallet signs and funds
   * the outer `withdrawFees(...)` EVM transaction (zero ETH value). Fairycloak validates
   * and broadcasts it unchanged. The wallet pays the gas; no prepaid fee is charged.
   *
   * Use this to reclaim fees for a specific (possibly historical) fee token.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Authorised signer; also funds the outer tx
   * @param {string} accountId
   * @param {Object} params
   * @param {string}              params.token       - Fee token address to withdraw
   * @param {string}              params.destination - Destination EVM address
   * @param {bigint|string|number} params.amount     - Amount in raw ERC-20 units
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600]
   * @param {bigint} [options.gasLimit=300000n]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async withdrawFees(
    authWallet,
    accountId,
    { token, destination, amount },
    options = {},
  ) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET, gasLimit = 300000n } =
      options;
    try {
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);
      if (!ethers.isAddress(destination))
        throw new Error(`Invalid destination address: ${destination}`);
      const amountBig = BigInt(amount);
      if (amountBig <= 0n) throw new Error("Amount must be greater than 0");

      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const domain = this._buildDomain();
      const types = {
        AnonymousWithdrawFees: [
          { name: "accountId", type: "string" },
          { name: "token", type: "address" },
          { name: "destination", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        token,
        destination,
        amount: amountBig,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      // Build + sign the user-funded raw withdrawFees tx (must carry zero ETH value).
      const calldata = WITHDRAW_FEES_INTERFACE.encodeFunctionData(
        "withdrawFees",
        [
          accountId,
          token,
          destination,
          amountBig,
          authNonce,
          BigInt(deadline),
          signature,
        ],
      );
      const signedTx = await this._signRawDiamondTx(
        authWallet,
        calldata,
        0n,
        gasLimit,
      );

      return await this._fetch("POST", "/v1/anonymous/fees/withdraw", {
        raw_tx: signedTx,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Invalid")) throw e;
      throw new Error(`Failed to withdraw fees: ${msg}`);
    }
  }

  /**
   * Withdraw all prepaid fee balances across all (including historical) fee tokens.
   *
   * User-funded raw-transaction model (like withdrawFees): the anonymous signer
   * authorises the drain via EIP-712 and the same wallet signs and funds the outer
   * `withdrawAllFees(...)` EVM transaction (zero ETH value). The wallet pays the gas.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Authorised signer; also funds the outer tx
   * @param {string} accountId
   * @param {Object} params
   * @param {string} params.destination - Destination EVM address
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600]
   * @param {bigint} [options.gasLimit=300000n]
   * @returns {Promise<{request_id:string, tx_hash:string, status:string}>}
   */
  async withdrawAllFees(authWallet, accountId, { destination }, options = {}) {
    validateAnonymousAccountId(accountId, "accountId");
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET, gasLimit = 300000n } =
      options;
    try {
      if (!ethers.isAddress(destination))
        throw new Error(`Invalid destination address: ${destination}`);

      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const domain = this._buildDomain();
      const types = {
        AnonymousWithdrawAllFees: [
          { name: "accountId", type: "string" },
          { name: "destination", type: "address" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId: String(accountId),
        destination,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      // Build + sign the user-funded raw withdrawAllFees tx (must carry zero ETH value).
      const calldata = WITHDRAW_ALL_FEES_INTERFACE.encodeFunctionData(
        "withdrawAllFees",
        [accountId, destination, authNonce, BigInt(deadline), signature],
      );
      const signedTx = await this._signRawDiamondTx(
        authWallet,
        calldata,
        0n,
        gasLimit,
      );

      return await this._fetch("POST", "/v1/anonymous/fees/withdraw-all", {
        raw_tx: signedTx,
      });
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.startsWith("Fairycloak") || msg.startsWith("Invalid")) throw e;
      throw new Error(`Failed to withdraw all fees: ${msg}`);
    }
  }

  // ──────────────────── request tracking ─────────────────────────

  /**
   * Get the current status of a Fairycloak request.
   *
   * Terminal statuses: `completed`, `failed`
   * Transaction statuses: `confirmed`, `mined`, `submitted`
   * Initial status: `accepted`
   *
   * @param {string} requestId
   * @returns {Promise<Object>}
   */
  async getRequestStatus(requestId) {
    return await this._fetch("GET", `/v1/requests/${requestId}`);
  }

  /**
   * Fetch the durable event history for a Fairycloak request.
   *
   * Useful for reconnect/recovery in frontend applications.
   *
   * @param {string} requestId
   * @param {Object} [options]
   * @param {number} [options.afterSeq=0]  - Only return events with sequence > afterSeq
   * @param {number} [options.limit=100]
   * @returns {Promise<{request_id:string, events:Array}>}
   */
  async getRequestEvents(requestId, { afterSeq = 0, limit = 100 } = {}) {
    return await this._fetch(
      "GET",
      `/v1/requests/${requestId}/events/history?after_seq=${afterSeq}&limit=${limit}`,
    );
  }

  /**
   * Poll a Fairycloak request until it reaches a terminal state or times out.
   *
   * Terminal states: `completed`, `confirmed`, `failed`
   *
   * @param {string} requestId
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=120000]  - Total timeout in milliseconds
   * @param {number} [options.pollIntervalMs=2000]
   * @returns {Promise<Object>} Final request record
   */
  async waitForRequest(
    requestId,
    { timeoutMs = 120000, pollIntervalMs = 2000 } = {},
  ) {
    const terminal = new Set(["completed", "confirmed", "failed"]);
    const cutoff = Date.now() + timeoutMs;

    while (Date.now() < cutoff) {
      const status = await this.getRequestStatus(requestId);
      if (terminal.has(status.status)) return status;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `Timeout waiting for Fairycloak request ${requestId} after ${timeoutMs}ms`,
    );
  }
}
