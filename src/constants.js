/**
 * Contract ABIs and Constants
 */

export const PREDICATE_ATTESTATION_SIGNATURE =
  "(string,uint256,address,bytes)";
const PREDICATE_ATTESTATION_ABI =
  "(string uuid,uint256 expiration,address attester,bytes signature) attestation";

export const CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE =
  `createConfidentialAccount(bytes,${PREDICATE_ATTESTATION_SIGNATURE})`;
export const DEPOSIT_SIGNATURE =
  `deposit(address,uint256,${PREDICATE_ATTESTATION_SIGNATURE})`;
const GET_ACCOUNT_CORE_SIGNATURE = "getAccountCore(address)";
const GET_AVAILABLE_SIGNATURE = "getAvailable(address,address)";
const GET_PENDING_SIGNATURE = "getPending(address,address)";
export const APPLY_PENDING_SIGNATURE =
  `applyPending(${PREDICATE_ATTESTATION_SIGNATURE})`;

export const TRANSFER_CONFIDENTIAL_SIGNATURE =
  `transferConfidential(address,address,bytes,bool,${PREDICATE_ATTESTATION_SIGNATURE})`;
export const WITHDRAW_CONFIDENTIAL_SIGNATURE =
  `withdraw(address,uint256,bytes,bool,${PREDICATE_ATTESTATION_SIGNATURE})`;
export const FEE_TOKEN_SIGNATURE = "feeToken()";
export const FEE_ACCOUNT_SIGNATURE = "feeAccount()";
export const NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE = "nonAnonymousTransferFee()";
export const NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE = "nonAnonymousWithdrawFee()";
export const NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE = "nonAnonymousWithdrawFeePpm()";
export const ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE = "anonymousIpfsTransferFee()";
export const ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE = "anonymousInlineTransferFee()";
export const ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE = "anonymousWithdrawFeePpm()";

export const CONTRACT_ABI = [
  `function createConfidentialAccount(bytes elgamalPubkey,${PREDICATE_ATTESTATION_ABI}) external`,
  `function deposit(address token,uint256 plainAmount,${PREDICATE_ATTESTATION_ABI}) external`,
  `function ${GET_ACCOUNT_CORE_SIGNATURE} external view returns ((bool exists, bool finalized, bool pendingAction, uint256 txId, bytes elgamalPubkey, uint64 pendingCreditCounter))`,
  `function ${GET_AVAILABLE_SIGNATURE} external view returns (bytes c1, bytes c2)`,
  `function ${GET_PENDING_SIGNATURE} external view returns (bytes c1, bytes c2)`,
  `function transferConfidential(address recipient,address token,bytes proof,bool offchainZKP,${PREDICATE_ATTESTATION_ABI}) external payable`,
  `function withdraw(address token,uint256 plainAmount,bytes proof,bool offchainZKP,${PREDICATE_ATTESTATION_ABI}) external payable`,
  `function applyPending(${PREDICATE_ATTESTATION_ABI}) external`,
  `function ${FEE_TOKEN_SIGNATURE} external view returns (address)`,
  `function ${FEE_ACCOUNT_SIGNATURE} external view returns (address)`,
  `function ${NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE} external view returns (uint256)`,
  `function ${NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE} external view returns (uint256)`,
  `function ${NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE} external view returns (uint256)`,
  `function ${ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE} external view returns (uint256)`,
  `function ${ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE} external view returns (uint256)`,
  `function ${ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE} external view returns (uint256)`,

  // Current ConfidentialMirror Diamond events. ResultCode is a Solidity enum
  // and therefore appears as uint8 in the ABI.
  "event CreateAccountRequested(address indexed ownerAddr, uint256 indexed txId, bytes elgamalPubkey)",
  "event CreateAccountProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, uint8 code, bytes elgamalPubkey)",
  "event DepositRequested(address indexed ownerAddr, uint256 indexed txId, address indexed token, uint256 plainAmount, bytes availableC1, bytes availableC2)",
  "event DepositProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, uint8 code, address token, bytes newAvailC1, bytes newAvailC2, uint64 pendingCreditCounter)",
  "event TransferRequested(address indexed sender, address indexed recipient, uint256 indexed txId, address token, bytes proof, bytes senderPubkey, bytes recipientPubkey, bytes senderCurrC1, bytes senderCurrC2, bool offchainZKP)",
  "event TransferProcessed(address indexed sender, address indexed recipient, uint256 indexed txId, bool ok, uint8 code, address token, bytes senderNewAvailC1, bytes senderNewAvailC2, bytes recipientNewPendingC1, bytes recipientNewPendingC2, uint64 senderPendingCreditCounter, uint64 recipientPendingCreditCounter)",
  "event ApplyPendingRequested(address indexed ownerAddr, uint256 indexed txId)",
  "event ApplyPendingProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, uint8 code, address[] tokens, bytes[] newAvailC1, bytes[] newAvailC2, uint64 pendingCreditCounter)",
  "event WithdrawRequested(address indexed ownerAddr, uint256 indexed txId, address token, uint256 plainAmount, bytes proof, bytes userPubkey, bytes userCurrC1, bytes userCurrC2, bool offchainZKP)",
  "event WithdrawProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, uint8 code, address token, uint256 plainAmount, bytes newAvailC1, bytes newAvailC2, uint64 pendingCreditCounter)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

export const TEMPO_FEE_TOKEN_ADDRESS =
  "0x20c0000000000000000000000000000000000000";
export const STABLETRUST_CONTRACTS_BY_CHAIN_ID = Object.freeze({
  2201: "0x0b6791C168ffBF52e82F5E862929Dbf505c3A46E", //Stable
  5042002: "0xA90621B79d49c8E3A5eeEBcaaa839E2f886240C5", //Arc
  84532: "0xb6cdAE7ccfEE03e351694c63436D5c5c073aEF84", //Base
  11155111: "0x5A061604A1d94f4fa9939544707f6B200d6bB5cf", //Ethereum
  421614: "0x147C6D8cA1a4784Ed76d98b0E3CcA41C38a49A5f", //Arbitrum Sepolia
  42431: "0xE559fB936C69c46E216bf61B07C16bF1a6d444aa", //Tempo
  42161: "0xCAA6384D5Ac8b9111D482dd676BB890f2b6e9513", //Arbitrum One (mainnet)
});

export function getStabletrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
