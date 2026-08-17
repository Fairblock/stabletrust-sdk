import { ethers } from "ethers";
import { ConfidentialTransferClient as BaseConfidentialTransferClient } from "./confidential-client.js";
import { ControlledConfidentialTransferClient as BaseControlledConfidentialTransferClient } from "./controlled-confidential-client.js";
import { AnonymousTransferClient as BaseAnonymousTransferClient } from "./anonymous-client.js";
import { encodeWithdrawProof, toContractScale, validateAnonymousAccountId } from "./utils.js";
import {
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  FEE_ACCOUNT_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
} from "./constants.js";

export const WITHDRAW_FEE_PPM_DENOMINATOR = 1_000_000n;

function calculatePercentageFee(grossAmount, ppm) {
  const gross = BigInt(grossAmount);
  const rate = BigInt(ppm);
  if (rate < 0n || rate >= WITHDRAW_FEE_PPM_DENOMINATOR) {
    throw new Error(
      `Withdrawal fee PPM must be between 0 and ${WITHDRAW_FEE_PPM_DENOMINATOR - 1n}`,
    );
  }
  return (gross * rate) / WITHDRAW_FEE_PPM_DENOMINATOR;
}

function grossAfterContractScale(rawAmount, tokenDecimals) {
  const scaled = toContractScale(rawAmount, tokenDecimals);
  const divisor = 10n ** BigInt(tokenDecimals);
  return (scaled * divisor) / 100n;
}

const nonAnonymousFeeMethods = {
  _assertLatestContractAbi() {
    const requiredSignatures = [
      TRANSFER_CONFIDENTIAL_SIGNATURE,
      WITHDRAW_CONFIDENTIAL_SIGNATURE,
      FEE_TOKEN_SIGNATURE,
      FEE_ACCOUNT_SIGNATURE,
      NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
      NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
      NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
      ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
      ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
      ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
    ];

    const missingSignatures = requiredSignatures.filter(
      (signature) => !this.contract.interface.getFunction(signature),
    );
    if (missingSignatures.length > 0) {
      throw new Error(
        `Installed @fairblock/stabletrust ABI is stale or incomplete. Missing ${missingSignatures.join(", ")}. Reinstall/update the SDK.`,
      );
    }
  },

  async getFeeAccount() {
    try {
      return ethers.getAddress(await this.contract.feeAccount());
    } catch (error) {
      throw new Error(`Failed to get fee account: ${error.message}`);
    }
  },

  async getNonAnonymousWithdrawFee() {
    try {
      return await this.contract.nonAnonymousWithdrawFee();
    } catch (error) {
      throw new Error(`Failed to get non-anonymous withdrawal fixed fee: ${error.message}`);
    }
  },

  async getNonAnonymousWithdrawFeePpm() {
    try {
      return await this.contract.nonAnonymousWithdrawFeePpm();
    } catch (error) {
      throw new Error(`Failed to get non-anonymous withdrawal percentage fee: ${error.message}`);
    }
  },

  async getAnonymousWithdrawFeePpm() {
    try {
      return await this.contract.anonymousWithdrawFeePpm();
    } catch (error) {
      throw new Error(`Failed to get anonymous withdrawal percentage fee: ${error.message}`);
    }
  },

  async _prepareNonAnonymousWithdrawFee(wallet) {
    const [feeTokenRaw, feeAmountRaw] = await Promise.all([
      this.contract.feeToken(),
      this.contract.nonAnonymousWithdrawFee(),
    ]);

    const feeToken = ethers.getAddress(feeTokenRaw);
    const feeAmount = BigInt(feeAmountRaw);
    if (feeAmount === 0n) return { value: 0n };

    if (feeToken === ethers.ZeroAddress) {
      return { value: feeAmount };
    }

    const senderAddress = await wallet.getAddress();
    const feeTokenContract = this._getTokenContract(feeToken);
    const [balance, allowance] = await Promise.all([
      feeTokenContract.balanceOf(senderAddress),
      feeTokenContract.allowance(senderAddress, this.config.contractAddress),
    ]);

    if (balance < feeAmount) {
      throw new Error(
        `Insufficient withdrawal fee token balance. Required: ${feeAmount}, available: ${balance}, fee token: ${feeToken}`,
      );
    }

    if (allowance < feeAmount) {
      const approveTx = await feeTokenContract
        .connect(wallet)
        .approve(this.config.contractAddress, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (!approveReceipt || approveReceipt.status === 0) {
        throw new Error("Withdrawal fee token approval failed");
      }
    }

    return { value: 0n };
  },

  async getWithdrawalFeeQuote(tokenAddress, amount) {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) throw new Error("Withdrawal amount must be greater than 0");

    const token = this._getTokenContract(tokenAddress);
    const [tokenDecimals, fixedFee, fixedFeeToken, percentageFeePpm] = await Promise.all([
      token.decimals(),
      this.getNonAnonymousWithdrawFee(),
      this.getFeeToken(),
      this.getNonAnonymousWithdrawFeePpm(),
    ]);
    const grossAmount = grossAfterContractScale(rawAmount, tokenDecimals);
    const estimatedPercentageFee = calculatePercentageFee(grossAmount, percentageFeePpm);

    return {
      grossAmount,
      fixedFee: BigInt(fixedFee),
      fixedFeeToken,
      percentageFeePpm: BigInt(percentageFeePpm),
      estimatedPercentageFee,
      withdrawalToken: ethers.getAddress(tokenAddress),
      estimatedNetAmount: grossAmount - estimatedPercentageFee,
    };
  },
};

export class ConfidentialTransferClient extends BaseConfidentialTransferClient {
  _assertLatestContractAbi() {
    return nonAnonymousFeeMethods._assertLatestContractAbi.call(this);
  }
  getFeeAccount() { return nonAnonymousFeeMethods.getFeeAccount.call(this); }
  getNonAnonymousWithdrawFee() { return nonAnonymousFeeMethods.getNonAnonymousWithdrawFee.call(this); }
  getNonAnonymousWithdrawFeePpm() { return nonAnonymousFeeMethods.getNonAnonymousWithdrawFeePpm.call(this); }
  getAnonymousWithdrawFeePpm() { return nonAnonymousFeeMethods.getAnonymousWithdrawFeePpm.call(this); }
  _prepareNonAnonymousWithdrawFee(wallet) { return nonAnonymousFeeMethods._prepareNonAnonymousWithdrawFee.call(this, wallet); }
  getWithdrawalFeeQuote(tokenAddress, amount) { return nonAnonymousFeeMethods.getWithdrawalFeeQuote.call(this, tokenAddress, amount); }

  async withdraw(wallet, tokenAddress, amount, options = {}) {
    const { waitForFinalization = true } = options;
    const offchainZKP = this._resolveOffchainZKP(options);

    try {
      if (!wallet) throw new Error("Wallet is required");
      if (!tokenAddress || !ethers.isAddress(tokenAddress)) {
        throw new Error(`Invalid token address: ${tokenAddress}`);
      }
      if (!amount || BigInt(amount) <= 0n) {
        throw new Error("Withdrawal amount must be greater than 0");
      }

      const tokenContract = this._getTokenContract(tokenAddress);
      const tokenDecimals = await tokenContract.decimals();
      const withdrawAmount = toContractScale(amount, tokenDecimals);

      const derivedKeys = await this._deriveKeys(wallet);
      if (!derivedKeys?.privateKey) throw new Error("Failed to derive keys");

      const address = await wallet.getAddress();
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
        balanceSummary = await this.getConfidentialBalance(
          address,
          derivedKeys.privateKey,
          tokenAddress,
        );
      }

      const currentBalanceCiphertext = balanceSummary.available.ciphertext;
      const currentBalance = balanceSummary.available.amount;
      if (!currentBalanceCiphertext) {
        throw new Error("Current balance ciphertext is required. Did you call getConfidentialBalance()?");
      }
      if (balanceSummary.amount < BigInt(amount)) {
        throw new Error(`Insufficient balance. Required: ${amount}, Total: ${balanceSummary.amount}`);
      }
      if (currentBalance === undefined || currentBalance < BigInt(amount)) {
        throw new Error(`Insufficient balance. Required: ${amount}, Available: ${currentBalance}`);
      }

      const currentBalanceContractScale =
        (BigInt(currentBalance) * 100n) / 10n ** BigInt(tokenDecimals);
      const accountInfo = await this.getAccountInfo(address);
      const txId = BigInt(accountInfo.txId ?? 0n);

      const wasm = await this._getWasm();
      const proof = JSON.parse(
        wasm.generate_withdraw_proof(
          JSON.stringify({
            current_balance_ciphertext: currentBalanceCiphertext,
            current_balance: Number(currentBalanceContractScale),
            withdraw_amount: Number(withdrawAmount),
            keypair: derivedKeys.privateKey,
            nonce: Number(txId + 1n),
          }),
        ),
      );
      if (!proof.success) {
        throw new Error(
          `Withdrawal proof generation failed: ${proof.error || "Unknown error. Check your balance and amount."}`,
        );
      }

      const encodedProof = ethers.getBytes(encodeWithdrawProof(proof.data));
      const withdrawZkpArg = await this._resolveContractProofArg(
        encodedProof,
        "withdraw-proof.bin",
        offchainZKP,
      );
      const txOverrides = await this._prepareNonAnonymousWithdrawFee(wallet);

      const tx = await this.contract.connect(wallet).withdraw(
        tokenAddress,
        BigInt(withdrawAmount),
        withdrawZkpArg,
        offchainZKP,
        txOverrides,
      );
      const receipt = await tx.wait();
      if (!receipt || receipt.status === 0) throw new Error("Withdrawal transaction failed");

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
        message.includes("fee token balance") ||
        message.includes("proof generation failed")
      ) {
        throw error;
      }
      throw new Error(`Failed to withdraw: ${message}`);
    }
  }
}

export class ControlledConfidentialTransferClient extends BaseControlledConfidentialTransferClient {
  _assertLatestContractAbi() {
    return nonAnonymousFeeMethods._assertLatestContractAbi.call(this);
  }
  getFeeAccount() { return nonAnonymousFeeMethods.getFeeAccount.call(this); }
  getNonAnonymousWithdrawFee() { return nonAnonymousFeeMethods.getNonAnonymousWithdrawFee.call(this); }
  getNonAnonymousWithdrawFeePpm() { return nonAnonymousFeeMethods.getNonAnonymousWithdrawFeePpm.call(this); }
  getAnonymousWithdrawFeePpm() { return nonAnonymousFeeMethods.getAnonymousWithdrawFeePpm.call(this); }
  _prepareNonAnonymousWithdrawFee(wallet) { return nonAnonymousFeeMethods._prepareNonAnonymousWithdrawFee.call(this, wallet); }
  getWithdrawalFeeQuote(tokenAddress, amount) { return nonAnonymousFeeMethods.getWithdrawalFeeQuote.call(this, tokenAddress, amount); }

  async _submitWithGasSafety(contract, methodName, args = [], overrides = {}) {
    let resolvedOverrides = overrides;
    if (methodName === "withdraw" && overrides.value === undefined) {
      const feeOverrides = await this._prepareNonAnonymousWithdrawFee(contract.runner);
      resolvedOverrides = { ...feeOverrides, ...overrides };
    }
    return await super._submitWithGasSafety(
      contract,
      methodName,
      args,
      resolvedOverrides,
    );
  }
}

export class AnonymousTransferClient extends BaseAnonymousTransferClient {
  async getFeeAccount() {
    try {
      const data = await this._fetch("GET", "/v1/views/fee-account");
      const raw = data.result ?? data;
      const addr = typeof raw === "string" ? raw : raw.feeAccount ?? raw;
      return ethers.getAddress(addr);
    } catch (error) {
      throw new Error(`Failed to get fee account: ${error.message}`);
    }
  }

  async getNonAnonymousWithdrawFee() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/non-anonymous-withdraw-fixed");
      return BigInt(data.result ?? data);
    } catch (error) {
      throw new Error(`Failed to get non-anonymous withdrawal fixed fee: ${error.message}`);
    }
  }

  async getNonAnonymousWithdrawFeePpm() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/non-anonymous-withdraw-ppm");
      return BigInt(data.result ?? data);
    } catch (error) {
      throw new Error(`Failed to get non-anonymous withdrawal percentage fee: ${error.message}`);
    }
  }

  async getAnonymousWithdrawFeePpm() {
    try {
      const data = await this._fetch("GET", "/v1/views/fees/anonymous-withdraw-ppm");
      return BigInt(data.result ?? data);
    } catch (error) {
      throw new Error(`Failed to get anonymous withdrawal percentage fee: ${error.message}`);
    }
  }

  async _assertSufficientWithdrawPrepaidFees(accountId, offchainZKP) {
    validateAnonymousAccountId(accountId, "accountId");
    const fixedFeePromise = offchainZKP
      ? this.getAnonymousIpfsWithdrawFee()
      : this.getAnonymousInlineWithdrawFee();
    const [feeToken, fixedFee] = await Promise.all([
      this.getFeeToken(),
      fixedFeePromise,
    ]);
    if (fixedFee === 0n) return;

    const balance = await this.getPrepaidFeeBalance(accountId, feeToken);
    if (balance < fixedFee) {
      const path = offchainZKP ? "IPFS" : "inline";
      throw new Error(
        `Insufficient prepaid fee balance for anonymous account "${accountId}" (${path} withdrawal). ` +
          `Required: ${fixedFee} (raw units of fee token ${feeToken}), available: ${balance}. ` +
          `The success-only percentage withdrawal fee is not part of this prepaid requirement.`,
      );
    }
  }

  async getAnonymousWithdrawalFeeQuote(tokenAddress, amount, { offchainZKP = false } = {}) {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress}`);
    }
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) throw new Error("Withdrawal amount must be greater than 0");

    const fixedFeePromise = offchainZKP
      ? this.getAnonymousIpfsWithdrawFee()
      : this.getAnonymousInlineWithdrawFee();
    const [tokenDecimals, fixedFee, fixedFeeToken, percentageFeePpm] = await Promise.all([
      this._fetchTokenDecimals(tokenAddress),
      fixedFeePromise,
      this.getFeeToken(),
      this.getAnonymousWithdrawFeePpm(),
    ]);
    const grossAmount = grossAfterContractScale(rawAmount, tokenDecimals);
    const estimatedPercentageFee = calculatePercentageFee(grossAmount, percentageFeePpm);

    return {
      grossAmount,
      fixedFee: BigInt(fixedFee),
      fixedFeeToken,
      percentageFeePpm: BigInt(percentageFeePpm),
      estimatedPercentageFee,
      withdrawalToken: ethers.getAddress(tokenAddress),
      estimatedNetAmount: grossAmount - estimatedPercentageFee,
    };
  }

  async withdraw(authWallet, accountId, params, options = {}) {
    const offchainZKP = Boolean(params?.offchainZKP ?? false);
    await this._assertSufficientWithdrawPrepaidFees(accountId, offchainZKP);
    return await super.withdraw(authWallet, accountId, params, options);
  }
}
