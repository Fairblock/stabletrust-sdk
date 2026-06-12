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
