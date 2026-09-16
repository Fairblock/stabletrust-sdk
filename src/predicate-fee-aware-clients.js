import {
  ConfidentialTransferClient as FeeAwareConfidentialTransferClient,
  ControlledConfidentialTransferClient as FeeAwareControlledConfidentialTransferClient,
  AnonymousTransferClient,
  WITHDRAW_FEE_PPM_DENOMINATOR,
} from "./fee-aware-clients.js";
import { wrapPredicateContract } from "./predicate-contract.js";

/**
 * Public non-anonymous clients target the upgraded ConfidentialMirror ABI.
 * Existing SDK methods still call the pre-Predicate argument shape internally;
 * the wrapped ethers Contract inserts an empty attestation while enforcement is
 * disabled, without changing the high-level SDK API.
 */
export class ConfidentialTransferClient extends FeeAwareConfidentialTransferClient {
  constructor(...args) {
    super(...args);
    this.contract = wrapPredicateContract(this.contract);
  }
}

export class ControlledConfidentialTransferClient extends FeeAwareControlledConfidentialTransferClient {
  constructor(...args) {
    super(...args);
    this.contract = wrapPredicateContract(this.contract);
  }
}

// Anonymous flows are intentionally not Predicate-gated and must remain
// byte-for-byte/API compatible with the existing anonymous client behavior.
export { AnonymousTransferClient, WITHDRAW_FEE_PPM_DENOMINATOR };
