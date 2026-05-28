/**
 * Contract ABIs and Constants
 */

export const CONTRACT_ABI = [
  "function createConfidentialAccount(bytes elgamalPubkey) external",
  "function deposit(address token, uint256 plainAmount) external",
  "function getAccountCore(address ownerAddr) external view returns ((bool exists, bool finalized, bool pendingAction, uint256 txId, bytes elgamalPubkey, uint64 pendingCreditCounter))",
  "function getAvailable(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function getPending(address ownerAddr, address token) external view returns (bytes c1, bytes c2)",
  "function transferConfidential(address recipient, address token, bytes proof) external payable",
  "function withdraw(address token, uint256 plainAmount, bytes proof) external",
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
  2201: "0xA98e5ba75Bb44459916D52Abf1604caB3d98CC4B", //Stable
  5042002: "0xdCF31bd9f325C34E0fb346b1975E141D99AEf731", //Arc
  84532: "0xF66A0a1670F14AE5D1852B4E7d1e4C693b2Accfd", //Base
  11155111: "0xa066b5C30382110d19925108BBa1Eef613a3A041", //Ethereum
  421614: "0xbda65d65A7833D28F9391FF01d0b212B75538Cf2", //Arbitrum
  42431: "0xE559fB936C69c46E216bf61B07C16bF1a6d444aa", //Tempo
});

export function getStabletrustContractAddress(chainId) {
  return STABLETRUST_CONTRACTS_BY_CHAIN_ID[Number(chainId)] || null;
}
