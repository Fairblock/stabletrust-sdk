# @fairblock/stabletrust

## Overview

The StableTrust SDK by Fairblock provides a robust interface for executing confidential transfers using homomorphic encryption and zero-knowledge proofs. This package enables developers to integrate confidentiality features directly into their applications, allowing for secure token deposits, private transfers, and withdrawals while maintaining the integrity and auditability of the underlying blockchain transactions.

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

## Available Confidential Contract Addresses (Testnet)

The following contract addresses are available for confidential transfers on testnet networks. These are test deployments and should not be used with mainnet assets:

| Network(Testnet) | Chain ID | Contract Address                             |
| :--------------- | :------- | :------------------------------------------- |
| Stable           | 2201     | `0xb0b461aFA69b715d842c7fAb602f50D4cef83fe5` |
| Arc              | 1244     | `0xf085e801a6FD9d03b09566a738734B7e2Bb065De` |
| Base             | 84532    | `0x1a06530765e942a1D26B74d9558e9a1EdA615867` |
| Ethereum         | 11155111 | `0x81a2c161c0327464430658516eE74A669feFC7bC` |
| Arbitrum         | 421614   | `0xa59462200F6E438c538b914eB5F980B3Fa723aA0` |
| Tempo            | 42431    | `0xB7bdce025c8a25e341Cb55795f8ba865AB3e392C` |

## Usage

The SDK revolves around the `ConfidentialTransferClient`, which manages interactions with the confidential transfer contract and handles the necessary cryptographic operations.

### Initialization

Import and initialize the client with your network configuration.

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

// Configuration for Base Sepolia (uses SDK default StableTrust contract for chainId 84532)
const client = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  84532,
);
```

If you are using a custom deployment, you can still pass an explicit contract address:

```javascript
const customClient = new ConfidentialTransferClient(
  "https://sepolia.base.org",
  "0xYourCustomStableTrustContract",
  84532,
);
```

#### Network Configuration Examples

For testnet networks listed above, use the following configurations:

```javascript
// Stable testnet
const stableClient = new ConfidentialTransferClient(
  "https://rpc.testnet.stable.xyz",
  2201,
);

// Arc testnet
const arcClient = new ConfidentialTransferClient("https://rpc.arc.xyz", 1244);

// Tempo (Stablecoin chain with special fee handling)
const tempoClient = new ConfidentialTransferClient(
  "https://tempo-rpc.example.com",
  42431,
);
```

**Note on Tempo Chain**: The Tempo network (chainId 42431) uses token-based fees instead of native currency. The SDK automatically handles fee payment using PathUSD when detected.

### Token Denomination (x100)

All confidential token amounts in this SDK use a fixed scale of 100. That means the SDK expects amounts in "token \* 100" units for deposit, transfer, and withdraw. When displaying balances, divide by 100.

- To deposit 0.1 tokens, send 10 units (0.1 \* 100).
- To display a balance, use $display = raw / 100$.

**Recommended helpers (consistent with examples):**

```javascript
// Use 2 decimals to match x100 scaling
const amountToDeposit = ethers.parseUnits("0.1", 2); // 10
await client.confidentialDeposit(signer, tokenAddress, amountToDeposit);

const amountToTransfer = ethers.parseUnits("0.05", 2); // 5
await client.confidentialTransfer(
  signer,
  recipientAddress,
  tokenAddress,
  amountToTransfer,
);

const amountToWithdraw = ethers.parseUnits("0.02", 2); // 2
await client.withdraw(signer, tokenAddress, amountToWithdraw);

const balance = await client.getConfidentialBalance(
  signer.address,
  privateKey,
  tokenAddress,
);
console.log("Balance:", ethers.formatUnits(balance.amount, 2));
```

### Key Functions

The following methods are the primary entry points for interacting with the confidential system.

#### `getAccountInfo(address)`

Fetches account core information from the contract.

- **Parameters**:
  - `address` (string): The account address.
- **Returns**: Contract account data (exists, finalized, pubkey, etc.).

#### `ensureAccount(signer, options)`

Initializes or retrieves the cryptographic keys associated with an account. This step is required before performing any confidential operations. Automatically creates the account on-chain if it doesn't exist.

- **Parameters**:
  - `signer` (ethers.Signer): The ethers.js signer instance for the user.
  - `options` (object, optional):
    - `waitForFinalization` (boolean): Wait for account finalization. Default: `true`
    - `maxAttempts` (number): Maximum attempts to check finalization. Default: `30`
- **Returns**: An object containing the user's private and public keys for the confidential system.

#### `getConfidentialBalance(address, privateKey, tokenAddress)`

Retrieves the decrypted available and pending balances for a specific token, plus the total.

- **Parameters**:
  - `address` (string): The account address.
  - `privateKey` (string): The private key for decryption.
  - `tokenAddress` (string): The token contract address.
- **Returns**: An object containing:
  - `amount` (number): The total (available + pending) in x100 units
  - `available` (object): `{ amount, ciphertext }` in x100 units
  - `pending` (object): `{ amount, ciphertext }` in x100 units

#### `confidentialDeposit(signer, tokenAddress, amount, options)`

Deposits a specified amount of ERC20 tokens into the confidential contract, converting them into a "pending" confidential balance.

- **Parameters**:
  - `signer` (ethers.Signer): The transaction signer.
  - `tokenAddress` (string): The contract address of the ERC20 token.
  - `amount` (bigint | string | number): The amount to deposit in x100 units.
  - `options` (object, optional):
    - `waitForFinalization` (boolean): Wait for deposit finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `confidentialTransfer(signer, recipientAddress, tokenAddress, amount, options)`

Executes a confidential transfer of tokens from the sender to a recipient. The amount and nature of the transfer are encrypted.

- **Parameters**:
  - `signer` (ethers.Signer): The sender's signer.
  - `recipientAddress` (string): The public address of the recipient.
  - `tokenAddress` (string): The token contract address.
  - `amount` (number): The amount to transfer in x100 units.
  - `options` (object, optional):
    - `useOffchainVerify` (boolean): Use offchain verification. Default: `false`
    - `waitForFinalization` (boolean): Wait for transfer finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `withdraw(signer, tokenAddress, amount, options)`

Withdraws funds from the confidential "available" balance back to the public layer (ERC20 tokens).

- **Parameters**:
  - `signer` (ethers.Signer): The user's signer.
  - `tokenAddress` (string): The token contract address.
  - `amount` (number): The amount to withdraw in x100 units.
  - `options` (object, optional):
    - `useOffchainVerify` (boolean): Use offchain verification. Default: `false`
    - `waitForFinalization` (boolean): Wait for withdrawal finalization. Default: `true`
- **Returns**: A transaction receipt.

### Examples

For a complete implementation demonstrating the full lifecycle of a confidential transaction—from deposit to withdrawal—please refer to the `examples/complete-flow.js` file included in this repository.

Additional examples are available in the `examples/` directory:

- **complete-flow.js**: Full workflow example covering all operations
- **simple-snippets.js**: Quick code snippets for common tasks

## Error Handling

The SDK provides descriptive error messages for common issues. Here are some typical scenarios:

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

| Issue                            | Cause                                                   | Solution                                            |
| :------------------------------- | :------------------------------------------------------ | :-------------------------------------------------- |
| "Account does not exist"         | Recipient hasn't initialized their confidential account | Recipient must call `ensureAccount()` first         |
| "Insufficient balance"           | Transfer amount exceeds available confidential balance  | Deposit more tokens or reduce transfer amount       |
| "Insufficient fee token balance" | Not enough PathUSD on Tempo chain for fees              | Top up fee token balance before transferring        |
| "Account finalization timeout"   | Account creation is still processing                    | Wait a few minutes and retry the operation          |
| "Proof generation failed"        | Invalid inputs or cryptographic operation error         | Verify all parameters and ensure sufficient balance |

## Performance Metrics

The following are estimated execution times for standard operations within the confidential flow. Please note that these durations may vary based on network congestion and client hardware performance.

The following are estimated execution times for standard operations within the confidential flow. Please note that these durations may vary based on network congestion and client hardware performance.

| Operation | Avg Duration |
| :-------- | :----------- |
| Creation  | 45s          |
| Deposit   | 63s          |
| Transfer  | 58s          |
| Withdraw  | 58s          |

## Security Considerations

When using the StableTrust SDK, follow these best practices to ensure the security of your confidential transactions:

1. **Private Key Management**
   - Never expose or log private keys or seed phrases
   - Store private keys securely (e.g., hardware wallets, encrypted vaults)
   - Derived keys are sensitive cryptographic material—handle with care

2. **Signer Security**
   - Use secure signer implementations (e.g., hardware wallets, encrypted key stores)
   - Avoid using signers with exposed private keys in production
   - Keep your ethers.js provider and signer in sync with your security setup

3. **Network Security**
   - Use HTTPS-only RPC endpoints
   - Verify contract addresses before initialization to prevent man-in-the-middle attacks
   - Consider using dedicated RPC providers for production environments

4. **Account Initialization**
   - Always call `ensureAccount()` before performing any confidential operations
   - Verify that recipient accounts exist before transferring funds
   - Allow sufficient time for account finalization before proceeding with operations

5. **Balance Verification**

- Check available balance before initiating transfers (values are in x100 units)
- Be aware of transaction fees that may vary by network
- On Tempo chain, ensure sufficient PathUSD balance for fee payment

6. **Error Handling**
   - Implement comprehensive error handling for all SDK operations
   - Log errors appropriately without exposing sensitive information
   - Implement retry logic for transient failures (network timeouts, etc.)

## Resources

- **Website**: [https://app.stabletrust.io/](https://app.stabletrust.io/)
- **Documentation**: [https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions](https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions)
- **Twitter**: [https://twitter.com/0xfairblock](https://twitter.com/0xfairblock)
- **GitHub**: [https://github.com/fairblock](https://github.com/fairblock)

## License

This package is licensed under the Apache-2.0 License. See the LICENSE file in the repository for details.
