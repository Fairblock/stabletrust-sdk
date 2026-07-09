import { ethers } from "ethers";
import {
  CONTRACT_ABI,
  TRANSFER_CONFIDENTIAL_SIGNATURE,
  WITHDRAW_CONFIDENTIAL_SIGNATURE,
} from "../src/constants.js";

const iface = new ethers.Interface(CONTRACT_ABI);
for (const signature of [TRANSFER_CONFIDENTIAL_SIGNATURE, WITHDRAW_CONFIDENTIAL_SIGNATURE]) {
  const fragment = iface.getFunction(signature);
  if (!fragment) throw new Error(`Missing ABI fragment: ${signature}`);
  console.log(`${signature} -> ${fragment.selector}`);
}
console.log("Contract ABI check passed.");
