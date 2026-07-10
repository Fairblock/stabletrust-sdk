/**
 * Anonymous Confidential Transfer — Basic Flow
 *
 *   [1] Generate two UUIDs as account IDs
 *   [2] Derive ElGamal keypairs for both accounts
 *   [3] Create both anonymous accounts via Fairycloak
 *   [4] Deposit tokens into anon1
 *   [5] Top up prepaid fees for anon1 (if balance < 0.1)
 *   [6] Transfer anon1 → anon2
 *   [7] Apply pending balance for anon2
 *   [8] Withdraw anon2 → public address
 *
 * Run:
 *   node examples/anonymous-flow.js
 */

import { ethers } from "ethers";
import dotenv from "dotenv";
import { AnonymousTransferClient } from "@fairblock/stabletrust";

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const EVM_RPC = process.env.EVM_RPC ?? "http://127.0.0.1:8545";
const FAIRYCLOAK_URL = process.env.FAIRYCLOAK_URL ?? "http://127.0.0.1:8080";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS ?? "0xE915164570b027C2A0FfadcB1B672192E35BF008";
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS ?? "6");

// Amounts in raw ERC-20 units (6 decimals — matches complete-flow.js)
const DEPOSIT_AMOUNT = 100_000n; // 0.1  USDC
const TRANSFER_AMOUNT = 50_000n; // 0.05 USDC
const WITHDRAW_AMOUNT = 20_000n; // 0.02 USDC

// Prepaid fee thresholds (raw units, assumes fee token uses TOKEN_DECIMALS)
const MIN_FEE_BALANCE = 1_000_000n; // 0.1  — deposit if balance falls below this
const FEE_DEPOSIT_AMOUNT = 2_000_000n; // 0.5  — how much to top up in one shot

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

async function logBalance(client, accountId, keys, token, _decimals, label) {
  const bal = await client.getBalance(accountId, token, keys.privateKey);

  // getBalance() returns amounts in contract scale (rawAmount * 100 / 10^tokenDecimals).
  // Formatting with 2 decimal places gives the correct human-readable value: e.g.
  //   contract scale 10  → formatUnits(10, 2)  = "0.10"  (= 0.1  USDC)
  //   contract scale 5   → formatUnits(5, 2)   = "0.05"  (= 0.05 USDC)
  console.log(
    `[BALANCE][${label}] acc=${accountId} | ` +
      `avail=${fmt(bal.available, 2)} | ` +
      `pending=${fmt(bal.pending, 2)} | ` +
      `total=${fmt(bal.amount, 2)}`,
  );

  return bal;
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
    chainId: CHAIN_ID,
    rpcUrl: EVM_RPC,
  });

  // ── [1] Generate account IDs ─────────────────────────────────────────────────

  console.log("\n── [1] Generate anonymous account IDs ──────────────────");

  // An auth signer can only ever be bound to a single anonymous account, so the
  // account ID must be stable per-wallet across runs (random UUIDs would cause
  // "auth signer already used" failures on every re-run with the same .env keys).
  // Anonymous account IDs must be alphanumeric and at most 20 characters.
  const anon1Id = `anon${anon1Wallet.address.slice(2, 6).toLowerCase()}`;
  const anon2Id = `anon${anon2Wallet.address.slice(2, 6).toLowerCase()}`;
  log("anon1 id:", anon1Id);
  log("anon2 id:", anon2Id);

  // ── [2] Derive ElGamal keypairs ──────────────────────────────────────────────

  console.log("\n── [2] Derive ElGamal keypairs ─────────────────────────");
  log("Deriving ElGamal keypairs from wallets + account IDs …");

  const [anon1Keys, anon2Keys] = await Promise.all([
    client.deriveAnonymousKeys(anon1Wallet, anon1Id),
    client.deriveAnonymousKeys(anon2Wallet, anon2Id),
  ]);
  log("anon1 pubkey:", anon1Keys.publicKey);
  log("anon2 pubkey:", anon2Keys.publicKey);

  // ── [3] Create accounts ──────────────────────────────────────────────────────

  console.log("\n── [3] Create anonymous accounts ───────────────────────");

  log(`  ensuring anon1 (id=${anon1Id}) …`);
  const e1 = await client.ensureAnonymousAccount(
    anon1Wallet,
    anon1Id,
    anon1Keys.publicKey,
  );
  log(
    `  created=${e1.created}  exists=${e1.accountInfo.exists}  finalized=${e1.accountInfo.finalized}`,
  );

  log(`  ensuring anon2 (id=${anon2Id}) …`);
  const e2 = await client.ensureAnonymousAccount(
    anon2Wallet,
    anon2Id,
    anon2Keys.publicKey,
  );
  log(
    `  created=${e2.created}  exists=${e2.accountInfo.exists}  finalized=${e2.accountInfo.finalized}`,
  );

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

  // ── [4] Deposit ──────────────────────────────────────────────────────────────

  console.log("\n── [4] Deposit into anon1 ──────────────────────────────");
  log(
    `Depositing ${fmt(DEPOSIT_AMOUNT, TOKEN_DECIMALS)} tokens into anon1 (anon1 pays gas) …`,
  );

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

  // ── [5] Top up prepaid fees for anon1 ───────────────────────────────────────

  console.log("\n── [5] Top up prepaid fees for anon1 ───────────────────");

  const feeToken = await client.getFeeToken();
  const inlineFee = await client.getAnonymousInlineTransferFee();
  log("  fee token  :", feeToken);
  log("  inline fee :", fmt(inlineFee, TOKEN_DECIMALS), "tokens");

  if (inlineFee === 0n) {
    log("  no fee configured — transactions are free, skipping top-up.");
  } else {
    const feeBalance = await client.getPrepaidFeeBalance(anon1Id, feeToken);
    log("  fee balance:", fmt(feeBalance, TOKEN_DECIMALS), "tokens");

    const requiredFeeBalance =
      inlineFee > MIN_FEE_BALANCE ? inlineFee : MIN_FEE_BALANCE;

    if (feeBalance < requiredFeeBalance) {
      const currency = feeToken === ethers.ZeroAddress ? "native" : "ERC-20";
      const deficit = requiredFeeBalance - feeBalance;
      const topUpAmount =
        FEE_DEPOSIT_AMOUNT > deficit ? FEE_DEPOSIT_AMOUNT : deficit;
      log(
        `  balance < ${fmt(requiredFeeBalance, TOKEN_DECIMALS)}, depositing ${fmt(topUpAmount, TOKEN_DECIMALS)} ${currency} fee tokens (anon1 pays gas) …`,
      );
      const fd = await client.depositFees(
        anon1Wallet,
        anon1Id,
        topUpAmount,
      );
      log("  request_id:", fd.request_id, "  status:", fd.status);
      if (fd.error) log("    [!] Error:", fd.error);
      if (fd.tx_hash) log("  tx_hash   :", fd.tx_hash);

      const fdFinal = await client.waitForRequest(fd.request_id, {
        timeoutMs: 180_000,
      });
      log("  status    :", fdFinal.status, "  tx_hash:", fdFinal.tx_hash ?? "—");
      if (fdFinal.error) log("    [!] Error:", fdFinal.error);

      const newFeeBalance = await client.getPrepaidFeeBalance(anon1Id, feeToken);
      log("  new fee balance:", fmt(newFeeBalance, TOKEN_DECIMALS), "tokens");
    } else {
      log(
        `  fee balance sufficient (${fmt(feeBalance, TOKEN_DECIMALS)} ≥ ${fmt(requiredFeeBalance, TOKEN_DECIMALS)}), skipping deposit.`,
      );
    }
  }

  // ── [6] Transfer anon1 → anon2 ───────────────────────────────────────────────

  console.log("\n── [6] Transfer anon1 → anon2 ──────────────────────────");
  log(`Transferring ${fmt(TRANSFER_AMOUNT, TOKEN_DECIMALS)} tokens …`);

  const txAnon = await client.transferToAnonymous(anon1Wallet, anon1Id, {
    recipientId: anon2Id,
    token: TOKEN_ADDRESS,
    elGamalPrivateKey: anon1Keys.privateKey,
    amount: TRANSFER_AMOUNT,
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

  // ── [7] Apply pending for anon2 ──────────────────────────────────────────────

  console.log("\n── [7] Apply pending balance for anon2 ─────────────────");
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

  // ── [8] Withdraw anon2 → public address ──────────────────────────────────────

  console.log("\n── [8] Withdraw from anon2 ─────────────────────────────");
  log(
    `Withdrawing ${fmt(WITHDRAW_AMOUNT, TOKEN_DECIMALS)} tokens → ${withdrawDest} …`,
  );

  const wd = await client.withdraw(anon2Wallet, anon2Id, {
    destination: withdrawDest,
    token: TOKEN_ADDRESS,
    plainAmount: WITHDRAW_AMOUNT,
    elGamalPrivateKey: anon2Keys.privateKey,
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
  log("anon1 id   :", anon1Id);
  log("anon2 id   :", anon2Id);
  log(
    "Deposited  :",
    ethers.formatUnits(DEPOSIT_AMOUNT, TOKEN_DECIMALS),
    "tokens → anon1",
  );
  log(
    "Transferred:",
    ethers.formatUnits(TRANSFER_AMOUNT, TOKEN_DECIMALS),
    "tokens → anon2",
  );
  log(
    "Withdrawn  :",
    ethers.formatUnits(WITHDRAW_AMOUNT, TOKEN_DECIMALS),
    "tokens →",
    withdrawDest,
  );
}

main().catch((err) => {
  console.error("\n[!]", err.message ?? err);
  process.exit(1);
});
