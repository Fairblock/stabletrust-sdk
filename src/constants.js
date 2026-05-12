/**
 * Contract ABIs and Constants
 */

export const CONTRACT_ABI = [
  "function createConfidentialAccount(bytes elgamalPubkey) external",
  "function deposit(address token, uint256 plainAmount) external",
  "function getAccountCore(address ownerAddr) external view returns ((bool exists, bool finalized, bool hasPendingAction, uint256 lastUpdate, bytes pubkey, bytes availableC1, bytes availableC2, uint64 nonce, uint64 lastProcessedNonce))",
  "function getPendingAction(address ownerAddr) external view returns ((uint8 kind, address owner, uint256 txId, address token, address recipient, uint256 amount, uint256 feePaid, bool useOffchainVerify, bytes data))",
  "function getAvailable(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function getPending(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function transferConfidential(address recipient, address token, bytes proof, bool useOffchainVerify) external payable",
  "function withdraw(address token, uint256 plainAmount, bytes proof, bool useOffchainVerify) external",
  "function applyPending() external",
  "function feeToken() external view returns (address)",
  "function feeAmount() external view returns (uint256)",
  // Events
  "event CreateAccountRequested(address indexed ownerAddr, uint256 indexed txId, bytes elgamalPubkey)",
  "event CreateAccountProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, string errorMsg, bytes elgamalPubkey)",
  "event DepositRequested(address indexed ownerAddr, uint256 indexed txId, address indexed token, uint256 plainAmount, bytes availableShare, bytes pendingShare)",
  "event DepositProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, string errorMsg, address token, bytes newAvailC1, bytes newAvailC2, uint64 pendingCreditCounter, uint64 minimumPendingCreditCounter, bytes availableShare, bytes pendingShare)",
  "event TransferRequested(address indexed sender, address indexed recipient, uint256 indexed txId, address token, bytes proof, uint256 feePaid, bool useOffchainVerify, bytes senderPubkey, bytes recipientPubkey, bytes senderCurrC1, bytes senderCurrC2)",
  "event TransferProcessed(address indexed sender, address indexed recipient, uint256 indexed txId, bool ok, string errorMsg, address token, bytes senderNewAvailC1, bytes senderNewAvailC2, bytes recipientNewPendingC1, bytes recipientNewPendingC2, uint64 senderPendingCreditCounter, bytes senderAvailableShare, uint64 recipientPendingCreditCounter, uint64 recipientMinimumPendingCreditCounter, bytes recipientPendingShare)",
  "event ApplyPendingRequested(address indexed ownerAddr, uint256 indexed txId)",
  "event ApplyPendingProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, string errorMsg, address[] tokens, bytes[] newAvailC1, bytes[] newAvailC2, uint64 pendingCreditCounter, uint64 minimumPendingCreditCounter, bytes availableShare)",
  "event WithdrawRequested(address indexed ownerAddr, uint256 indexed txId, address token, uint256 plainAmount, bytes proof, bool useOffchainVerify, bytes userPubkey, bytes userCurrC1, bytes userCurrC2)",
  "event WithdrawProcessed(address indexed ownerAddr, uint256 indexed txId, bool ok, string errorMsg, address token, uint256 plainAmount, bytes newAvailC1, bytes newAvailC2, uint64 pendingCreditCounter, uint64 minimumPendingCreditCounter, bytes availableShare)",
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
  2201: "0xdf43bC80B5b22A858860947d383b6F4d6C81d8EC", //Stable
  1244: "0x5d43CE5269Cd46badC67B3664369862F20eC5649", //Arc
  84532: "0xFBEa2AbCf1208E09dd90266fE94Fb76d8BfC34d9", //Base
  11155111: "0x72B87207791996F416D2F3B0dcAcbb07F445C496", //Ethereum
  421614: "0x6C9eDBDd028Fe610b054187A34712714E341D112", //Arbitrum
  42431: "0xE559fB936C69c46E216bf61B07C16bF1a6d444aa", //Tempo
});

export function getStableTrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
