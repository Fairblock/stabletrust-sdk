/**
 * Contract ABIs and Constants
 */

export const CONTRACT_ABI = [
  "function createConfidentialAccount(bytes elgamalPubkey) external",
  "function deposit(address token, uint256 plainAmount) external",
  "function getAccountCore(address ownerAddr) external view returns ((bool exists, bool finalized, bool hasPendingAction, uint256 lastUpdate, bytes pubkey, bytes availableC1, bytes availableC2, uint64 nonce, uint64 lastProcessedNonce))",
  "function getAvailable(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function getPending(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function transferConfidential(address recipient, address token, bytes proof, bool useOffchainVerify) external payable",
  "function withdraw(address token, uint256 plainAmount, bytes proof, bool useOffchainVerify) external",
  "function applyPending() external",
  "function feeAmount() external view returns (uint256)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
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

export function getStabletrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
