/// <reference path="./index.d.ts" />

declare module "@fairblock/stabletrust" {
  export interface WithdrawalFeeQuote {
    /** Gross withdrawn-token amount after the SDK's 2-decimal contract-scale normalization. */
    grossAmount: bigint;
    /** Fixed request fee, charged even if the later callback fails. */
    fixedFee: bigint;
    /** Token used for the fixed request fee. ethers.ZeroAddress means native currency. */
    fixedFeeToken: string;
    /** Success-only withdrawal percentage fee rate, in parts per million. */
    percentageFeePpm: bigint;
    /** Estimated success-only percentage fee, denominated in the withdrawn token. */
    estimatedPercentageFee: bigint;
    /** Token being withdrawn. */
    withdrawalToken: string;
    /** Estimated amount delivered on a successful callback. */
    estimatedNetAmount: bigint;
  }

  export interface AnonymousWithdrawalQuoteOptions {
    /** Selects the IPFS/offchainZKP fixed withdrawal fee when true; inline fee otherwise. */
    offchainZKP?: boolean;
  }

  export interface ConfidentialTransferClient {
    /** Get the global fee recipient. */
    getFeeAccount(): Promise<string>;
    /** Get the fixed non-anonymous withdrawal request fee. */
    getNonAnonymousWithdrawFee(): Promise<bigint>;
    /** Get the success-only non-anonymous withdrawal rate in PPM. */
    getNonAnonymousWithdrawFeePpm(): Promise<bigint>;
    /** Get the shared anonymous success-only withdrawal rate in PPM. */
    getAnonymousWithdrawFeePpm(): Promise<bigint>;
    /** Quote fixed and percentage fees for a non-anonymous withdrawal. */
    getWithdrawalFeeQuote(
      tokenAddress: string,
      amount: bigint | string | number,
    ): Promise<WithdrawalFeeQuote>;
  }

  export interface ControlledConfidentialTransferClient {
    /** Get the global fee recipient. */
    getFeeAccount(): Promise<string>;
    /** Get the fixed non-anonymous withdrawal request fee. */
    getNonAnonymousWithdrawFee(): Promise<bigint>;
    /** Get the success-only non-anonymous withdrawal rate in PPM. */
    getNonAnonymousWithdrawFeePpm(): Promise<bigint>;
    /** Get the shared anonymous success-only withdrawal rate in PPM. */
    getAnonymousWithdrawFeePpm(): Promise<bigint>;
    /** Quote fixed and percentage fees for a non-anonymous withdrawal. */
    getWithdrawalFeeQuote(
      tokenAddress: string,
      amount: bigint | string | number,
    ): Promise<WithdrawalFeeQuote>;
  }

  export interface AnonymousTransferClient {
    /** Get the global fee recipient through Fairycloak. */
    getFeeAccount(): Promise<string>;
    /** Get the fixed non-anonymous withdrawal request fee through Fairycloak. */
    getNonAnonymousWithdrawFee(): Promise<bigint>;
    /** Get the non-anonymous success-only withdrawal rate in PPM through Fairycloak. */
    getNonAnonymousWithdrawFeePpm(): Promise<bigint>;
    /** Get the shared anonymous success-only withdrawal rate in PPM through Fairycloak. */
    getAnonymousWithdrawFeePpm(): Promise<bigint>;
    /**
     * Quote an anonymous withdrawal. The fixed fee is the path-specific prepaid
     * request fee; the percentage fee is success-only and comes from the withdrawn token.
     */
    getAnonymousWithdrawalFeeQuote(
      tokenAddress: string,
      amount: bigint | string | number,
      options?: AnonymousWithdrawalQuoteOptions,
    ): Promise<WithdrawalFeeQuote>;
  }

  export const WITHDRAW_FEE_PPM_DENOMINATOR: bigint;
  export const FEE_ACCOUNT_SIGNATURE: string;
  export const NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE: string;
  export const NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE: string;
  export const ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE: string;
}
