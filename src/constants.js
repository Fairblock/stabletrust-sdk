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
];

export const TEMPO_FEE_TOKEN_ADDRESS =
  "0x20c0000000000000000000000000000000000000";

export const STABLETRUST_CONTRACTS_BY_CHAIN_ID = Object.freeze({
  2201: "0x29E4fd434758b1677c10854Fa81C2fc496D76E62",
  1244: "0xf085e801a6FD9d03b09566a738734B7e2Bb065De",
  84532: "0x6FE45A71F5232a4E5e583Ae31A538360fB1e6aDb",
  11155111: "0x81a2c161c0327464430658516eE74A669feFC7bC",
  421614: "0xa59462200F6E438c538b914eB5F980B3Fa723aA0",
  42431: "0xB7bdce025c8a25e341Cb55795f8ba865AB3e392C",
});

export function getStableTrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
