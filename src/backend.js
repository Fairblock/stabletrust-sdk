import axios from "axios";

const DEFAULT_API_BASE_URL = "https://stabletrust-backend-api.fairblock.network";

// Bound each request-row POST. Callers await these,
// so without a timeout a slow/hung backend would stall the caller's transfer()
// even though the on-chain transfer already completed. On timeout axios rejects
// with ECONNABORTED, which _postRequest turns into a warning.
const REQUEST_TIMEOUT_MS = 5000;

export const CHAIN_KEY_BY_ID = {
  2201: "stable",
  5042002: "arc",
  84532: "baseSepolia",
  11155111: "ethereumSepolia",
  421614: "arbitrumSepolia",
  42431: "tempo",
  42161: "arbitrumOne",
};

/**
 * POST /api/requests — create a request row
 */
export async function createRequest(requestData, apiBaseUrl = DEFAULT_API_BASE_URL) {
  await axios.post(`${apiBaseUrl}/api/requests`, requestData, {
    timeout: REQUEST_TIMEOUT_MS,
  });
}
