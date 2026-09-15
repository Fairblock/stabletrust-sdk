import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
  DEPOSIT_SIGNATURE,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  APPLY_PENDING_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  FEE_ACCOUNT_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
} from "../src/constants.js";

const iface = new ethers.Interface(CONTRACT_ABI);
const requiredSignatures = [
  CREATE_CONFIDENTIAL_ACCOUNT_SIGNATURE,
  DEPOSIT_SIGNATURE,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  APPLY_PENDING_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
  FEE_TOKEN_SIGNATURE,
  FEE_ACCOUNT_SIGNATURE,
  NON_ANONYMOUS_TRANSFER_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_SIGNATURE,
  NON_ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
  ANONYMOUS_IPFS_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_INLINE_TRANSFER_FEE_SIGNATURE,
  ANONYMOUS_WITHDRAW_FEE_PPM_SIGNATURE,
];

for (const signature of requiredSignatures) {
  const fragment = iface.getFunction(signature);
  if (!fragment) throw new Error(`Missing ABI fragment: ${signature}`);
  console.log(`${signature} -> ${fragment.selector}`);
}

if (iface.getFunction(WITHDRAW_CONFIDENTIAL_SIGNATURE).stateMutability !== "payable") {
  throw new Error(`${WITHDRAW_CONFIDENTIAL_SIGNATURE} must be payable for native fixed fees`);
}

for (const legacySignature of [
  "createConfidentialAccount(bytes)",
  "deposit(address,uint256)",
  "transferConfidential(address,address,bytes,bool)",
  "applyPending()",
  "withdraw(address,uint256,bytes,bool)",
]) {
  if (iface.getFunction(legacySignature)) {
    throw new Error(`Legacy ABI fragment must not be present: ${legacySignature}`);
  }
}

if (iface.getFunction("feeAmount()")) {
  throw new Error("Legacy feeAmount() ABI fragment must not be present");
}

console.log("Contract ABI check passed.");
