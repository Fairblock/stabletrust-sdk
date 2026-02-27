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
  2201: "0xB96aa42b246a956B170fE426A72fB610E4976f9E", //Stable
  1244: "0xb20aB54e1c6AE55B0DD11FEB7FFf3fF1E9631f19", //Arc
  84532: "0x962a8A7CD28BfFBb17C4F6Ec388782cca3ffd618", //Base
  11155111: "0x2E48F3D9b8F4aCA9E6AF0630eaB2ceB7A3f5eEd1", //Ethereum
  421614: "0x14Afd604971bee5b5fac52df2d56CaE421519Cc5", //Arbitrum
  42431: "0x08B6563C95dfe3a4F5533CAA6F7D55a74FCb4F6c", //Tempo
});

export function getStableTrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
