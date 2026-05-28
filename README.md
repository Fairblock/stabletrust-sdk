# @fairblock/stabletrust

## Overview

The StableTrust SDK by Fairblock provides a robust interface for executing confidential and anonymous transfers using homomorphic encryption and zero-knowledge proofs. This package enables developers to integrate confidentiality features directly into their applications, allowing for secure token deposits, private transfers, and withdrawals while maintaining the integrity and auditability of the underlying blockchain transactions.

For a comprehensive technical understanding of the architecture and cryptographic primitives, please refer to the following documentation:

- **Technical Overview**: [Fairblock Confidential Transfers](https://docs.fairblock.network/docs/confidential_transfers/technical_overview)
- **StableTrust Protocol**: [StableTrust Documentation](https://docs.fairblock.network/docs/confidential_transfers/stabletrust)
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

| Feature | `ConfidentialTransferClient` | `AnonymousTransferClient` |
| :--- | :--- | :--- |
| **Identity** | On-chain wallet address is visible | Account ID only — wallet address is hidden |
| **Gas** | User pays gas for all transactions | Fairycloak relay pays gas (except deposit) |
| **Setup** | Direct RPC connection | Requires a running Fairycloak relay server |
| **Recipient** | Must have a confidential account | Can receive to another anonymous account or a public address |
| **Key management** | Keys auto-derived from wallet signature | Keys derived per-account; store the private key yourself |
| **Best for** | Privacy over balances/amounts with known senders | Full sender anonymity |

### `ConfidentialTransferClient` — Confidential Transfers

Transactions are submitted on-chain directly from your wallet. The **amount and balance are encrypted** (hidden), but the **sender's address is visible** on-chain. Ideal when you want confidential balances without hiding your identity.

### `AnonymousTransferClient` — Anonymous Transfers

Transactions are routed through the **Fairycloak relay**, which submits them on-chain and pays gas. The sender's wallet address is **never revealed** on-chain — only a numeric account ID is associated with the transfer. Use this client when full sender anonymity is required.

---

## Available Confidential Contract Addresses (Testnet)

The following contract addresses are available for confidential transfers on testnet networks. These are test deployments and should not be used with mainnet assets:

| Network(Testnet) | Chain ID | Contract Address                             |
| :--------------- | :------- | :------------------------------------------- |
| Stable           | 2201     | `0xB96aa42b246a956B170fE426A72fB610E4976f9E` |
| Arc              | 1244     | `0xb20aB54e1c6AE55B0DD11FEB7FFf3fF1E9631f19` |
| Base             | 84532    | `0x962a8A7CD28BfFBb17C4F6Ec388782cca3ffd618` |
| Ethereum         | 11155111 | `0x2E48F3D9b8F4aCA9E6AF0630eaB2ceB7A3f5eEd1` |
| Arbitrum         | 421614   | `0x14Afd604971bee5b5fac52df2d56CaE421519Cc5` |
| Tempo            | 42431    | `0x08B6563C95dfe3a4F5533CAA6F7D55a74FCb4F6c` |

---

## ConfidentialTransferClient

The `ConfidentialTransferClient` manages direct on-chain interactions with the confidential transfer contract. Amounts and balances are encrypted using homomorphic encryption; the sender's wallet address remains visible on-chain.

### Initialization

Import and initialize the client with your network configuration.

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

// Use SDK default StableTrust contract for a known chainId
const client = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  84532,
);
```

If you are using a custom deployment, pass an explicit contract address:

```javascript
const customClient = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  "0xYourCustomStableTrustContract",
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

// Tempo (special fee handling via IPFS proof upload)
const tempoClient = new ConfidentialTransferClient(
  "https://tempo-rpc.example.com",
  42431,
);
```

**Note on Tempo Chain**: The Tempo network (chainId 42431) uploads ZK proofs to IPFS instead of passing them as calldata. The SDK handles this automatically.

### Token Denomination

When depositing, transferring, or withdrawing, parse the token amount using the token's decimals. When displaying a fetched balance, format it back using those same decimals.

```javascript
const tokenDecimals = 6; // e.g., USDC

const amountToDeposit = ethers.parseUnits("0.1", tokenDecimals);
await client.confidentialDeposit(signer, tokenAddress, amountToDeposit);

const amountToTransfer = ethers.parseUnits("0.05", tokenDecimals);
await client.confidentialTransfer(signer, recipientAddress, tokenAddress, amountToTransfer);

const amountToWithdraw = ethers.parseUnits("0.02", tokenDecimals);
await client.withdraw(signer, tokenAddress, amountToWithdraw);

const balance = await client.getConfidentialBalance(signer.address, privateKey, tokenAddress);
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

Transfers a confidential amount to a recipient. The recipient must have an existing confidential account.

- **Returns**: Transaction receipt.

#### `withdraw(wallet, tokenAddress, amount, options?)`

Withdraws from the confidential available balance back to public ERC-20.

- **Returns**: Transaction receipt.

#### `getFeeAmount()`

Returns the native fee (in wei) required for confidential transfers on the current chain.

#### `getPublicBalance(address, tokenAddress)`

Returns the public ERC-20 balance for an address.

---

## AnonymousTransferClient

The `AnonymousTransferClient` routes all operations through the **Fairycloak relay server**. The relay submits transactions on-chain and pays gas on your behalf (except for deposits, which require the user to pay). Your wallet address is never revealed — only a numeric anonymous account ID appears on-chain.

> **Access Required** — Anonymous transfers are available to teams building privacy-critical applications. To obtain a Fairycloak relay URL and API key, reach out to the Fairblock team at [hello@fairblock.network](mailto:hello@fairblock.network).

### Initialization

```javascript
import { AnonymousTransferClient } from "@fairblock/stabletrust";

const client = new AnonymousTransferClient({
  fairycloakUrl: "http://127.0.0.1:8080", // Fairycloak relay base URL
  diamondAddress: "0xYourDiamondContractAddress",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  apiKey: "optional-api-key",             // optional
});
```

### Key Derivation

Anonymous accounts use a per-account ElGamal keypair derived from a wallet signature. **Store the returned `privateKey` securely** — it cannot be recovered without the original wallet and account ID.

```javascript
const keys = await client.deriveAnonymousKeys(authWallet, accountId);
// keys.publicKey — base64, register this when creating an account
// keys.privateKey — base64, keep this secret; used for decryption and proof generation
```

### Key Methods

#### `getNextAccountId()`

Returns the account count. The ID that will be assigned to the **next** new account is `Number(count) + 1`.

```javascript
const count = await client.getNextAccountId();
const myNewId = Number(count) + 1;
await client.createAccount(wallet, keys.publicKey);
```

#### `createAccount(authWallet, elgamalPublicKey, options?)`

Creates a new anonymous account via the relay. The relay pays gas.

#### `updateAuthKeys(authWallet, accountId, { add, remove }, options?)`

Adds or removes authorised signers for an anonymous account. Pass `ethers.Wallet` instances or raw uncompressed hex pubkey strings.

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

Deposits tokens into an anonymous account. The **user pays gas** for this operation. Handles ERC-20 approval automatically.

```javascript
const result = await client.deposit(wallet, accountId, tokenAddress, ethers.parseUnits("10", 6));
await client.waitForRequest(result.request_id);
```

#### `transferToPublic(authWallet, accountId, params, options?)`

Transfers from an anonymous account to a public EVM address. The relay pays gas.

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

Transfers between two anonymous accounts. The relay pays gas.

```javascript
const result = await client.transferToAnonymous(wallet, senderAccountId, {
  recipientId: recipientAccountId,
  token: tokenAddress,
  elGamalPrivateKey: keys.privateKey,
  amount: ethers.parseUnits("3", 6),
});
```

#### `applyPending(authWallet, accountId, options?)`

Moves a pending incoming balance into available. Must be called after receiving an anonymous-to-anonymous transfer. The relay pays gas.

#### `withdraw(authWallet, accountId, params, options?)`

Withdraws from an anonymous account to a public EVM address. The relay pays gas.

```javascript
const result = await client.withdraw(wallet, accountId, {
  destination: "0xDestinationAddress",
  token: tokenAddress,
  plainAmount: ethers.parseUnits("2", 6),
  elGamalPrivateKey: keys.privateKey,
});
```

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

const client = new ConfidentialTransferClient("https://sepolia.base.org", 84532);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const tokenAddress = "0xYourTokenAddress";
const tokenDecimals = 6;

// 1. Ensure account exists and get encryption keys
const keys = await client.ensureAccount(wallet);

// 2. Deposit
const depositAmount = ethers.parseUnits("10", tokenDecimals);
await client.confidentialDeposit(wallet, tokenAddress, depositAmount);

// 3. Check balance
const balance = await client.getConfidentialBalance(wallet.address, keys.privateKey, tokenAddress);
console.log("Available:", ethers.formatUnits(balance.available.amount, tokenDecimals));

// 4. Transfer (recipient must have called ensureAccount)
const transferAmount = ethers.parseUnits("5", tokenDecimals);
await client.confidentialTransfer(wallet, recipientAddress, tokenAddress, transferAmount);

// 5. Withdraw
const withdrawAmount = ethers.parseUnits("2", tokenDecimals);
await client.withdraw(wallet, tokenAddress, withdrawAmount);
```

### Anonymous Flow (AnonymousTransferClient)

```javascript
import { AnonymousTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

const client = new AnonymousTransferClient({
  fairycloakUrl: "http://127.0.0.1:8080",
  diamondAddress: "0xYourDiamondAddress",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
});
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const tokenAddress = "0xYourTokenAddress";
const tokenDecimals = 6;

// 1. Determine the ID your account will get, then create it
const count = await client.getNextAccountId();
const accountId = Number(count) + 1;
const keys = await client.deriveAnonymousKeys(wallet, accountId);
await client.createAccount(wallet, keys.publicKey);

// 2. Deposit (user pays gas)
const depositResult = await client.deposit(wallet, accountId, tokenAddress, ethers.parseUnits("10", tokenDecimals));
await client.waitForRequest(depositResult.request_id);

// 3. Check balance
const balance = await client.getBalance(accountId, tokenAddress, keys.privateKey);
console.log("Available:", balance.available, "Pending:", balance.pending);

// 4. Transfer to a public address (relay pays gas)
const transferResult = await client.transferToPublic(wallet, accountId, {
  recipient: "0xRecipientAddress",
  token: tokenAddress,
  elGamalPrivateKey: keys.privateKey,
  amount: ethers.parseUnits("3", tokenDecimals),
});
await client.waitForRequest(transferResult.request_id);

// 5. Withdraw (relay pays gas)
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
  await client.confidentialTransfer(signer, recipientAddress, tokenAddress, amount);
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

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| "Account does not exist" | Recipient hasn't initialized their confidential account | Recipient must call `ensureAccount()` first |
| "Insufficient balance" | Transfer amount exceeds available confidential balance | Deposit more tokens or reduce transfer amount |
| "Account finalization timeout" | Account creation is still processing | Wait a few minutes and retry |
| "Proof generation failed" | Invalid inputs or cryptographic operation error | Verify all parameters and ensure sufficient balance |
| "Amount too small" | Amount rounds to 0 in contract scale | Use a larger amount (minimum depends on token decimals) |
| Fairycloak HTTP error | Relay unreachable or request rejected | Check the relay URL, API key, and account authorization |

---

## Performance Metrics

The following are estimated execution times for standard operations. Durations may vary based on network congestion and hardware.

| Operation | Avg Duration |
| :--- | :--- |
| Account Creation | 45s |
| Deposit | 63s |
| Transfer | 58s |
| Withdraw | 58s |

---

## Security Considerations

1. **Private Key Management**
   - Never expose or log private keys or seed phrases
   - Store private keys securely (e.g., hardware wallets, encrypted vaults)
   - Anonymous account `privateKey` values are sensitive — treat them the same as wallet private keys

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
   - Anonymous transfers between anonymous accounts require `applyPending()` before the recipient can spend

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
