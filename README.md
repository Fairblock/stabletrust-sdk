# @fairblock/stabletrust

## Overview

The stabletrust SDK by Fairblock provides a robust interface for executing confidential and unlinkable transfers using homomorphic encryption and zero-knowledge proofs. This package enables developers to integrate confidentiality features directly into their applications, allowing for secure token deposits, private transfers, and withdrawals while maintaining the integrity and auditability of the underlying blockchain transactions.

For a comprehensive technical understanding of the architecture and cryptographic primitives, please refer to the following documentation:

- **Technical Overview**: [Fairblock Confidential Transfers](https://docs.fairblock.network/docs/confidential_transfers/technical_overview)
- **stabletrust Protocol**: [stabletrust Documentation](https://docs.fairblock.network/docs/confidential_transfers/stabletrust)
- **Confidential Transactions**: [Transaction Mechanics](https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions)

## Requirements

Before using this SDK, ensure you have the following installed:

- **Node.js**: Version 16.0 or higher
- **npm** or **yarn**: For package management
- **ethers.js**: Version 6.0 or higher (automatically installed as a dependency)

## Installation

To install the package in your project, execute the following command:

```bash
npm install @fairblock/stabletrust
```

Or with yarn:

```bash
yarn add @fairblock/stabletrust
```

---

## Two Clients: Which One to Use?

The SDK ships two clients that serve different privacy models:

| Feature            | `ConfidentialTransferClient`                     | `AnonymousTransferClient`                                    |
| :----------------- | :----------------------------------------------- | :----------------------------------------------------------- |
| **Identity**       | On-chain wallet address is visible               | Account ID only — wallet address is hidden                   |
| **Gas**            | User pays gas for all transactions               | Relay pays gas (except user-funded raw-tx ops: deposit, fee top-up/withdraw, native-ETH create) |
| **Setup**          | Direct RPC connection                            | Requires a running Fairycloak relay server                   |
| **Recipient**      | Must have a confidential account                 | Can receive to another unlinkable account or a public address |
| **Key management** | Keys auto-derived from wallet signature          | Keys derived per-account; store the private key yourself     |
| **Best for**       | Privacy over balances/amounts with known senders | Full sender anonymity                                        |

### `ConfidentialTransferClient` — Confidential Transfers

Transactions are submitted on-chain directly from your wallet. The **amount and balance are encrypted** (hidden), but the **sender's address is visible** on-chain. Ideal when you want confidential balances without hiding your identity.

### `AnonymousTransferClient` — Unlinkable Transfers

Transactions are routed through the **Fairycloak relay**, which submits them on-chain and pays gas (recouped from the account's prepaid fee reserve). The sender's wallet address is **never revealed** on-chain - only the caller-chosen account ID is associated with the transfer. Use this client when full sender anonymity is required.

---

## Available Confidential Contract Addresses (Testnet)

The following contract addresses are available for confidential transfers on testnet networks. These are test deployments and should not be used with mainnet assets:

| Network(Testnet) | Chain ID | Contract Address                             |
| :--------------- | :------- | :------------------------------------------- |
| Stable           | 2201     | `0xe1c1456CAb802312759a8cFc3976f88bf87082cf` |
| Arc              | 5042002  | `0x1B4f05f67CC33788Da4C89a7cd0b2f8E0055E605` |
| Base             | 84532    | `0x4a251C9D79faCa20b193630A4ee313af7cBCDD93` |
| Ethereum         | 11155111 | `0x7507a13352AFAa79D33E994f86f2f62463ba8DE4` |
| Arbitrum         | 421614   | `0x5acECCdeb5CbD3C727eCB49F8706Eb80EF2f977F` |
| Tempo            | 42431    | `0xE559fB936C69c46E216bf61B07C16bF1a6d444aa` |

---

## ConfidentialTransferClient

The `ConfidentialTransferClient` manages direct on-chain interactions with the confidential transfer contract. Amounts and balances are encrypted using homomorphic encryption; the sender's wallet address remains visible on-chain.

### Initialization

Import and initialize the client with your network configuration.

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

// Use SDK default stabletrust contract for a known chainId
const client = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  84532,
);
```

If you are using a custom deployment, pass an explicit contract address:

```javascript
const customClient = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  "0xYourCustomstabletrustContract",
  84532,
);
```

#### Network Configuration Examples

```javascript
// Stable testnet
const stableClient = new ConfidentialTransferClient(
  "https://rpc.testnet.stable.xyz",
  2201,
);

// Arc testnet
const arcClient = new ConfidentialTransferClient(
  "https://rpc.arc.xyz",
  5042002,
);

// Tempo (defaults to offchainZKP/IPFS proof upload)
const tempoClient = new ConfidentialTransferClient(
  "https://tempo-rpc.example.com",
  42431,
);
```

**Note on off-chain ZKP/IPFS proofs**: The latest confidential-transfer contract exposes `transferConfidential(address,address,bytes,bool)` and `withdraw(address,uint256,bytes,bool)`. By default the SDK submits inline ABI-encoded proof bytes with `offchainZKP=false`. Set `offchainZKP: true` on `confidentialTransfer` or `withdraw` to upload the ABI-encoded proof bytes to StableTrust IPFS and put only the bare CID bytes on-chain. Tempo (chainId 42431) keeps the old SDK behaviour and defaults to `offchainZKP=true`; pass `{ offchainZKP: false }` to force inline proofs.

```javascript
const client = new ConfidentialTransferClient(rpcUrl, chainId, {
  ipfsUploadUrl: process.env.STABLETRUST_IPFS_UPLOAD_URL,
  ipfsApiKey: process.env.STABLETRUST_IPFS_API_KEY,
});

await client.confidentialTransfer(
  signer,
  recipientAddress,
  tokenAddress,
  amountToTransfer,
  { offchainZKP: true },
);

await client.withdraw(
  signer,
  tokenAddress,
  amountToWithdraw,
  { offchainZKP: true },
);
```

The deprecated option name `useOffchainVerify` is still accepted as an alias for `offchainZKP`.

### Token Denomination

When depositing, transferring, or withdrawing, parse the token amount using the token's decimals. When displaying a fetched balance, format it back using those same decimals.

```javascript
const tokenDecimals = 6; // e.g., USDC

const amountToDeposit = ethers.parseUnits("0.1", tokenDecimals);
await client.confidentialDeposit(signer, tokenAddress, amountToDeposit);

const amountToTransfer = ethers.parseUnits("0.05", tokenDecimals);
await client.confidentialTransfer(
  signer,
  recipientAddress,
  tokenAddress,
  amountToTransfer,
);

const amountToWithdraw = ethers.parseUnits("0.02", tokenDecimals);
await client.withdraw(signer, tokenAddress, amountToWithdraw);

const balance = await client.getConfidentialBalance(
  signer.address,
  privateKey,
  tokenAddress,
);
console.log("Balance:", ethers.formatUnits(balance.amount, tokenDecimals));
```

### Key Methods

#### `ensureAccount(wallet, options?)`

Creates a confidential account on-chain (if one doesn't exist) and waits for finalization. **Must be called before any confidential operation.**

- **Returns**: `{ publicKey, privateKey }` — derived ElGamal keypair for this wallet.
- `options.waitForFinalization` (default `true`) — wait for the account to be finalized.
- `options.maxAttempts` (default `225`) — maximum polling attempts.

```javascript
const keys = await client.ensureAccount(wallet);
```

#### `getAccountInfo(address)`

Fetches on-chain account state: `exists`, `finalized`, `elgamalPubkey`, `txId`, etc.

#### `getConfidentialBalance(address, privateKey, tokenAddress)`

Decrypts and returns the available and pending balances.

- **Returns**: `{ amount, available: { amount, ciphertext }, pending: { amount, ciphertext } }`

#### `confidentialDeposit(wallet, tokenAddress, amount, options?)`

Deposits ERC-20 tokens into the confidential contract. Handles ERC-20 approval automatically.

- **Returns**: Transaction receipt.

#### `confidentialTransfer(senderWallet, recipientAddress, tokenAddress, amount, options?)`

Transfers a confidential amount to a recipient. The recipient must have an existing confidential account. Both inline and IPFS proof paths use the same live non-anonymous transfer fee. The SDK reads the active fee configuration automatically: native fees are attached as `msg.value`, while ERC-20 fees are approved for the diamond when necessary.

- **Returns**: Transaction receipt.

#### `withdraw(wallet, tokenAddress, amount, options?)`

Withdraws from the confidential available balance back to public ERC-20.

- **Returns**: Transaction receipt.

#### Fee configuration getters

- `getFeeToken()` returns the active fee token; `ethers.ZeroAddress` means native currency.
- `getNonAnonymousTransferFee()` returns the fixed fee used by both inline and IPFS non-anonymous transfers.
- `getAnonymousIpfsTransferFee()` returns the fixed anonymous IPFS-path fee.
- `getAnonymousInlineTransferFee()` returns the fixed anonymous inline-path fee.

All amounts are returned as raw units of the active fee token.

#### `getPublicBalance(address, tokenAddress)`

Returns the public ERC-20 balance for an address.

---

## AnonymousTransferClient

The `AnonymousTransferClient` routes all operations through the **Fairycloak relay server**. The relay submits transactions on-chain and pays gas on your behalf, recovering the cost from the account's [prepaid fee reserve](#prepaid-fees). The exceptions are the **user-funded raw-tx operations** - `deposit`, `depositFees`, `withdrawFees`, `withdrawAllFees`, and native-ETH account creation - which you sign and pay gas for directly (and which are therefore not charged a prepaid fee). Your wallet address is never revealed - only your chosen unlinkable account ID appears on-chain.

> **Access Required** — Unlinkable transfers are available to teams building privacy-critical applications. To obtain a Fairycloak relay URL and API key, reach out to the Fairblock team at [hello@fairblock.network](mailto:hello@fairblock.network).

### Unlinkable Account ID Rules

Every `accountId` (and `senderAccountId` / `recipientId`) you pass to `AnonymousTransferClient` must follow these rules, enforced both on-chain and by the Fairycloak relay:

- **Non-empty** string
- **At most 20 characters** long
- **Alphanumeric characters only** (`A-Z`, `a-z`, `0-9`) — no spaces, punctuation, or Unicode
- **Case-sensitive** — `"MyAccount"` and `"myaccount"` are different accounts; no normalization is applied

The SDK validates `accountId` (and related fields) before making any request and throws a descriptive `Error` if it doesn't follow these rules.

### Initialization

```javascript
import { AnonymousTransferClient } from "@fairblock/stabletrust";

const client = new AnonymousTransferClient({
  fairycloakUrl: "http://your-fairycloak-url", // provided by Fairblock
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
});
```

**Config options** — `fairycloakUrl`, `chainId`, and `rpcUrl` are required. Optional:

| option | default | purpose |
|---|---|---|
| `diamondAddress` | auto-resolved by `chainId` | override the ConfidentialMirror contract address |
| `apiKey` | - | Fairycloak API key (sent as `X-API-Key`) |
| `ipfsUploadUrl` / `ipfsApiKey` / `ipfsGatewayUrl` | env fallback | off-chain ZKP proof uploads (see [Off-chain ZKP proofs](#off-chain-zkp-proofs-ipfs)) |
| `enableNativeFeeToken` | `false` | opt in to **native-ETH fee tokens**. Off by default - the SDK refuses account creation when the protocol fee token is native ETH unless this is `true`. See [Prepaid Fees](#prepaid-fees). |

### Key Derivation

Unlinkable accounts use a per-account ElGamal keypair derived from a wallet signature. **Store the returned `privateKey` securely** — it cannot be recovered without the original wallet and account ID.

```javascript
const keys = await client.deriveAnonymousKeys(authWallet, accountId);
// keys.publicKey — base64, register this when creating an account
// keys.privateKey — base64, keep this secret; used for decryption and proof generation
```

### Key Methods

#### `createAccount(authWallet, accountId, elgamalPublicKey, options?)`

Creates a new unlinkable account. `accountId` is a **caller-chosen string** — pick any unique identifier you like (e.g. a short UUID fragment or a human-readable name), as long as it follows the [Unlinkable Account ID Rules](#unlinkable-account-id-rules) above (non-empty, at most 20 characters, alphanumeric only, case-sensitive).

Creation also seeds the account's **prepaid fee reserve** (see [Prepaid Fees](#prepaid-fees)). It pulls an `initialFeeDeposit` in the active fee token, immediately charges the one-time `anonymousCreateAccountFee`, and credits the remainder to the reserve once creation finalises. The deposit defaults to the contract's `anonymousMinimumInitialFeeDeposit`; override it with `options.initialFeeDeposit`. The submission model is chosen automatically by the active fee token:

- **ERC-20 fee token** (default): the SDK checks/approves the deposit and the **relay submits + pays gas**.
- **Native ETH fee token** (`feeToken == address(0)`): ETH can't be pulled with `transferFrom`, so the fee payer **signs and funds the payable tx itself** (`msg.value == initialFeeDeposit`, `authWallet` pays gas). This path is **disabled unless** the client is constructed with `enableNativeFeeToken: true` — otherwise `createAccount` throws.

- **Options**: `deadlineOffset` (default `3600`), `initialFeeDeposit` (default = contract minimum), `gasLimit` (default `1000000n`, only used for the native raw tx)

#### `ensureAnonymousAccount(authWallet, accountId, elgamalPublicKey, options?)`

Idempotent helper that creates the unlinkable account if it doesn't already exist, and (by default) waits until it has settled (no pending CW→EVM action) before returning. If an account with `accountId` already exists on-chain, account creation is skipped entirely — safe to call on every run with a stable `accountId`.

> Note: an auth signer can only ever be bound to a single unlinkable account, so reusing a wallet across different `accountId`s will fail at creation time even via `ensureAnonymousAccount`.

```javascript
const { accountId, accountInfo, created } = await client.ensureAnonymousAccount(
  wallet,
  accountId,
  keys.publicKey,
);
```

- **Options**: `deadlineOffset` (default `3600`), `waitUntilReady` (default `true`), `timeoutMs` (default `180000`), `pollIntervalMs` (default `2000`)
- **Returns**: `{ accountId, accountInfo, created }`

#### `updateAuthKeys(authWallet, accountId, { add, remove }, options?)`

Adds or removes authorised signers for an unlinkable account. Pass `ethers.Wallet` instances or raw uncompressed hex pubkey strings. The relay pays gas and charges the `anonymousUpdateKeysFee` from the account's [prepaid reserve](#prepaid-fees).

#### `getAnonymousAccountInfo(accountId)`

Returns on-chain state: `exists`, `finalized`, `hasPendingAction`, `txId`, `elgamalPubkey`, `authNonce`.

#### `isAuthorizedSigner(accountId, signerAddress)`

Checks whether an address is an authorised signer for the given account.

#### `getBalance(accountId, tokenAddress, elGamalPrivateKey)`

Returns decrypted balance totals in contract scale.

- **Returns**: `{ amount, available, pending }`

#### `getAnonymousBalance(accountId, tokenAddress, elGamalPrivateKey)`

Returns decrypted balances including raw ciphertexts — useful when you need the ciphertext to generate proofs manually.

- **Returns**: `{ available: { amount, ciphertext }, pending: { amount, ciphertext } }`

#### `deposit(authWallet, accountId, tokenAddress, amount, options?)`

Deposits tokens into an unlinkable account. The **user pays gas** for this operation. Handles ERC-20 approval automatically.

```javascript
const result = await client.deposit(
  wallet,
  accountId,
  tokenAddress,
  ethers.parseUnits("10", 6),
);
await client.waitForRequest(result.request_id);
```

#### `transferToPublic(authWallet, accountId, params, options?)`

Transfers from an unlinkable account to a public EVM address. The relay pays gas and charges the inline or IPFS transfer fee (depending on `offchainZKP`) from the sender's [prepaid reserve](#prepaid-fees).

**Auto-proof mode** (recommended):

```javascript
const result = await client.transferToPublic(wallet, accountId, {
  recipient: "0xRecipientAddress",
  token: tokenAddress,
  elGamalPrivateKey: keys.privateKey,
  amount: ethers.parseUnits("5", 6),
});
```

**Manual proof mode** (advanced):

```javascript
const proofHex = await client.generateTransferProof(keys.privateKey, {
  currentBalanceCiphertext: ciphertext,
  currentBalanceContractScale: balanceInContractScale,
  transferAmountContractScale: amountInContractScale,
  destinationPublicKey: recipientElGamalPubkey,
});
const result = await client.transferToPublic(wallet, accountId, {
  recipient: "0xRecipientAddress",
  token: tokenAddress,
  proof: proofHex,
});
```

#### `transferToAnonymous(authWallet, senderAccountId, params, options?)`

Transfers between two unlinkable accounts. The relay pays gas and charges the inline or IPFS transfer fee (depending on `offchainZKP`) from the sender's [prepaid reserve](#prepaid-fees).

```javascript
const result = await client.transferToAnonymous(wallet, senderAccountId, {
  recipientId: recipientAccountId,
  token: tokenAddress,
  elGamalPrivateKey: keys.privateKey,
  amount: ethers.parseUnits("3", 6),
});
```

#### `applyPending(authWallet, accountId, options?)`

Moves a pending incoming balance into available. Must be called after receiving an unlinkable-to-unlinkable transfer. The relay pays gas and charges the `anonymousApplyPendingFee` from the account's [prepaid reserve](#prepaid-fees).

#### `withdraw(authWallet, accountId, params, options?)`

Withdraws from an unlinkable account to a public EVM address. The relay pays gas and charges the inline or IPFS withdraw fee (depending on `offchainZKP`) from the account's [prepaid reserve](#prepaid-fees).

```javascript
const result = await client.withdraw(wallet, accountId, {
  destination: "0xDestinationAddress",
  token: tokenAddress,
  plainAmount: ethers.parseUnits("2", 6),
  elGamalPrivateKey: keys.privateKey,
});
```

### Off-chain ZKP proofs (IPFS)

By default an unlinkable proof is submitted **inline** through the Fairycloak relay. For `transferToPublic`, `transferToAnonymous`, and `withdraw` you can instead set **`offchainZKP: true`** to upload the proof to **StableTrust self-hosted IPFS** and put only the resulting **CID** on-chain. Fairycloak/Fairyport then fetches the full proof from IPFS and forwards the actual proof bytes to the CosmWasm contract. This keeps large (~2.5 KB) proofs out of calldata. The flag is optional and defaults to `false`, so the inline path is unchanged. These proof-carrying methods support it; `deposit` and `applyPending` do not (they carry no ZK proof).

**Providing StableTrust IPFS upload config.** When `offchainZKP` is enabled the SDK uploads proof bytes to the configured StableTrust IPFS upload endpoint. Provide it either via the client config (recommended, and required in browsers where `process.env` is unavailable):

```javascript
const client = new AnonymousTransferClient({
  fairycloakUrl: "http://127.0.0.1:8080",
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  ipfsUploadUrl: process.env.STABLETRUST_IPFS_UPLOAD_URL,
  ipfsApiKey: process.env.STABLETRUST_IPFS_API_KEY,
});
```

…or, in Node.js, by setting `STABLETRUST_IPFS_UPLOAD_URL` and `STABLETRUST_IPFS_API_KEY` environment variables, used as fallback values when they are not passed in client config.

**Usage** - add the flag to a normal transfer:

```javascript
// unlinkable -> unlinkable; proof stored on IPFS, CID on-chain
await client.transferToAnonymous(wallet, "alice", {
  recipientId: "bob",
  token: tokenAddress,
  amount: ethers.parseUnits("5", 18),
  elGamalPrivateKey: keys.privateKey,
  offchainZKP: true,
});

// unlinkable -> public EVM address
await client.transferToPublic(wallet, "alice", {
  recipient: "0xRecipientAddress",
  token: tokenAddress,
  amount: ethers.parseUnits("5", 18),
  elGamalPrivateKey: keys.privateKey,
  offchainZKP: true,
});

// withdraw to a public address; withdraw proof stored on IPFS, CID on-chain
await client.withdraw(wallet, "alice", {
  destination: "0xDestinationAddress",
  token: tokenAddress,
  plainAmount: ethers.parseUnits("5", 18),
  elGamalPrivateKey: keys.privateKey,
  offchainZKP: true,
});
```

In manual-proof mode (when you pass a pre-computed `proof`) with `offchainZKP: true`, the SDK treats `proof` as an already-uploaded CID rather than re-uploading it.

### Prepaid Fees

The protocol uses a **prepaid-fee-for-all-operations** model. Each unlinkable account holds a **prepaid fee reserve** (a pot in the active fee token), and every relay-submitted operation debits a fixed fee from it:

| operation | fee |
|---|---|
| create account | `anonymousCreateAccountFee` (charged once, at creation) |
| update auth keys | `anonymousUpdateKeysFee` |
| transfer (→ public / → anonymous) | `anonymousInlineTransferFee` or `anonymousIpfsTransferFee` |
| apply pending | `anonymousApplyPendingFee` |
| withdraw | `anonymousInlineWithdrawFee` or `anonymousIpfsWithdrawFee` |

The relay fronts the gas for these operations and is reimbursed from the pot. **User-funded raw-tx operations do _not_ charge a prepaid fee** - `deposit`, `depositFees` (top-up), `withdrawFees`, and `withdrawAllFees` are signed and paid for by the user's own wallet, so there is nothing to reimburse.

The reserve is seeded at [account creation](#createaccountauthwallet-accountid-elgamalpublickey-options) (`initialFeeDeposit − anonymousCreateAccountFee`) and topped up with `depositFees`. Transfers additionally pre-check the reserve before submitting and throw a descriptive error if it can't cover the fee.

**Fee token.** There is one active fee token for the whole protocol, set by the admin and read via `getFeeToken()`. It can be an **ERC-20** (the default) or **native ETH** (`address(0)`) - fee amounts and the prepaid pot are denominated in whichever it is. Using a native-ETH fee token requires opting in with `enableNativeFeeToken: true` in the client config (see [createAccount](#createaccountauthwallet-accountid-elgamalpublickey-options)).

#### `getFeeToken()`

Returns the currently configured fee token address (checksummed). `ethers.ZeroAddress` represents native currency. `depositFees` deposits must use this token. The fee token can be rotated by the protocol over time, but existing balances in old fee tokens remain withdrawable.

#### Fee-config getters

All getters read live from the protocol and return **raw units of the active fee token** (`0n` when a pathway has no configured fee).

Per-operation fees:

- `getAnonymousCreateAccountFee()` - one-time account-creation fee.
- `getAnonymousMinimumInitialFeeDeposit()` - minimum `initialFeeDeposit` accepted at creation.
- `getAnonymousUpdateKeysFee()` - auth-key update.
- `getAnonymousApplyPendingFee()` - apply-pending.
- `getAnonymousInlineTransferFee()` / `getAnonymousIpfsTransferFee()` - inline / IPFS transfer.
- `getAnonymousInlineWithdrawFee()` / `getAnonymousIpfsWithdrawFee()` - inline / IPFS withdraw.
- `getNonAnonymousTransferFee()` - the shared non-anonymous transfer fee.

#### `getPrepaidFeeBalance(accountId, token)`

Returns the prepaid fee balance in raw units of the selected fee token. For native currency reserves, the amount is in wei.

#### `depositFees(authWallet, accountId, amount, options?)`

Deposits tokens into the prepaid fee reserve for an unlinkable account. **The user pays gas** for this operation (mirrors `deposit()`). Handles ERC-20 approval against the active fee token automatically.

```javascript
const offchainZKP = true;
const feeToken = await client.getFeeToken();
const inlineFee = await client.getAnonymousInlineTransferFee();
const ipfsFee = await client.getAnonymousIpfsTransferFee();
const requiredFee = offchainZKP ? ipfsFee : inlineFee;
const feeBalance = await client.getPrepaidFeeBalance(accountId, feeToken);

if (feeBalance < requiredFee) {
  const result = await client.depositFees(
    wallet,
    accountId,
    ethers.parseUnits("0.5", tokenDecimals),
  );
  await client.waitForRequest(result.request_id);
}
```

#### `withdrawFees(authWallet, accountId, { token, destination, amount }, options?)`

Reclaims a specific amount from the prepaid fee reserve for a given fee token. **User-funded raw-tx** model (like `deposit`/`depositFees`): the anonymous signer authorises the withdrawal via EIP-712 and the same wallet signs and funds the outer transaction, so **the user pays gas and no prepaid fee is charged** — the full amount is returned. Use this to reclaim a specific (possibly historical) fee token.

#### `withdrawAllFees(authWallet, accountId, { destination }, options?)`

Drains all prepaid fee balances across all (including historical) fee tokens to `destination`. Same user-funded raw-tx model as `withdrawFees` — the user pays gas, no prepaid fee.

#### Request Tracking

All relay operations return a `{ request_id, tx_hash, status }` object. Use the following to track completion:

```javascript
// Poll until terminal state (completed / confirmed / failed)
const final = await client.waitForRequest(result.request_id);

// Get current status
const status = await client.getRequestStatus(result.request_id);

// Get full event history (useful for reconnect/recovery)
const history = await client.getRequestEvents(result.request_id);
```

---

## End-to-End Flow Examples

### Confidential Flow (ConfidentialTransferClient)

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

const client = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  84532,
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const tokenAddress = "0xYourTokenAddress";
const tokenDecimals = 6;

// 1. Ensure account exists and get encryption keys
const keys = await client.ensureAccount(wallet);

// 2. Deposit
const depositAmount = ethers.parseUnits("10", tokenDecimals);
await client.confidentialDeposit(wallet, tokenAddress, depositAmount);

// 3. Check balance
const balance = await client.getConfidentialBalance(
  wallet.address,
  keys.privateKey,
  tokenAddress,
);
console.log(
  "Available:",
  ethers.formatUnits(balance.available.amount, tokenDecimals),
);

// 4. Transfer (recipient must have called ensureAccount)
const transferAmount = ethers.parseUnits("5", tokenDecimals);
await client.confidentialTransfer(
  wallet,
  recipientAddress,
  tokenAddress,
  transferAmount,
);

// 5. Withdraw
const withdrawAmount = ethers.parseUnits("2", tokenDecimals);
await client.withdraw(wallet, tokenAddress, withdrawAmount);
```

### Unlinkable Flow (AnonymousTransferClient)

```javascript
import { AnonymousTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

const client = new AnonymousTransferClient({
  fairycloakUrl: "http://your-fairycloak-url",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
});
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const tokenAddress = "0xYourTokenAddress";
const tokenDecimals = 6;

// 1. Choose a unique account ID, derive keys, then ensure the account exists
const accountId = "my-unique-account-id"; // any non-empty string you choose
const keys = await client.deriveAnonymousKeys(wallet, accountId);
await client.ensureAnonymousAccount(wallet, accountId, keys.publicKey);

// 2. Deposit (user pays gas)
const depositResult = await client.deposit(
  wallet,
  accountId,
  tokenAddress,
  ethers.parseUnits("10", tokenDecimals),
);
await client.waitForRequest(depositResult.request_id);

// 3. Check balance
const balance = await client.getBalance(
  accountId,
  tokenAddress,
  keys.privateKey,
);
console.log("Available:", balance.available, "Pending:", balance.pending);

// 4. Top up the prepaid fee reserve if needed (user pays gas; no fee on the top-up itself)
// The reserve was seeded at account creation; every relay op (update-keys/transfer/apply/withdraw)
// draws a fixed fee from it. Here we make sure it can cover the next transfer.
const feeToken = await client.getFeeToken();
const inlineFee = await client.getAnonymousInlineTransferFee();
const feeBalance = await client.getPrepaidFeeBalance(accountId, feeToken);
if (feeBalance < inlineFee) {
  const feeResult = await client.depositFees(
    wallet,
    accountId,
    ethers.parseUnits("0.5", tokenDecimals),
  );
  await client.waitForRequest(feeResult.request_id);
}

// 5. Transfer to a public address (relay pays gas; a transfer fee is drawn from the prepaid reserve)
const transferResult = await client.transferToPublic(wallet, accountId, {
  recipient: "0xRecipientAddress",
  token: tokenAddress,
  elGamalPrivateKey: keys.privateKey,
  amount: ethers.parseUnits("3", tokenDecimals),
});
await client.waitForRequest(transferResult.request_id);

// 6. Withdraw (relay pays gas; a withdraw fee is drawn from the prepaid reserve)
const withdrawResult = await client.withdraw(wallet, accountId, {
  destination: wallet.address,
  token: tokenAddress,
  plainAmount: ethers.parseUnits("2", tokenDecimals),
  elGamalPrivateKey: keys.privateKey,
});
await client.waitForRequest(withdrawResult.request_id);
```

---

## Error Handling

```javascript
try {
  await client.confidentialTransfer(
    signer,
    recipientAddress,
    tokenAddress,
    amount,
  );
} catch (error) {
  if (error.message.includes("Insufficient balance")) {
    console.error("Transfer amount exceeds available balance");
  } else if (error.message.includes("Proof generation failed")) {
    console.error("Failed to generate transfer proof");
  } else if (error.message.includes("Account finalization timeout")) {
    console.error("Account setup is still processing");
  } else {
    console.error("Transfer failed:", error.message);
  }
}
```

### Common Issues and Solutions

| Issue                              | Cause                                                                 | Solution                                                                                                            |
| :--------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| "Account does not exist"           | Recipient hasn't initialized their confidential account               | Recipient must call `ensureAccount()` first                                                                         |
| "Insufficient balance"             | Transfer amount exceeds available confidential balance                | Deposit more tokens or reduce transfer amount                                                                       |
| "Account finalization timeout"     | Account creation is still processing                                  | Wait a few minutes and retry                                                                                        |
| "Proof generation failed"          | Invalid inputs or cryptographic operation error                       | Verify all parameters and ensure sufficient balance                                                                 |
| "Amount too small"                 | Amount rounds to 0 in contract scale                                  | Use a larger amount (minimum depends on token decimals)                                                             |
| "Insufficient prepaid fee balance" | Unlinkable account's prepaid fee reserve is below the selected inline/IPFS transfer fee | Call `depositFees(wallet, accountId, amount)` to top up; use `getFeeToken()` and the matching anonymous fee getter |
| Fairycloak HTTP error              | Relay unreachable or request rejected                                 | Check the relay URL, API key, and account authorization                                                             |

---

## Security Considerations

When using the stabletrust SDK, follow these best practices to ensure the security of your confidential transactions:

1. **Private Key Management**
   - Never expose or log private keys or seed phrases
   - Store private keys securely (e.g., hardware wallets, encrypted vaults)
   - Unlinkable account `privateKey` values are sensitive — treat them the same as wallet private keys

2. **Signer Security**
   - Use secure signer implementations (e.g., hardware wallets, encrypted key stores)
   - Avoid using signers with exposed private keys in production

3. **Network Security**
   - Use HTTPS-only RPC endpoints
   - Verify contract and diamond addresses before initialization
   - Consider dedicated RPC providers for production environments

4. **Account Initialization**
   - For `ConfidentialTransferClient`: always call `ensureAccount()` before any operation
   - For `AnonymousTransferClient`: derive and securely store keys before creating an account
   - Verify that recipient accounts exist before transferring funds

5. **Balance Verification**
   - Check available balance before initiating transfers
   - Unlinkable transfers between unlinkable accounts require `applyPending()` before the recipient can spend

6. **Error Handling**
   - Implement comprehensive error handling for all SDK operations
   - Log errors without exposing sensitive information
   - Implement retry logic for transient network failures

---

## Resources

- **Website**: [https://app.stabletrust.io/](https://app.stabletrust.io/)
- **Documentation**: [https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions](https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions)
- **Twitter**: [https://twitter.com/0xfairblock](https://twitter.com/0xfairblock)
- **GitHub**: [https://github.com/fairblock](https://github.com/fairblock)

## License

This package is licensed under the Apache-2.0 License. See the LICENSE file in the repository for details.
