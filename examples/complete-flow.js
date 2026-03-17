import { ethers } from "ethers";
import dotenv from "dotenv";
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ERC20_ABI } from "./constants.js";
dotenv.config();

/**
 * ARCHITECTURE OVERVIEW:
 * For deep dive into the underlying architecture and the separation
 * of Pending and Available balances, visit:
 * https://docs.fairblock.network/docs/confidential_transfers/technical_overview
 */

const CHAINS = [
  {
    network: "Stable",
    chainId: 2201,
    tokenAddress: "0x78Cf24370174180738C5B8E352B6D14c83a6c9A9",
    rpcUrl: "https://rpc.testnet.stable.xyz",
    explorerUrl: "https://testnet.stablescan.xyz/tx/",
  },
  {
    network: "Arc",
    chainId: 1244,
    tokenAddress: "0x3600000000000000000000000000000000000000",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app/tx/",
  },
  {
    network: "Base",
    chainId: 84532,
    tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpcUrl: "https://base-sepolia.g.alchemy.com/v2/fSmnOhWOKhURXIcGCsq-M",
    explorerUrl: "https://sepolia.basescan.org/tx/",
  },
  {
    network: "Ethereum",
    chainId: 11155111,
    tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io/tx/",
  },
  {
    network: "Arbitrum",
    chainId: 421614,
    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    rpcUrl: "https://arbitrum-sepolia-testnet.api.pocket.network",
    explorerUrl: "https://sepolia.arbiscan.io/tx/",
  },
  {
    network: "Tempo",
    chainId: 42431,
    tokenAddress: "0x20c0000000000000000000000000000000000000",
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    explorerUrl: "https://explore.tempo.xyz/tx/",
  },
];

const actionSummary = [];

/**
 * Performance Utility: Tracks execution time and provides timestamps and network congestion
 */
async function trackPerformance(actionName, action, provider, chainNetwork) {
  const startTimeMs = Date.now();
  const startTimestamp = new Date(startTimeMs).toISOString();
  const start = performance.now();

  const result = await action();

  const end = performance.now();
  const endTimeMs = Date.now();
  const endTimestamp = new Date(endTimeMs).toISOString();

  const duration = ((end - start) / 1000).toFixed(3);

  let congestionStr = "N/A";
  let congestionInfo = "";
  if (provider && result && (result.hash || result.transactionHash)) {
    try {
      const hash = result.hash || result.transactionHash;
      // Wait for tx to be mined to be able to get block details
      const receipt = await provider.waitForTransaction(hash, 1, 60000); // 60s timeout
      if (receipt && receipt.blockNumber) {
        const block = await provider.getBlock(receipt.blockNumber);
        congestionStr = block.transactions.length;
        congestionInfo = ` | Block TXs (Congestion): ${congestionStr}`;
      }
    } catch (e) {
      congestionStr = "Unknown";
      congestionInfo = " | Block TXs (Congestion): Unknown";
    }
  }

  console.log(`Action: ${actionName}`);
  console.log(`Started: ${startTimestamp}`);
  console.log(`Duration: ${duration}s${congestionInfo}`);
  console.log(`Completed: ${endTimestamp}`);

  actionSummary.push({
    Chain: chainNetwork,
    Action: actionName,
    "Duration (s)": duration,
    Congestion: congestionStr,
    "Started At": startTimestamp,
    "Completed At": endTimestamp,
  });

  return { result, duration };
}

async function runChainFlow(chain, senderPrivateKey, recipientPrivateKey) {
  console.log(`\n======================================================`);
  console.log(`=== Starting Confidential Flow for ${chain.network} ===`);
  console.log(
    `=== Chain ID: ${chain.chainId} | Token: ${chain.tokenAddress} ===`,
  );
  console.log(`======================================================\n`);

  try {
    const rpcUrl = chain.rpcUrl;
    const explorerBaseUrl = chain.explorerUrl;
    const client = new ConfidentialTransferClient(
      rpcUrl,
      Number(chain.chainId),
    );

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const sender = new ethers.Wallet(senderPrivateKey, provider);
    const recipient = new ethers.Wallet(recipientPrivateKey, provider);

    const tokenContract = new ethers.Contract(
      chain.tokenAddress,
      ERC20_ABI,
      provider,
    );
    const tokenDecimals = await tokenContract.decimals();

    console.log("Sender Address:", sender.address);
    console.log("Recipient Address:", recipient.address);

    const senderKeysRes = await trackPerformance(
      "ENSURE_SENDER_ACCOUNT",
      () => client.ensureAccount(sender),
      provider,
      chain.network,
    );
    const senderKeys = senderKeysRes.result;

    const recipientKeysRes = await trackPerformance(
      "ENSURE_RECIPIENT_ACCOUNT",
      () => client.ensureAccount(recipient),
      provider,
      chain.network,
    );
    const recipientKeys = recipientKeysRes.result;

    // 1. DEPOSIT PHASE
    console.log("\n--- Phase 1: Deposit ---");
    const depositAmount = ethers.parseUnits("0.1", tokenDecimals);
    const senderConfidentialBalanceBefore = await client.getConfidentialBalance(
      sender.address,
      senderKeys.privateKey,
      chain.tokenAddress,
    );

    console.log(
      "Sender Confidential Balance (Pre-Deposit):",
      ethers.formatUnits(senderConfidentialBalanceBefore.amount, tokenDecimals),
    );

    console.log("Depositing 0.1 tokens into confidential contract...");

    const depRes = await trackPerformance(
      "DEPOSIT_TOKENS",
      () =>
        client.confidentialDeposit(sender, chain.tokenAddress, depositAmount),
      provider,
      chain.network,
    );
    const depHash = depRes.result.hash || depRes.result.transactionHash;
    console.log(`Transaction Hash: ${depHash}`);
    console.log(`View Transaction: ${explorerBaseUrl}${depHash}`);

    const senderConfidentialBalanceAfterDep =
      await client.getConfidentialBalance(
        sender.address,
        senderKeys.privateKey,
        chain.tokenAddress,
      );
    console.log(
      "Sender Confidential Balance (Post-Deposit):",
      ethers.formatUnits(
        senderConfidentialBalanceAfterDep.amount,
        tokenDecimals,
      ),
    );

    // 2. TRANSFER PHASE
    console.log("\n--- Phase 2: Transfer ---");
    const transferAmount = ethers.parseUnits("0.05", tokenDecimals);
    const senderConfidentialBalanceBeforeTx =
      await client.getConfidentialBalance(
        sender.address,
        senderKeys.privateKey,
        chain.tokenAddress,
      );

    const recipientConfidentialBalanceBeforeTx =
      await client.getConfidentialBalance(
        recipient.address,
        recipientKeys.privateKey,
        chain.tokenAddress,
      );

    console.log(
      "Sender Confidential Balance (Pre-Transfer):",
      ethers.formatUnits(
        senderConfidentialBalanceBeforeTx.amount,
        tokenDecimals,
      ),
    );
    console.log(
      "Recipient Confidential Balance (Pre-Transfer):",
      ethers.formatUnits(
        recipientConfidentialBalanceBeforeTx.amount,
        tokenDecimals,
      ),
    );

    console.log("Transferring 0.05 tokens confidentially to recipient...");

    const txRes = await trackPerformance(
      "CONFIDENTIAL_TRANSFER",
      () =>
        client.confidentialTransfer(
          sender,
          recipient.address,
          chain.tokenAddress,
          transferAmount,
        ),
      provider,
      chain.network,
    );

    const txHash = txRes.result.hash || txRes.result.transactionHash;
    console.log(
      "Status: Confidential Transfer is completed. Transfer amount is hidden on-chain.",
    );
    console.log(`Transaction Hash: ${txHash}`);
    console.log(`View Transaction: ${explorerBaseUrl}${txHash}`);

    const senderConfidentialBalanceAfterTx =
      await client.getConfidentialBalance(
        sender.address,
        senderKeys.privateKey,
        chain.tokenAddress,
      );

    const recipientConfidentialBalanceAfterTx =
      await client.getConfidentialBalance(
        recipient.address,
        recipientKeys.privateKey,
        chain.tokenAddress,
      );

    console.log(
      "Sender Confidential Balance (Post-Transfer):",
      ethers.formatUnits(
        senderConfidentialBalanceAfterTx.amount,
        tokenDecimals,
      ),
    );
    console.log(
      "Recipient Confidential Balance (Post-Transfer):",
      ethers.formatUnits(
        recipientConfidentialBalanceAfterTx.amount,
        tokenDecimals,
      ),
    );

    // 3. WITHDRAW PHASE
    console.log("\n--- Phase 3: Withdraw ---");
    const withdrawAmount = ethers.parseUnits("0.025", tokenDecimals);
    console.log(
      "Withdrawing 0.025 tokens from confidential contract to recipient's public balance...",
    );

    const recipientConfidentialBalanceBeforeWithdraw =
      await client.getConfidentialBalance(
        recipient.address,
        recipientKeys.privateKey,
        chain.tokenAddress,
      );

    console.log(
      "Recipient Confidential Balance (Pre-Withdraw):",
      ethers.formatUnits(
        recipientConfidentialBalanceBeforeWithdraw.amount,
        tokenDecimals,
      ),
    );

    const withdrawRes = await trackPerformance(
      "WITHDRAW_TOKENS",
      () => client.withdraw(recipient, chain.tokenAddress, withdrawAmount),
      provider,
      chain.network,
    );

    const withdrawHash =
      withdrawRes.result.hash || withdrawRes.result.transactionHash;
    console.log(`Transaction Hash: ${withdrawHash}`);
    console.log(`View Transaction: ${explorerBaseUrl}${withdrawHash}`);

    const recipientConfidentialBalanceAfterWithdraw =
      await client.getConfidentialBalance(
        recipient.address,
        recipientKeys.privateKey,
        chain.tokenAddress,
      );

    console.log(
      "Recipient Confidential Balance (Final):",
      ethers.formatUnits(
        recipientConfidentialBalanceAfterWithdraw.amount,
        tokenDecimals,
      ),
    );

    console.log(`\n=== Successfully completed flow for ${chain.network} ===`);

    const currentChainSummary = actionSummary
      .filter((s) => s.Chain === chain.network)
      .map((s) => ({
        Action: s.Action,
        "Duration (s)": s["Duration (s)"],
        Congestion: s.Congestion,
        "Started At": s["Started At"],
        "Completed At": s["Completed At"],
      }));

    if (currentChainSummary.length > 0) {
      console.log(`\n=== Execution Summary for ${chain.network} ===`);
      console.table(currentChainSummary);
    }
  } catch (err) {
    console.error(
      `\n[!] Error running flow on ${chain.network} (Chain ID: ${chain.chainId}):`,
    );
    console.error(err.message || err);
    console.log(`Skipping ${chain.network} and moving to the next chain...\n`);
  }
}

async function main() {
  console.log(
    "=== Starting Multi-Chain Confidential Flow Performance Test ===\n",
  );

  const senderPrivateKey = process.env.SENDER_PRIVATE_KEY;
  const recipientPrivateKey = process.env.RECIPIENT_PRIVATE_KEY;

  if (!senderPrivateKey || !recipientPrivateKey) {
    console.error(
      "Missing SENDER_PRIVATE_KEY or RECIPIENT_PRIVATE_KEY in .env",
    );
    process.exit(1);
  }

  for (const chain of CHAINS) {
    await runChainFlow(chain, senderPrivateKey, recipientPrivateKey);
  }

  console.log("\n=== All Chain Flows Execution Finished ===");
  if (actionSummary.length > 0) {
    console.log("\n=== Actions Summary Table ===");
    console.table(actionSummary);
  }
}

main().catch((error) => {
  console.error("Critical Execution Error:", error);
  process.exit(1);
});
