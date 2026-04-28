/**
 * Anonymous Confidential Transfer — Basic Flow
 *
 *   [1] Create two anonymous accounts (anon1, anon2) — idempotent
 *   [2] Deposit tokens into anon1
 *   [3] Transfer anon1 → anon2
 *   [4] Apply pending balance for anon2
 *   [5] Withdraw anon2 → public address
 *
 * Run:
 *   node examples/anonymous-flow.js
 *
 * Re-running the script is safe — existing accounts with matching keys are reused.
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import { AnonymousTransferClient } from "@fairblock/stabletrust";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const EVM_RPC = process.env.EVM_RPC ?? "http://127.0.0.1:8545";
const FAIRYCLOAK_URL = process.env.FAIRYCLOAK_URL ?? "http://127.0.0.1:8080";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "31337");
const DIAMOND_ADDRESS =
  process.env.DIAMOND_ADDRESS ?? "0x257c5b58c8e699b3a4cbeca4eaeba8a7cdf2685e";
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS ?? "0xE915164570b027C2A0FfadcB1B672192E35BF008";
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS ?? "6");

// Amounts in raw ERC-20 units
const DEPOSIT_AMOUNT = 12_000_000n; // 12 USDC (6 decimals)
const TRANSFER_AMOUNT = 2_000_000n; //  2 USDC
const WITHDRAW_AMOUNT = 1_500_000n; //  1.5 USDC

// Anvil test accounts — override via .env
const ANON1_PK =
  process.env.ANON1_PRIVATE_KEY ??
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const ANON2_PK =
  process.env.ANON2_PRIVATE_KEY ??
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const WITHDRAW_DEST_PK =
  process.env.WITHDRAW_DEST_PK ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// ── Helpers ───────────────────────────────────────────────────────────────────

const log = console.log;
const fmt = (n, decimals) => ethers.formatUnits(BigInt(n), decimals);

async function logBalance(client, accountId, keys, token, decimals, label) {
  const bal = await client.getBalance(accountId, token, keys.privateKey);

  console.log(
    `[BALANCE][${label}] acc=${accountId} | ` +
      `avail=${fmt(bal.available, decimals)} | ` +
      `pending=${fmt(bal.pending, decimals)} | ` +
      `total=${fmt(bal.amount, decimals)}`,
  );

  return bal;
}

function diff(prev, next) {
  return {
    avail: next.available - prev.available,
    pending: next.pending - prev.pending,
    total: next.amount - prev.amount,
  };
}

/**
 * Create an anonymous account only if it doesn't already exist with matching keys.
 * Returns { accountId, created, resp? }.
 */
async function findOrCreate(client, authWallet, predictedId, keys) {
  const info = await client.getAnonymousAccountInfo(predictedId);
  if (info.exists) {
    // Compare on-chain pubkey to the derived key (base64 → hex)
    const derivedHex =
      "0x" + Buffer.from(keys.publicKey, "base64").toString("hex");
    if (info.elgamalPubkey.toLowerCase() === derivedHex.toLowerCase()) {
      log(
        `  account ${predictedId} already exists with matching keys — reusing`,
      );
      return { accountId: predictedId, created: false };
    }
    throw new Error(
      `Account ${predictedId} exists but elgamal pubkey does not match derived key. ` +
        `Expected ${derivedHex}, got ${info.elgamalPubkey}`,
    );
  }

  log(`  submitting createAccount (predicted id=${predictedId}) …`);
  const resp = await client.createAccount(authWallet, keys.publicKey);
  log(`  request_id: ${resp.request_id}  status: ${resp.status}`);
  if (resp.error) log(`  [!] Error: ${resp.error}`);
  return { accountId: predictedId, created: true, resp };
}

/**
 * Poll until hasPendingAction flips to false (CW→EVM state settled).
 */
async function waitForAccountReady(
  client,
  accountId,
  { timeoutMs = 180_000, label = "" } = {},
) {
  const tag = label ? `[${label}] ` : "";
  process.stdout.write(
    `  → ${tag}waiting for account ${accountId} to be ready`,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await client.getAnonymousAccountInfo(accountId);
    if (!info.hasPendingAction) {
      console.log(" ✓");
      return info;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(" ✗");
  throw new Error(`Timeout waiting for account ${accountId} to be ready`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Anonymous Confidential Transfer — Basic Flow");
  console.log("═══════════════════════════════════════════════════════");
  log("Fairycloak :", FAIRYCLOAK_URL);
  log("Diamond    :", DIAMOND_ADDRESS);
  log("Token      :", TOKEN_ADDRESS);

  const provider = new ethers.JsonRpcProvider(EVM_RPC);
  const anon1Wallet = new ethers.Wallet(ANON1_PK, provider);
  const anon2Wallet = new ethers.Wallet(ANON2_PK, provider);
  const withdrawDest = new ethers.Wallet(WITHDRAW_DEST_PK, provider).address;

  log("Anon1     :", anon1Wallet.address);
  log("Anon2     :", anon2Wallet.address);
  log("Withdraw → :", withdrawDest);

  const client = new AnonymousTransferClient({
    fairycloakUrl: FAIRYCLOAK_URL,
    diamondAddress: DIAMOND_ADDRESS,
    chainId: CHAIN_ID,
    rpcUrl: EVM_RPC,
  });

  // ── [1] Create accounts ──────────────────────────────────────────────────────

  console.log("\n── [1] Create anonymous accounts ───────────────────────");

  const nextId = await client.getNextAccountId();
  const anon1Id = Number(nextId) + 1;
  const anon2Id = anon1Id + 1;
  log("anon1 id will be:", anon1Id);
  log("anon2 id will be:", anon2Id);

  log("Deriving ElGamal keypairs …");
  const [anon1Keys, anon2Keys] = await Promise.all([
    client.deriveAnonymousKeys(anon1Wallet, anon1Id),
    client.deriveAnonymousKeys(anon2Wallet, anon2Id),
  ]);
  log("anon1 pubkey:", anon1Keys.publicKey);
  log("anon2 pubkey:", anon2Keys.publicKey);

  const [fc1, fc2] = await Promise.all([
    findOrCreate(client, anon1Wallet, anon1Id, anon1Keys),
    findOrCreate(client, anon2Wallet, anon2Id, anon2Keys),
  ]);

  // Wait for Fairycloak to confirm newly created accounts
  const pendingCreates = [];
  if (fc1.created && fc1.resp)
    pendingCreates.push(
      client.waitForRequest(fc1.resp.request_id, { timeoutMs: 180_000 }),
    );
  if (fc2.created && fc2.resp)
    pendingCreates.push(
      client.waitForRequest(fc2.resp.request_id, { timeoutMs: 180_000 }),
    );
  if (pendingCreates.length > 0) {
    log("Waiting for Fairycloak to confirm account creations …");
    const results = await Promise.all(pendingCreates);
    results.forEach((r) => {
      if (r.error) log("  [!] create failed:", r.error);
    });
  }

  await waitForAccountReady(client, anon1Id, { label: "anon1" });
  await waitForAccountReady(client, anon2Id, { label: "anon2" });

  const [i1, i2] = await Promise.all([
    client.getAnonymousAccountInfo(anon1Id),
    client.getAnonymousAccountInfo(anon2Id),
  ]);
  log(`anon1 exists=${i1.exists} finalized=${i1.finalized}`);
  log(`anon2 exists=${i2.exists} finalized=${i2.finalized}`);

  await logBalance(
    client,
    anon1Id,
    anon1Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon1:post-create",
  );
  await logBalance(
    client,
    anon2Id,
    anon2Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon2:post-create",
  );

  // ── [2] Deposit ──────────────────────────────────────────────────────────────

  console.log("\n── [2] Deposit into anon1 ──────────────────────────────");
  log(`Depositing ${fmt(DEPOSIT_AMOUNT)} USDC into anon1 (anon1 pays gas) …`);

  const dep = await client.deposit(
    anon1Wallet,
    anon1Id,
    TOKEN_ADDRESS,
    DEPOSIT_AMOUNT,
  );
  log("  request_id:", dep.request_id, "  status:", dep.status);
  if (dep.error) log("    [!] Error:", dep.error);
  if (dep.tx_hash) log("  tx_hash   :", dep.tx_hash);

  const depFinal = await client.waitForRequest(dep.request_id, {
    timeoutMs: 180_000,
  });
  log("  status    :", depFinal.status, "  tx_hash:", depFinal.tx_hash ?? "—");

  await waitForAccountReady(client, anon1Id, { label: "deposit" });

  await logBalance(
    client,
    anon1Id,
    anon1Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon1:post-deposit",
  );

  // ── [3] Transfer anon1 → anon2 ───────────────────────────────────────────────

  console.log("\n── [3] Transfer anon1 → anon2 ──────────────────────────");
  log(`Transferring ${fmt(TRANSFER_AMOUNT)} USDC …`);

  const txAnon = await client.transferToAnonymous(anon1Wallet, anon1Id, {
    recipientId: anon2Id,
    token: TOKEN_ADDRESS,
    elGamalPrivateKey: anon1Keys.privateKey,
    amount: TRANSFER_AMOUNT,
    useOffchainVerify: true,
  });
  log("  request_id:", txAnon.request_id, "  status:", txAnon.status);
  if (txAnon.error) log("    [!] Error:", txAnon.error);

  const txAnonFinal = await client.waitForRequest(txAnon.request_id, {
    timeoutMs: 180_000,
  });
  log(
    "  status    :",
    txAnonFinal.status,
    "  tx_hash:",
    txAnonFinal.tx_hash ?? "—",
  );
  if (txAnonFinal.error) log("    [!] Error:", txAnonFinal.error);

  await waitForAccountReady(client, anon1Id, { label: "transfer sender" });
  await waitForAccountReady(client, anon2Id, { label: "transfer recipient" });

  await logBalance(
    client,
    anon1Id,
    anon1Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon1:post-transfer",
  );
  await logBalance(
    client,
    anon2Id,
    anon2Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon2:post-transfer",
  );

  // ── [4] Apply pending for anon2 ──────────────────────────────────────────────

  console.log("\n── [4] Apply pending balance for anon2 ─────────────────");
  log("Moving incoming credit from pending → available …");

  const ap = await client.applyPending(anon2Wallet, anon2Id);
  log("  request_id:", ap.request_id, "  status:", ap.status);
  if (ap.error) log("    [!] Error:", ap.error);

  const apFinal = await client.waitForRequest(ap.request_id, {
    timeoutMs: 180_000,
  });
  log("  status    :", apFinal.status, "  tx_hash:", apFinal.tx_hash ?? "—");
  if (apFinal.error) log("    [!] Error:", apFinal.error);

  await waitForAccountReady(client, anon2Id, { label: "applyPending" });

  await logBalance(
    client,
    anon2Id,
    anon2Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon2:post-apply",
  );

  // ── [5] Withdraw anon2 → public address ──────────────────────────────────────

  console.log("\n── [5] Withdraw from anon2 ─────────────────────────────");
  log(`Withdrawing ${fmt(WITHDRAW_AMOUNT)} USDC → ${withdrawDest} …`);

  const wd = await client.withdraw(anon2Wallet, anon2Id, {
    destination: withdrawDest,
    token: TOKEN_ADDRESS,
    plainAmount: WITHDRAW_AMOUNT,
    elGamalPrivateKey: anon2Keys.privateKey,
    useOffchainVerify: true,
  });
  log("  request_id:", wd.request_id, "  status:", wd.status);
  if (wd.error) log("    [!] Error:", wd.error);

  const wdFinal = await client.waitForRequest(wd.request_id, {
    timeoutMs: 180_000,
  });
  log("  status    :", wdFinal.status, "  tx_hash:", wdFinal.tx_hash ?? "—");
  if (wdFinal.error) log("    [!] Error:", wdFinal.error);

  await waitForAccountReady(client, anon2Id, { label: "withdraw" });

  await logBalance(
    client,
    anon2Id,
    anon2Keys,
    TOKEN_ADDRESS,
    TOKEN_DECIMALS,
    "anon2:post-withdraw",
  );

  // ── Done ─────────────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ Anonymous flow completed!");
  console.log("═══════════════════════════════════════════════════════");
  log("Deposited  :", fmt(DEPOSIT_AMOUNT), "USDC → anon1");
  log("Transferred:", fmt(TRANSFER_AMOUNT), "USDC → anon2");
  log("Withdrawn  :", fmt(WITHDRAW_AMOUNT), "USDC →", withdrawDest);
}

main().catch((err) => {
  console.error("\n[!]", err.message ?? err);
  process.exit(1);
});
