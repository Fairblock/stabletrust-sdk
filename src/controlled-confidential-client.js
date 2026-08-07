import { ethers } from "ethers";
import { ConfidentialTransferClient } from "./confidential-client.js";
import { encodeTransferProof, encodeWithdrawProof, toContractScale } from "./utils.js";

/**
 * ConfidentialTransferClient variant for orchestrators that need explicit
 * ownership of pending-balance application and transaction lifecycle.
 *
 * Backwards compatibility is preserved by keeping autoApplyPending=true by
 * default. CTS sets it to false so applyPending remains an explicit workload
 * action rather than being hidden inside deposit/transfer/withdraw helpers.
 */
export class ControlledConfidentialTransferClient extends ConfidentialTransferClient {
  constructor(rpcUrl, contractAddressOrChainId, chainId, options = {}) {
    const resolvedOptions =
      typeof chainId === "object" && chainId !== null ? chainId : options || {};

    super(rpcUrl, contractAddressOrChainId, chainId, options);
    this.autoApplyPending = resolvedOptions.autoApplyPending !== false;
  }

  async _applyPendingIfNeeded(wallet, privateKey, tokenAddress, actionLabel) {
    if (!this.autoApplyPending) return false;
    await super._applyPendingIfNeeded(wallet, privateKey, tokenAddress, actionLabel);
    return true;
  }

  /**
   * Submit account creation and return immediately after broadcast. The caller
   * owns receipt waiting and contract-state reconciliation.
   */
  async submitCreateAccount(wallet) {
    if (!wallet) throw new Error("Wallet is required");
    const address = await wallet.getAddress();
    const keys = await this._deriveKeys(wallet);
    const account = await this.getAccountInfo(address);
    if (account.exists) return { created: false, keys, tx: null, account };

    const tx = await this.contract
      .connect(wallet)
      .createConfidentialAccount(Buffer.from(keys.publicKey, "base64"));
    return { created: true, keys, tx, account };
  }

  /**
   * Submit a deposit without performing an implicit ERC-20 approval. This is
   * intentional for orchestrators: approval is a separate auditable operation.
   */
  async submitDeposit(wallet, tokenAddress, amount) {
    if (!wallet) throw new Error("Wallet is required");
    if (!ethers.isAddress(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) throw new Error("Amount must be greater than 0");

    const address = await wallet.getAddress();
    const token = this._getTokenContract(tokenAddress);
    const [decimals, balance, allowance] = await Promise.all([
      token.decimals(),
      token.balanceOf(address),
      token.allowance(address, this.config.contractAddress),
    ]);
    if (balance < rawAmount) {
      throw new Error(`Insufficient token balance. Required: ${rawAmount}, Available: ${balance}`);
    }
    if (allowance < rawAmount) {
      throw new Error(`Insufficient token allowance. Required: ${rawAmount}, Available: ${allowance}`);
    }

    const plainAmount = toContractScale(rawAmount, decimals);
    return await this.contract.connect(wallet).deposit(tokenAddress, plainAmount);
  }

  /** Submit a normal-to-normal confidential transfer after proof generation. */
  async submitTransfer(wallet, recipientAddress, tokenAddress, amount, options = {}) {
    if (!wallet) throw new Error("Sender wallet is required");
    if (!ethers.isAddress(recipientAddress)) throw new Error(`Invalid recipient address: ${recipientAddress}`);
    if (!ethers.isAddress(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) throw new Error("Transfer amount must be greater than 0");

    const offchainZKP = this._resolveOffchainZKP(options);
    const token = this._getTokenContract(tokenAddress);
    const tokenDecimals = await token.decimals();
    const transferAmount = toContractScale(rawAmount, tokenDecimals);
    const senderAddress = await wallet.getAddress();

    const [senderKeys, recipientAccount] = await Promise.all([
      this._deriveKeys(wallet),
      this.getAccountInfo(recipientAddress),
    ]);
    if (!senderKeys?.privateKey) throw new Error("Failed to derive sender keys");
    if (!recipientAccount.exists || !recipientAccount.finalized) {
      throw new Error(`Recipient account does not exist or is not finalized. Address: ${recipientAddress}`);
    }

    let recipientPublicKey = recipientAccount.elgamalPubkey;
    if (!recipientPublicKey) throw new Error("Recipient public key is required");
    if (typeof recipientPublicKey === "string" && recipientPublicKey.startsWith("0x")) {
      recipientPublicKey = Buffer.from(recipientPublicKey.slice(2), "hex").toString("base64");
    }

    const balance = await this.getConfidentialBalance(senderAddress, senderKeys.privateKey, tokenAddress);
    const available = balance.available.amount;
    if (!balance.available.ciphertext) throw new Error("Current balance ciphertext is required");
    if (available < rawAmount) {
      throw new Error(`Insufficient balance. Required: ${rawAmount}, Available: ${available}`);
    }

    const currentBalanceContractScale =
      (BigInt(available) * 100n) / 10n ** BigInt(tokenDecimals);
    const wasm = await this._getWasm();
    const proof = JSON.parse(
      wasm.generate_transfer_proof(
        JSON.stringify({
          current_balance_ciphertext: balance.available.ciphertext,
          current_balance: Number(currentBalanceContractScale),
          transfer_amount: Number(transferAmount),
          source_keypair: senderKeys.privateKey,
          destination_pubkey: recipientPublicKey,
        }),
      ),
    );
    if (!proof.success) {
      throw new Error(`Proof generation failed: ${proof.error || "Unknown error"}`);
    }

    const encodedProof = ethers.getBytes(encodeTransferProof(proof.data));
    const proofArg = await this._resolveContractProofArg(
      encodedProof,
      "transfer-proof.bin",
      offchainZKP,
    );
    const overrides = await this._prepareNonAnonymousTransferFee(wallet);
    return await this.contract
      .connect(wallet)
      .transferConfidential(recipientAddress, tokenAddress, proofArg, offchainZKP, overrides);
  }

  /** Submit an explicit applyPending transaction and return the tx response. */
  async submitApplyPending(wallet) {
    if (!wallet) throw new Error("Wallet is required");
    return await this.contract.connect(wallet).applyPending();
  }

  /** Submit a withdrawal after proof generation and return immediately. */
  async submitWithdraw(wallet, tokenAddress, amount, options = {}) {
    if (!wallet) throw new Error("Wallet is required");
    if (!ethers.isAddress(tokenAddress)) throw new Error(`Invalid token address: ${tokenAddress}`);
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) throw new Error("Withdrawal amount must be greater than 0");

    const offchainZKP = this._resolveOffchainZKP(options);
    const token = this._getTokenContract(tokenAddress);
    const tokenDecimals = await token.decimals();
    const withdrawAmount = toContractScale(rawAmount, tokenDecimals);
    const keys = await this._deriveKeys(wallet);
    if (!keys?.privateKey) throw new Error("Failed to derive keys");

    const address = await wallet.getAddress();
    const balance = await this.getConfidentialBalance(address, keys.privateKey, tokenAddress);
    if (!balance.available.ciphertext) throw new Error("Current balance ciphertext is required");
    if (balance.available.amount < rawAmount) {
      throw new Error(`Insufficient balance. Required: ${rawAmount}, Available: ${balance.available.amount}`);
    }

    const currentBalanceContractScale =
      (BigInt(balance.available.amount) * 100n) / 10n ** BigInt(tokenDecimals);
    const account = await this.getAccountInfo(address);
    const txID = BigInt(account.txId ?? 0n);
    const wasm = await this._getWasm();
    const proof = JSON.parse(
      wasm.generate_withdraw_proof(
        JSON.stringify({
          current_balance_ciphertext: balance.available.ciphertext,
          current_balance: Number(currentBalanceContractScale),
          withdraw_amount: Number(withdrawAmount),
          keypair: keys.privateKey,
          nonce: Number(txID + 1n),
        }),
      ),
    );
    if (!proof.success) {
      throw new Error(`Withdrawal proof generation failed: ${proof.error || "Unknown error"}`);
    }

    const encodedProof = ethers.getBytes(encodeWithdrawProof(proof.data));
    const proofArg = await this._resolveContractProofArg(
      encodedProof,
      "withdraw-proof.bin",
      offchainZKP,
    );
    return await this.contract
      .connect(wallet)
      .withdraw(tokenAddress, withdrawAmount, proofArg, offchainZKP);
  }

  /**
   * Compatibility helper that keeps the older wait-for-receipt behavior.
   */
  async createAccount(wallet, options = {}) {
    const { waitForFinalization = true } = options;
    const submitted = await this.submitCreateAccount(wallet);
    if (!submitted.created) {
      let account = submitted.account;
      if (waitForFinalization && !account.finalized) {
        await this._waitForGlobalState(await wallet.getAddress(), "account creation");
        account = await this.getAccountInfo(await wallet.getAddress());
      }
      return { created: false, keys: submitted.keys, receipt: null, account };
    }

    const receipt = await submitted.tx.wait();
    if (!receipt || receipt.status === 0) throw new Error("Account creation transaction failed");
    if (waitForFinalization) {
      await this._waitForGlobalState(await wallet.getAddress(), "account creation");
    }
    const account = await this.getAccountInfo(await wallet.getAddress());
    return { created: true, keys: submitted.keys, receipt, account };
  }

  /** Public explicit applyPending entry point preserving receipt-wait behavior. */
  async applyPending(wallet, options = {}) {
    return await this._applyPending(wallet, options);
  }
}
