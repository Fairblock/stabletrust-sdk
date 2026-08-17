/**
 * Contract ABIs and Constants
 */

const CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE = "createConfidentialAccount(bytes)";
const DEPOSIT_SIGNATURE = "deposit(address,uint256)";
const GET_ACCOUNT_CORE_SIGNATURE = "getAccountCore(address)";
const GET_AVAILABLE_SIGNATURE = "getAvailable(address,address)";
const GET_PENDING_SIGNATURE = "getPending(address,address)";
const APPLY_PENDING_SIGNATURE = "applyPending()";

export const TRANSFER_CONFIDENTIAL_SIGNATURE = "transferConfidential(address,address,bytes,bool)";
export const WITHDRAW_CONFIDENTIAL_SIGNATURE = "withdraw(address,uint256,bytes,bool)";
export const FEE_TOKEN_SIGNATURE = "feeToken()";
export const FEE_ACCOUNT_SIGNATURE = "feeAccount()";
export const NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE = "nonAnonymousTransferFee()";
export const NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE = "nonAnonymousWithdrawFee()";
export const NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE = "nonAnonymousWithdrawFeePpm()";
export const ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE = "anonymousIpfsTransferFee()";
export const ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE = "anonymousInlineTransferFee()";
export const ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE = "anonymousWithdrawFeePpm()";

export const CONTRACT_ABI = [
  `function ${CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE} external`,
  `function ${DEPOSIT_SIGNATURE} external`,
  `function ${GET_ACCOUNT_CORE_SIGNATURE} external view returns ((bool exists, bool finalized, bool pendingAction, uint256 txId, bytes elgamalPubkey, uint64 pendingCreditCounter))`,
  `function ${GET_AVAILABLE_SIGNATURE} external view returns (bytes c1, bytes c2)`,
  `function ${GET_PENDING_SIGNATURE} external view returns (bytes c1, bytes c2)`,
  `function ${TRANSFER_CONFIDENTIAL_SIGNATURE} external payable`,
  `function ${WITHDRAW_CONFIDENTIAL_SIGNATURE} external payable`,
  `function ${APPLY_PENDING_SIGNATURE} external`,
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
  2201: "0xe1c1456CAb802312759a8cFc3976f88bf87082cf", //Stable
  5042002: "0x1B4f05f67CC33788Da4C89a7cd0b2f8E0055E605", //Arc
  84532: "0x4a251C9D79faCa20b193630A4ee313af7cBCDD93", //Base
  11155111: "0x7507a13352AFAa79D33E994f86f2f62463ba8DE4", //Ethereum
  421614: "0x5acECCdeb5CbD3C727eCB49F8706Eb80EF2f977F", //Arbitrum
  42431: "0xE559fB936C69c46E216bf61B07C16bF1a6d444aa", //Tempo
});

export function getStabletrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
