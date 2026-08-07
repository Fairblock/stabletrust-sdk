import { ConfidentialTransferClient } from "./confidential-client.js";

/**
 * ConfidentialTransferClient variant for orchestrators that need explicit
 * ownership of pending-balance application and transaction receipts.
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
    if (!this.autoApplyPending) {
      return false;
    }

    await super._applyPendingIfNeeded(
      wallet,
      privateKey,
      tokenAddress,
      actionLabel,
    );
    return true;
  }

  /**
   * Create a normal confidential account while returning the EVM receipt.
   * `ensureAccount()` intentionally returns only the ElGamal keys; long-running
   * orchestrators also need the transaction hash so they can persist it as soon
   * as the request is mined and reconcile later contract processing separately.
   */
  async createAccount(wallet, options = {}) {
    const { waitForFinalization = true } = options;
    if (!wallet) throw new Error("Wallet is required");

    const address = await wallet.getAddress();
    const keys = await this._deriveKeys(wallet);
    let account = await this.getAccountInfo(address);

    if (account.exists) {
      if (waitForFinalization && !account.finalized) {
        await this._waitForGlobalState(address, "account creation");
        account = await this.getAccountInfo(address);
      }
      return { created: false, keys, receipt: null, account };
    }

    const tx = await this.contract
      .connect(wallet)
      .createConfidentialAccount(Buffer.from(keys.publicKey, "base64"));
    const receipt = await tx.wait();
    if (!receipt || receipt.status === 0) {
      throw new Error("Account creation transaction failed");
    }

    if (waitForFinalization) {
      await this._waitForGlobalState(address, "account creation");
    }
    account = await this.getAccountInfo(address);

    return { created: true, keys, receipt, account };
  }

  /** Public explicit applyPending entry point. */
  async applyPending(wallet, options = {}) {
    return await this._applyPending(wallet, options);
  }
}
