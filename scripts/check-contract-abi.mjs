import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
} from "../src/constants.js";

const iface = new ethers.Interface(CONTRACT_ABI);
const requiredSignatures = [
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
];

for (const signature of requiredSignatures) {
  const fragment = iface.getFunction(signature);
  if (!fragment) throw new Error(`Missing ABI fragment: ${signature}`);
  console.log(`${signature} -> ${fragment.selector}`);
}

if (iface.getFunction("feeAmount()")) {
  throw new Error("Legacy feeAmount() ABI fragment must not be present");
}

console.log("Contract ABI check passed.");
