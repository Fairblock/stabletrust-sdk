import { ConfidentialTransferClient } from "./confidential-client.js";

/**
 * ConfidentialTransferClient variant for orchestrators that need explicit
 * ownership of pending-balance application.
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
   * Public explicit applyPending entry point.
   */
  async applyPending(wallet, options = {}) {
    return await this._applyPending(wallet, options);
  }
}
