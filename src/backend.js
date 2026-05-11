import axios from "axios";

const DEFAULT_API_BASE_URL = "https://stabletrust-backend-api.fairblock.network";

/**
 * POST /api/wallet-links — bind a wallet address to a Firebase UID
 */
export async function walletLink(userAddress, apiBaseUrl = DEFAULT_API_BASE_URL) {
  await axios.post(`${apiBaseUrl}/api/wallet-links`, {
    userAddress: userAddress.toLowerCase(),
  });
}

/**
 * POST /api/requests — create a request row
 */
export async function createRequest(requestData, apiBaseUrl = DEFAULT_API_BASE_URL) {
  await axios.post(`${apiBaseUrl}/api/requests`, requestData);
}
