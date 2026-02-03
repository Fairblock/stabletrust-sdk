import { ethers } from "ethers";
import dotenv from "dotenv";
import { ConfidentialTransferClient } from "@fairblock/stabletrust";

dotenv.config();

/**
 * ARCHITECTURE OVERVIEW:
 * For deep dive into the underlying architecture and the separation
 * of Pending and Available balances, visit:
 * https://docs.fairblock.network/docs/confidential_transfers/technical_overview
 */

// Currently configured for Arbitrum Sepolia confidential mirror contract.
// You can deploy your own confidential contract on any EVM network and use that.
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E";
// Standard ERC20 token contract. Any ERC20 on this chain ID can be used.
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const RPC_URL =
  process.env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const EXPLORER_URL =
  process.env.EXPLORER_URL || "https://sepolia.arbiscan.io/tx/";
const CHAIN_ID = process.env.CHAIN_ID || 421614;

/**
 * Performance Utility: Tracks execution time and provides timestamps
 */
async function trackPerformance(actionName, action) {
  const timestamp = new Date().toISOString();
  const start = performance.now();
  const result = await action();
  const end = performance.now();
  const duration = ((end - start) / 1000).toFixed(3);

  console.log(`Action: ${actionName}`);
  console.log(`Timestamp: ${timestamp}`);
  console.log(`Duration: ${duration}s`);
  return { result, duration };
}

async function main() {
  console.log("=== Starting Confidential Flow Performance Test ===\n");

  const client = new ConfidentialTransferClient({
    rpcUrl: RPC_URL,
    contractAddress: CONTRACT_ADDRESS,
    chainID: CHAIN_ID,
  });

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const sender = new ethers.Wallet(process.env.SENDER_PRIVATE_KEY, provider);
  const recipient = new ethers.Wallet(
    process.env.RECIPIENT_PRIVATE_KEY,
    provider,
  );

  console.log("Sender Address:", sender.address);
  console.log("Recipient Address:", recipient.address);

  const senderKeys = await client.ensureAccount(sender);
  const recipientKeys = await client.ensureAccount(recipient);

  // 1. DEPOSIT PHASE
  const depositAmount = ethers.parseUnits("0.001", 6);
  const senderAvailBeforeDep = await client.getBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  console.log(
    "Sender Available (Pre-Deposit):",
    ethers.formatUnits(senderAvailBeforeDep.amount, 6),
  );

  const depRes = await trackPerformance("DEPOSIT_TOKENS", () =>
    client.deposit(sender, TOKEN_ADDRESS, depositAmount),
  );
  // Fixed hash reference: checking for result.transactionHash or result.hash
  const depHash = depRes.result?.transactionHash || depRes.result?.hash;
  console.log(`Transaction Hash: ${depHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${depHash}`);

  const senderAvailAfterDep = await client.getBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  console.log(
    "Sender Available (Post-Deposit):",
    ethers.formatUnits(senderAvailAfterDep.amount, 6),
    "\n",
  );

  // 2. TRANSFER PHASE
  const transferAmount = ethers.parseUnits("0.0005", 6);
  const senderAvailBeforeTx = await client.getBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  const recipientPendBeforeTx = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "pending" },
  );

  console.log(
    "Sender Available (Pre-Transfer):",
    ethers.formatUnits(senderAvailBeforeTx.amount, 6),
  );
  console.log(
    "Recipient Pending (Pre-Transfer):",
    ethers.formatUnits(recipientPendBeforeTx.amount, 6),
  );

  // FIXED: Ensured all arguments are explicitly passed in the arrow function
  const txRes = await trackPerformance("CONFIDENTIAL_TRANSFER", () =>
    client.transfer(sender, recipient.address, TOKEN_ADDRESS, transferAmount),
  );

  const txHash = txRes.result?.transactionHash || txRes.result?.hash;
  console.log(
    "Status: Privacy shielding active. Transfer amount is hidden on-chain.",
  );
  console.log(`Transaction Hash: ${txHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${txHash}`);

  const senderAvailAfterTx = await client.getBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  const recipientPendAfterTx = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "pending" },
  );

  console.log(
    "Sender Available (Post-Transfer):",
    ethers.formatUnits(senderAvailAfterTx.amount, 6),
  );
  console.log(
    "Recipient Pending (Post-Transfer):",
    ethers.formatUnits(recipientPendAfterTx.amount, 6),
    "\n",
  );

  // 3. APPLY PENDING PHASE
  const recipientAvailBeforeApply = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  console.log(
    "Recipient Available (Pre-Apply):",
    ethers.formatUnits(recipientAvailBeforeApply.amount, 6),
  );

  const applyRes = await trackPerformance("APPLY_PENDING", () =>
    client.applyPending(recipient),
  );
  const applyHash = applyRes.result?.transactionHash || applyRes.result?.hash;
  console.log(`Transaction Hash: ${applyHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${applyHash}`);

  const recipientPendAfterApply = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "pending" },
  );
  const recipientAvailAfterApply = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );

  console.log(
    "Recipient Pending (Post-Apply):",
    ethers.formatUnits(recipientPendAfterApply.amount, 6),
  );
  console.log(
    "Recipient Available (Post-Apply):",
    ethers.formatUnits(recipientAvailAfterApply.amount, 6),
    "\n",
  );

  // 4. WITHDRAW PHASE
  const withdrawAmount = ethers.parseUnits("0.0003", 6);
  const withdrawRes = await trackPerformance("WITHDRAW_TOKENS", () =>
    client.withdraw(recipient, TOKEN_ADDRESS, withdrawAmount),
  );
  const withdrawHash =
    withdrawRes.result?.transactionHash || withdrawRes.result?.hash;
  console.log(`Transaction Hash: ${withdrawHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${withdrawHash}`);

  const recipientAvailAfterWithdraw = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  console.log(
    "Recipient Available (Final):",
    ethers.formatUnits(recipientAvailAfterWithdraw.amount, 6),
  );

  console.log("\n=== Complete Flow Execution Finished ===");
}

main().catch((error) => {
  console.error("Execution Error:", error);
  process.exit(1);
});
