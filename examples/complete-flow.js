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

// Optional override for custom confidential contract deployments.
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x29E4fd434758b1677c10854Fa81C2fc496D76E62";
// Standard ERC20 token contract. Any ERC20 on this chain ID can be used.
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS || "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9";
const RPC_URL =
  process.env.ETHEREUM_RPC_URL || "https://rpc.testnet.stable.xyz";
const EXPLORER_URL =
  process.env.EXPLORER_URL || "https://testnet.stablescan.xyz/tx/";
const CHAIN_ID = process.env.CHAIN_ID || 2201;

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

  const client = new ConfidentialTransferClient(
    RPC_URL,
    CONTRACT_ADDRESS,
    Number(CHAIN_ID),
  );

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
  const depositAmount = ethers.parseUnits("0.1", 2);
  const senderConfidentialBalanceBefore = await client.getConfidentialBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
  );

  console.log(
    "Sender Confidential Balance (Pre-Deposit):",
    ethers.formatUnits(senderConfidentialBalanceBefore.amount, 2),
  );

  console.log("Depositing 0.1 tokens into confidential contract...");

  const depRes = await trackPerformance("DEPOSIT_TOKENS", () =>
    client.confidentialDeposit(sender, TOKEN_ADDRESS, depositAmount),
  );
  // Fixed hash reference: checking for result.transactionHash or result.hash
  const depHash = depRes.result.hash;
  console.log(`Transaction Hash: ${depHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${depHash}`);

  const senderConfidentialBalanceAfterDep = await client.getConfidentialBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
  );
  console.log(
    "Sender Confidential Balance (Post-Deposit):",
    ethers.formatUnits(senderConfidentialBalanceAfterDep.amount, 2),
  );

  // 2. TRANSFER PHASE
  const transferAmount = ethers.parseUnits("0.05", 2);
  const senderConfidentialBalanceBeforeTx = await client.getConfidentialBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
  );

  const recipientConfidentialBalanceBeforeTx =
    await client.getConfidentialBalance(
      recipient.address,
      recipientKeys.privateKey,
      TOKEN_ADDRESS,
    );

  console.log(
    "Sender Confidential Balance (Pre-Transfer):",
    ethers.formatUnits(senderConfidentialBalanceBeforeTx.amount, 2),
  );
  console.log(
    "Recipient Confidential Balance (Pre-Transfer):",
    ethers.formatUnits(recipientConfidentialBalanceBeforeTx.amount, 2),
  );

  console.log("Transferring 0.05 tokens confidentially to recipient...");

  // FIXED: Ensured all arguments are explicitly passed in the arrow function
  const txRes = await trackPerformance("CONFIDENTIAL_TRANSFER", () =>
    client.confidentialTransfer(
      sender,
      recipient.address,
      TOKEN_ADDRESS,
      transferAmount,
    ),
  );

  const txHash = txRes.result.hash;
  console.log(
    "Status:Confidential Transfer is completed. Transfer amount is hidden on-chain.",
  );
  console.log(`Transaction Hash: ${txHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${txHash}`);

  const senderConfidentialBalanceAfterTx = await client.getConfidentialBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
  );

  const recipientConfidentialBalanceAfterTx =
    await client.getConfidentialBalance(
      recipient.address,
      recipientKeys.privateKey,
      TOKEN_ADDRESS,
    );

  console.log(
    "Sender Confidential Balance (Post-Transfer):",
    ethers.formatUnits(senderConfidentialBalanceAfterTx.amount, 2),
  );
  console.log(
    "Recipient Confidential Balance (Post-Transfer):",
    ethers.formatUnits(recipientConfidentialBalanceAfterTx.amount, 2),
    "\n",
  );

  // 3. WITHDRAW PHASE
  const withdrawAmount = ethers.parseUnits("0.05", 2);
  console.log(
    "Withdrawing 0.05 tokens from confidential contract to recipient's public balance...",
  );
  const withdrawRes = await trackPerformance("WITHDRAW_TOKENS", () =>
    client.withdraw(recipient, TOKEN_ADDRESS, withdrawAmount),
  );
  let recipientConfidentialBalanceBeforeWithdraw =
    await client.getConfidentialBalance(
      recipient.address,
      recipientKeys.privateKey,
      TOKEN_ADDRESS,
    );

  console.log(
    "Recipient Confidential Balance (Pre-Withdraw):",
    ethers.formatUnits(recipientConfidentialBalanceBeforeWithdraw.amount, 2),
  );
  const withdrawHash = withdrawRes.result.hash;
  console.log(`Transaction Hash: ${withdrawHash}`);
  console.log(`View Transaction: ${EXPLORER_URL}${withdrawHash}`);

  const recipientConfidentialBalanceAfterWithdraw =
    await client.getConfidentialBalance(
      recipient.address,
      recipientKeys.privateKey,
      TOKEN_ADDRESS,
    );

  console.log(
    "Recipient Confidential Balance (Final):",
    ethers.formatUnits(recipientConfidentialBalanceAfterWithdraw.amount, 2),
  );

  console.log("\n=== Complete Flow Execution Finished ===");
}

main().catch((error) => {
  console.error("Execution Error:", error);
  process.exit(1);
});
