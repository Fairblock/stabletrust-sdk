import { ethers } from "ethers";
import dotenv from "dotenv";
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
dotenv.config();
const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.stable.xyz";
const EXPLORER_URL =
  process.env.EXPLORER_URL || "https://testnet.stablescan.xyz/tx/";
async function minimalFlow() {
  // 1. Setup Client & Wallets
  const client = new ConfidentialTransferClient(RPC_URL, 2201);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sender = new ethers.Wallet(process.env.SENDER_PRIVATE_KEY, provider);
  const recipient = new ethers.Wallet(
    process.env.RECIPIENT_PRIVATE_KEY,
    provider,
  );

  // 2. Initialize Confidential Accounts (View Keys)
  await client.ensureAccount(sender);
  await client.ensureAccount(recipient);

  const TOKEN = "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9";
  const amount = ethers.parseUnits("0.1", 2);
  let res;
  // 3. DEPOSIT: Move public ERC20 into the confidential contract
  res = await client.confidentialDeposit(sender, TOKEN, amount);
  console.log("Deposit TX Hash:", EXPLORER_URL + res.hash);
  // 4. TRANSFER: Privacy-preserving transfer (On-chain amount is hidden)
  // This moves funds from Sender's 'Available' to Recipient's 'Pending' balance
  res = await client.confidentialTransfer(
    sender,
    recipient.address,
    TOKEN,
    ethers.parseUnits("0.05", 2),
  );
  console.log("Transfer TX Hash:", EXPLORER_URL + res.hash);
  // 5. WITHDRAW: Convert confidential balance back to public ERC20
  res = await client.withdraw(recipient, TOKEN, ethers.parseUnits("0.05", 2));
  console.log("Withdraw TX Hash:", EXPLORER_URL + res.hash);
  console.log("Confidential flow complete.");
}

minimalFlow().catch((error) => {
  console.error("Error in minimal confidential flow:", error);
});
