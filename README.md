# Confidential Transfer SDK

> **Production-ready SDK for confidential transfers using homomorphic encryption and zero-knowledge proofs on Ethereum-compatible chains.**

## ✨ Features

- 🔒 **Fully Confidential Transfers**: Transfer tokens without revealing amounts on-chain
- 🔐 **End-to-End Encryption**: Balances encrypted with ElGamal homomorphic encryption
- ⚡ **Zero-Knowledge Proofs**: Client-side ZK proof generation - no server required
- 🎯 **Simple API**: Intuitive class-based interface with automatic WASM initialization
- 🔑 **Deterministic Key Derivation**: Keys derived from wallet signatures (no key management needed)
- ✅ **Automatic State Management**: Built-in waiting for transaction finalization
- 🌐 **Multi-Token Support**: Work with multiple tokens using a single contract
- 🛡️ **Type-Safe**: Comprehensive input validation and error handling

## 📦 Installation

```bash
npm install @stabletrust/confidential-sdk ethers
```

## 🚀 Quick Start

```javascript
import { ethers } from "ethers";
import { ConfidentialTransferClient } from "@stabletrust/confidential-sdk";

// Your token address
const TOKEN_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

// 1. Create SDK client (WASM auto-initializes)
const client = new ConfidentialTransferClient({
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  contractAddress: "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E",
  chainId: 421614,
});

// 2. Setup wallet
const wallet = new ethers.Wallet(
  process.env.PRIVATE_KEY,
  new ethers.JsonRpcProvider("https://sepolia-rollup.arbitrum.io/rpc"),
);

// 3. Create confidential account (waits for finalization automatically)
const keys = await client.ensureAccount(wallet);

// 4. Deposit tokens
await client.deposit(wallet, TOKEN_ADDRESS, ethers.parseUnits("10", 18));

// 5. Check balance (decrypted locally)
const balance = await client.getBalance(
  wallet.address,
  keys.privateKey,
  TOKEN_ADDRESS,
);
console.log("Balance:", balance.amount);
```

## 📖 Complete Example

```javascript
import { ethers } from "ethers";
import { ConfidentialTransferClient } from "@stabletrust/confidential-sdk";

async function main() {
  const TOKEN_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

  // Create client (WASM loads automatically on first use)
  const client = new ConfidentialTransferClient({
    rpcUrl: process.env.RPC_URL,
    contractAddress: process.env.CONTRACT_ADDRESS,
    chainId: 421614,
  });

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const sender = new ethers.Wallet(process.env.SENDER_KEY, provider);
  const recipient = new ethers.Wallet(process.env.RECIPIENT_KEY, provider);

  // Setup accounts
  const senderKeys = await client.ensureAccount(sender);
  const recipientKeys = await client.ensureAccount(recipient);

  // Deposit
  await client.deposit(sender, TOKEN_ADDRESS, ethers.parseUnits("100", 18));

  // Check balance
  let balance = await client.getBalance(
    sender.address,
    senderKeys.privateKey,
    TOKEN_ADDRESS,
  );
  console.log("Sender balance:", balance.amount);

  // Transfer
  await client.transfer(
    sender,
    recipient.address,
    TOKEN_ADDRESS,
    30,
    senderKeys,
    recipientKeys.publicKey,
    balance.ciphertext,
    balance.amount,
  );

  // Recipient waits for pending balance
  const pending = await client.waitForPendingBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
  );
  console.log("Pending balance:", pending.amount);

  // Apply pending to available
  await client.applyPending(recipient);

  // Check final balance
  const finalBalance = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
  );
  console.log("Final balance:", finalBalance.amount);
}

main().catch(console.error);
```

## 🌐 Multi-Token Support

Work with multiple tokens using the same contract:

```javascript
const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const USDT = "0xanothertoken...";

// Create one client for the contract
const client = new ConfidentialTransferClient({
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  contractAddress: "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E",
});

// Deposit different tokens
await client.deposit(wallet, USDC, ethers.parseUnits("100", 6));
await client.deposit(wallet, USDT, ethers.parseUnits("50", 6));

// Check balances for each token
const usdcBalance = await client.getBalance(
  wallet.address,
  keys.privateKey,
  USDC,
);
const usdtBalance = await client.getBalance(
  wallet.address,
  keys.privateKey,
  USDT,
);
```

## 🔑 API Reference

### Constructor

```typescript
new ConfidentialTransferClient(config: SdkConfig)
```

**Config:**

- `rpcUrl` (string, required): RPC endpoint URL
- `contractAddress` (string, required): Confidential transfer contract address
- `chainId` (number, optional): Chain ID (default: 421614)
- `explorerUrl` (string, optional): Block explorer URL

**Note:** WASM automatically initializes on first use. No need to call `initializeWasm()`!

### Methods

#### `ensureAccount(wallet, options?)`

Create confidential account if it doesn't exist and wait for finalization.

```typescript
await client.ensureAccount(wallet, {
  waitForFinalization: true, // default
  maxAttempts: 30, // default
});
```

#### `deposit(wallet, tokenAddress, amount, options?)`

Deposit tokens into confidential balance.

```typescript
await client.deposit(wallet, TOKEN_ADDRESS, ethers.parseUnits("100", 18), {
  waitForFinalization: true, // default
});
```

#### `getBalance(address, privateKey, tokenAddress, options?)`

Get decrypted confidential balance.

```typescript
const balance = await client.getBalance(address, privateKey, TOKEN_ADDRESS, {
  type: "available", // or 'pending'
});
// Returns: { amount: number, ciphertext: string | null }
```

#### `transfer(senderWallet, recipientAddress, tokenAddress, amount, senderKeys, recipientPublicKey, currentBalanceCiphertext, currentBalance, options?)`

Transfer confidential tokens.

```typescript
await client.transfer(
  sender,
  recipientAddress,
  TOKEN_ADDRESS,
  30,
  senderKeys,
  recipientPublicKey,
  balance.ciphertext,
  balance.amount,
  {
    useOffchainVerify: false, // default
    waitForFinalization: true, // default
  },
);
```

#### `waitForPendingBalance(address, privateKey, tokenAddress, options?)`

Wait for pending balance to appear after transfer.

```typescript
const pending = await client.waitForPendingBalance(
  address,
  privateKey,
  TOKEN_ADDRESS,
  {
    maxAttempts: 60, // default
    intervalMs: 3000, // default
  },
);
```

#### `applyPending(wallet, options?)`

Apply pending balance to available balance.

```typescript
await client.applyPending(wallet, {
  waitForFinalization: true, // default
});
```

#### `withdraw(wallet, tokenAddress, amount, keys, currentBalanceCiphertext, currentBalance, options?)`

Withdraw confidential tokens to public ERC20 balance.

```typescript
await client.withdraw(
  wallet,
  TOKEN_ADDRESS,
  20,
  keys,
  balance.ciphertext,
  balance.amount,
  {
    useOffchainVerify: false, // default
    waitForFinalization: true, // default
  },
);
```

#### `getTokenBalance(address, tokenAddress)`

Get public ERC20 token balance.

```typescript
const balance = await client.getTokenBalance(address, TOKEN_ADDRESS);
// Returns: bigint
```

#### `getFeeAmount()`

Get current transfer fee amount.

```typescript
const fee = await client.getFeeAmount();
// Returns: bigint (in wei)
```

#### `deriveKeys(wallet)`

Derive encryption keys for a wallet.

```typescript
const keys = await client.deriveKeys(wallet);
// Returns: { publicKey: string, privateKey: string }
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file:

```env
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
CONTRACT_ADDRESS=0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E
CHAIN_ID=421614

SENDER_PRIVATE_KEY=0x...
RECIPIENT_PRIVATE_KEY=0x...
```

## 🎯 Common Patterns

### Check if Account Exists

```javascript
try {
  const info = await client.getAccountInfo(address);
  if (info.exists) {
    console.log("Account exists, finalized:", info.finalized);
  }
} catch (error) {
  console.error("Failed to get account info:", error.message);
}
```

### Transfer with Balance Check

```javascript
// Get current balance
const balance = await client.getBalance(
  sender.address,
  senderKeys.privateKey,
  TOKEN_ADDRESS,
);

// Check if sufficient funds
const transferAmount = 50;
if (balance.amount < transferAmount) {
  throw new Error(
    `Insufficient balance: ${balance.amount} < ${transferAmount}`,
  );
}

// Perform transfer
await client.transfer(
  sender,
  recipient.address,
  TOKEN_ADDRESS,
  transferAmount,
  senderKeys,
  recipientKeys.publicKey,
  balance.ciphertext,
  balance.amount,
);
```

### Work with Multiple Tokens

```javascript
// Define your tokens
const tokens = {
  USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  USDT: "0xanothertoken...",
  DAI: "0xanothertoken...",
};

// Check all balances
for (const [symbol, address] of Object.entries(tokens)) {
  const balance = await client.getBalance(
    wallet.address,
    keys.privateKey,
    address,
  );
  console.log(`${symbol}: ${balance.amount}`);
}
```

## 🛠️ Error Handling

The SDK provides clear error messages:

```javascript
try {
  await client.deposit(wallet, TOKEN_ADDRESS, amount);
} catch (error) {
  if (error.message.includes("Insufficient token balance")) {
    console.log("Not enough tokens to deposit");
  } else if (error.message.includes("Token approval failed")) {
    console.log("Failed to approve token spending");
  } else {
    console.error("Unexpected error:", error.message);
  }
}
```

## 📝 TypeScript Support

Full TypeScript definitions included:

```typescript
import {
  ConfidentialTransferClient,
  Keys,
  Balance,
} from "@stabletrust/confidential-sdk";

const client: ConfidentialTransferClient = new ConfidentialTransferClient({
  rpcUrl: "...",
  contractAddress: "...",
});

const keys: Keys = await client.ensureAccount(wallet);
const balance: Balance = await client.getBalance(
  address,
  keys.privateKey,
  tokenAddress,
);
```

## 🔍 How It Works

1. **Key Derivation**: Encryption keys are deterministically derived from wallet signatures
2. **Encryption**: Balances are encrypted using ElGamal homomorphic encryption
3. **Proofs**: Zero-knowledge proofs are generated client-side using WASM
4. **Privacy**: Only encrypted balances and ZK proofs are sent on-chain
5. **Decryption**: Balances are decrypted locally using private keys

## 📚 Additional Resources

- [Quick Reference](./QUICK_REFERENCE.md)
- [Migration Guide](./MIGRATION_GUIDE.md)
- [Complete Examples](./examples/)
- [Publishing Guide](./PUBLISHING.md)

## ⚠️ Security Notes

- **Never expose private keys**: Store keys securely, never commit to version control
- **Validate addresses**: Always verify recipient addresses before transfers
- **Test on testnet**: Thoroughly test on Arbitrum Sepolia before mainnet
- **Gas fees**: Transfers require ETH for gas plus the contract's transfer fee

## 🐛 Troubleshooting

### WASM Loading Issues

WASM auto-initializes from the bundled file. If you encounter issues, ensure the `pkg/` folder is included in your package.

### Account Not Finalized

If operations fail with "account not finalized", increase the `maxAttempts` in `ensureAccount()` options.

### Proof Generation Failures

Ensure the current balance and ciphertext are fresh. Call `getBalance()` immediately before `transfer()` or `withdraw()`.

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please ensure all tests pass before submitting PRs.

---

**Built with ❤️ for privacy-preserving DeFi**
# stabletrust-sdk
