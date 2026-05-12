import axios from "axios";

const DEFAULT_API_BASE_URL = "https://stabletrust-backend-api.fairblock.network";

export const CHAIN_KEY_BY_ID = {
  2201: "stable",
  1244: "arc",
  84532: "baseSepolia",
  11155111: "ethereumSepolia",
  421614: "arbitrumSepolia",
  42431: "tempo",
};

/**
 * POST /api/requests — create a request row
 */
export async function createRequest(requestData, apiBaseUrl = DEFAULT_API_BASE_URL) {
  await axios.post(`${apiBaseUrl}/api/requests`, requestData);
}
