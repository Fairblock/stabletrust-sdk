import { ethers } from "ethers";
import { initializeWasm } from "./wasm-loader.js";
import { encodeTransferProof, encodeWithdrawProof } from "./utils.js";
import { getStabletrustContractAddress } from "./constants.js";

// EIP-712 domain for anonymous operations (LibAnonAuth domain name)
const ANON_DOMAIN_NAME = "ConfidentialMirrorAnonymous";
const ANON_DOMAIN_VERSION = "1";

// Default deadline offset: 1 hour
const DEFAULT_DEADLINE_OFFSET = 3600;

// Minimal ABI — only used for deposit calldata encoding (reads go through Fairycloak views)
const DEPOSIT_INTERFACE = new ethers.Interface([
  "function depositAnonymous(string accountId, address token, uint256 plainAmount, uint256 authNonce, uint256 deadline, bytes authSig) external",
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
 */
export class AnonymousTransferClient {
  /**
   * @param {Object} config
   * @param {string} config.fairycloakUrl - Fairycloak relay base URL, e.g. "http://127.0.0.1:8080"
   * @param {number|string} config.chainId - Chain ID (used to auto-resolve the contract address)
   * @param {string} config.rpcUrl - EVM JSON-RPC endpoint (used for on-chain reads and raw-tx signing)
   * @param {string} [config.diamondAddress] - Optional override for the diamond contract address
   * @param {string} [config.apiKey] - Optional Fairycloak API key
   */
  constructor({ fairycloakUrl, diamondAddress, chainId, rpcUrl, apiKey } = {}) {
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
   * Resolve a pubkey-or-wallet to an uncompressed 65-byte hex pubkey (0x04...).
   * Accepts: ethers.Wallet, ethers.SigningKey, or a hex pubkey string.
   * @private
   */
  _resolvePubkey(walletOrPubkey) {
    if (typeof walletOrPubkey === "string") {
      return walletOrPubkey; // already a hex pubkey
    }
    if (walletOrPubkey.signingKey) {
      return walletOrPubkey.signingKey.publicKey; // ethers.Wallet → uncompressed pubkey
    }
    if (walletOrPubkey.publicKey) {
      return walletOrPubkey.publicKey; // ethers.SigningKey
    }
    throw new Error(
      "Expected an ethers.Wallet or uncompressed hex public-key string",
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
    const contract = new ethers.Contract(
      tokenAddress,
      ["function decimals() view returns (uint8)"],
      this.provider,
    );
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
    return (rawAmount * 100n) / 10n ** BigInt(decimals);
  }

  // ─────────────────────── on-chain reads ────────────────────────

  /**
   * Get on-chain core state for an anonymous account.
   *
   * @param {string} accountId
   * @returns {Promise<{exists:boolean, finalized:boolean, hasPendingAction:boolean, txId:bigint, elgamalPubkey:string, authNonce:bigint}>}
   */
  async getAnonymousAccountInfo(accountId) {
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
    const result = JSON.parse(
      wasm.decrypt_ciphertext(ciphertext, elGamalPrivateKey),
    );
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

  // ─────────────────── Fairycloak operations ─────────────────────

  /**
   * Create a new anonymous account via Fairycloak.
   *
   * The relay submits the `createAnonymousAccount` transaction and pays gas.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - Initial auth signer
   * @param {string} accountId - Caller-chosen account ID (non-empty string, case-sensitive)
   * @param {string} elgamalPublicKey - ElGamal public key as base64 or "0x"-prefixed hex (32 bytes)
   * @param {Object} [options]
   * @param {number} [options.deadlineOffset=3600] - Deadline in seconds from now
   * @returns {Promise<{request_id:string, tx_hash:string, status:string, action:string}>}
   */
  async createAccount(authWallet, accountId, elgamalPublicKey, options = {}) {
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      const authAddress = await authWallet.getAddress();
      const authPubkey = this._resolvePubkey(authWallet); // uncompressed 65-byte pubkey

      // Normalise elgamal key to hex
      const elgamalHex = elgamalPublicKey.startsWith("0x")
        ? elgamalPublicKey
        : "0x" + Buffer.from(elgamalPublicKey, "base64").toString("hex");

      const clientRequestId = ethers.hexlify(ethers.randomBytes(32));
      const deadline = this._makeDeadline(deadlineOffset);

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
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        accountId,
        initialSignersHash,
        elgamalPubkeyHash,
        clientRequestId,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/accounts", {
        account_id: accountId,
        elgamal_pubkey: elgamalHex,
        auth_pubkeys: [authPubkey],
        client_request_id: clientRequestId,
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
   * Update the set of authorised signers for an anonymous account via Fairycloak.
   *
   * @param {ethers.Wallet|ethers.Signer} authWallet - A currently authorised signer
   * @param {string} accountId
   * @param {Object} keys
   * @param {Array<string|ethers.Wallet>} [keys.add=[]]    - Pubkeys/wallets to add
   * @param {Array<string|ethers.Wallet>} [keys.remove=[]] - Pubkeys/wallets to remove
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
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);

      const addPubkeys = add.map((w) => this._resolvePubkey(w));
      const removePubkeys = remove.map((w) => this._resolvePubkey(w));

      // EIP-712 signs over address arrays, not raw pubkeys
      const addAddresses = addPubkeys.map((pk) => ethers.computeAddress(pk));
      const removeAddresses = removePubkeys.map((pk) =>
        ethers.computeAddress(pk),
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
        add_pubkeys: addPubkeys,
        remove_pubkeys: removePubkeys,
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
        [
          "function balanceOf(address) view returns (uint256)",
          "function allowance(address,address) view returns (uint256)",
          "function approve(address,uint256) returns (bool)",
        ],
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
    },
    options = {},
  ) {
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      if (!ethers.isAddress(recipient))
        throw new Error(`Invalid recipient address: ${recipient}`);
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);

      let proofHex;
      if (proof) {
        proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
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

      const authNonce = await this.getAuthNonce(accountId);
      const deadline = this._makeDeadline(deadlineOffset);
      const proofHash = ethers.keccak256(proofHex);

      const domain = this._buildDomain();
      const types = {
        AnonymousTransferToPublic: [
          { name: "senderId", type: "string" },
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "proofHash", type: "bytes32" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        senderId: String(accountId),
        recipient,
        token,
        proofHash,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/transfers/public", {
        sender_id: accountId,
        recipient,
        token,
        proof: proofHex,
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
    },
    options = {},
  ) {
    const { deadlineOffset = DEFAULT_DEADLINE_OFFSET } = options;
    try {
      if (!ethers.isAddress(token))
        throw new Error(`Invalid token address: ${token}`);

      let proofHex;
      if (proof) {
        proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
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

      const authNonce = await this.getAuthNonce(senderAccountId);
      const deadline = this._makeDeadline(deadlineOffset);
      const proofHash = ethers.keccak256(proofHex);

      const domain = this._buildDomain();
      const types = {
        AnonymousTransferToAnonymous: [
          { name: "senderId", type: "string" },
          { name: "recipientId", type: "string" },
          { name: "token", type: "address" },
          { name: "proofHash", type: "bytes32" },
          { name: "authNonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        senderId: String(senderAccountId),
        recipientId: String(recipientId),
        token,
        proofHash,
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/transfers/anonymous", {
        sender_id: senderAccountId,
        recipient_id: recipientId,
        token,
        proof: proofHex,
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
    },
    options = {},
  ) {
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

      let proofHex;
      if (proof) {
        proofHex = proof.startsWith("0x") ? proof : `0x${proof}`;
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
      const proofHash = ethers.keccak256(proofHex);

      const domain = this._buildDomain();
      const types = {
        AnonymousWithdraw: [
          { name: "accountId", type: "string" },
          { name: "destination", type: "address" },
          { name: "token", type: "address" },
          { name: "plainAmount", type: "uint256" },
          { name: "proofHash", type: "bytes32" },
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
        authNonce,
        deadline: BigInt(deadline),
      };

      const signature = await authWallet.signTypedData(domain, types, value);

      return await this._fetch("POST", "/v1/anonymous/withdraw", {
        account_id: accountId,
        destination,
        token,
        plain_amount: String(withdrawAmountContractScale),
        proof: proofHex,
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
