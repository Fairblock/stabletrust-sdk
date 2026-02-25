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
  2201: "0xb0b461aFA69b715d842c7fAb602f50D4cef83fe5", //Stable
  1244: "0xEa837218c7Ccd9eA1BCfB640e5c6aFE59952b4FA", //Arc
  84532: "0x1a06530765e942a1D26B74d9558e9a1EdA615867", //Base
  11155111: "0xABEa3399873b80f528Ee76286087b45ed38Fbf97", //Ethereum
  421614: "0x2131De660C6be8b535E6f17E171bFf7143E9E9F4", //Arbitrum
  42431: "0xF3525FF8F592883f8fA2d89EfBe85637955Df487", //Tempo
});

export function getStableTrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
