import { ethers } from "ethers";
import dotenv from "dotenv";
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
dotenv.config();
const RPC_URL =
  process.env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const EXPLORER_URL =
  process.env.EXPLORER_URL || "https://sepolia.arbiscan.io/tx/";
async function minimalFlow() {
  // 1. Setup Client & Wallets
  const client = new ConfidentialTransferClient(
    RPC_URL,
    "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E",
    421614,
  );

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sender = new ethers.Wallet(process.env.SENDER_PRIVATE_KEY, provider);
  const recipient = new ethers.Wallet(
    process.env.RECIPIENT_PRIVATE_KEY,
    provider,
  );

  // 2. Initialize Confidential Accounts (View Keys)
  await client.ensureAccount(sender);
  await client.ensureAccount(recipient);

  const TOKEN = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const amount = ethers.parseUnits("0.001", 6);
  let res;
  // 3. DEPOSIT: Move public ERC20 into the confidential contract
  res = await client.deposit(sender, TOKEN, amount);
  console.log("Deposit TX Hash:", EXPLORER_URL + res.hash);
  // 4. TRANSFER: Privacy-preserving transfer (On-chain amount is hidden)
  // This moves funds from Sender's 'Available' to Recipient's 'Pending' balance
  res = await client.transfer(sender, recipient.address, TOKEN, amount / 2n);
  console.log("Transfer TX Hash:", EXPLORER_URL + res.hash);
  // 5. SETTLE: Recipient claims pending transfers into their available balance
  res = await client.applyPending(recipient);
  console.log("Settle TX Hash:", EXPLORER_URL + res.hash);
  // 6. WITHDRAW: Convert confidential balance back to public ERC20
  res = await client.withdraw(recipient, TOKEN, amount / 4n);
  console.log("Withdraw TX Hash:", EXPLORER_URL + res.hash);
  console.log("Confidential flow complete.");
}

minimalFlow().catch((error) => {
  console.error("Error in minimal confidential flow:", error);
});
