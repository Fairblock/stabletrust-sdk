import { ethers } from "ethers";

const PREDICATE_BUSINESS_ARG_COUNTS = Object.freeze({
  createConfidentialAccount: 1,
  deposit: 2,
  transferConfidential: 4,
  applyPending: 0,
  withdraw: 4,
});

const METHOD_HELPERS = [
  "estimateGas",
  "populateTransaction",
  "send",
  "staticCall",
  "staticCallResult",
];

const PREDICATE_WRAPPED = Symbol("stabletrust.predicateWrappedContract");

/**
 * Empty Predicate attestation used while on-chain Predicate enforcement is off.
 * A fresh array is returned for each call so callers/ethers never share mutable
 * tuple state between transactions.
 */
export function emptyPredicateAttestation() {
  return ["", 0n, ethers.ZeroAddress, "0x"];
}

export function isPredicateAttestation(value) {
  if (Array.isArray(value)) return value.length === 4;
  if (!value || typeof value !== "object") return false;
  return (
    "uuid" in value &&
    "expiration" in value &&
    "attester" in value &&
    "signature" in value
  );
}

/**
 * Convert the pre-Predicate SDK call shape into the upgraded Diamond call shape.
 * Existing SDK methods may optionally append an ethers transaction-overrides
 * object, so the attestation must be inserted immediately before overrides.
 *
 * Calls that already contain an explicit attestation are left unchanged. This
 * makes the wrapped contract usable directly by applications that obtain a real
 * Predicate attestation later.
 */
export function injectPredicateAttestation(methodName, args) {
  const businessArgCount = PREDICATE_BUSINESS_ARG_COUNTS[methodName];
  if (businessArgCount === undefined) return args;

  if (args.length === businessArgCount) {
    return [...args, emptyPredicateAttestation()];
  }

  if (args.length === businessArgCount + 1) {
    if (isPredicateAttestation(args[businessArgCount])) {
      return args;
    }
    return [
      ...args.slice(0, businessArgCount),
      emptyPredicateAttestation(),
      args[businessArgCount],
    ];
  }

  if (
    args.length === businessArgCount + 2 &&
    isPredicateAttestation(args[businessArgCount])
  ) {
    return args;
  }

  // Let ethers surface its normal argument-count/type error for malformed calls.
  return args;
}

function wrapPredicateMethod(methodName, method) {
  const wrapped = (...args) =>
    method(...injectPredicateAttestation(methodName, args));

  for (const helperName of METHOD_HELPERS) {
    const helper = method?.[helperName];
    if (typeof helper === "function") {
      wrapped[helperName] = (...args) =>
        helper(...injectPredicateAttestation(methodName, args));
    }
  }

  return wrapped;
}

/**
 * Wrap an ethers Contract so the SDK's existing high-level methods keep their
 * public API while targeting the upgraded Attestation-bearing selectors.
 *
 * `connect()` is wrapped recursively because every state-changing SDK path uses
 * `this.contract.connect(wallet)` before invoking the contract.
 */
export function wrapPredicateContract(contract) {
  if (!contract || contract[PREDICATE_WRAPPED]) return contract;

  return new Proxy(contract, {
    get(target, prop) {
      if (prop === PREDICATE_WRAPPED) return true;

      if (prop === "connect") {
        return (runner) => wrapPredicateContract(target.connect(runner));
      }

      if (
        typeof prop === "string" &&
        Object.prototype.hasOwnProperty.call(PREDICATE_BUSINESS_ARG_COUNTS, prop)
      ) {
        const method = target[prop];
        if (typeof method === "function") {
          return wrapPredicateMethod(prop, method);
        }
      }

      return Reflect.get(target, prop, target);
    },
  });
}
