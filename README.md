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

| Network  | Chain ID | Contract Address                             |
| :------- | :------- | :------------------------------------------- |
| Stable   | 2201     | `0x4735ab83c87Dea00A5B6377f477fe60C848D29d6` |
| Arc      | 1244     | `0x1Bf79BF5A32D6f3cdce3fe1A93c3fB222Bc93bb3` |
| Base     | 84532    | `0x73D2bc5B5c7aF5C3726E7bEf0BD8b4931923fdA9` |
| Ethereum | 11155111 | `0xD765Dff7D734ABE09f88991A46BAb73ACa8910EF` |
| Arbitrum | 421614   | `0xDC7Df05C2ce67881CDbF9A1af0F4C5d8C94c8A03` |
| Tempo    | 42431    | `0xB7bdce025c8a25e341Cb55795f8ba865AB3e392C` |

## Usage

The SDK revolves around the `ConfidentialTransferClient`, which manages interactions with the confidential transfer contract and handles the necessary cryptographic operations.

### Initialization

Import and initialize the client with your network configuration.

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

// Configuration for Arbitrum (example)
const client = new ConfidentialTransferClient(
  "https://arb1.arbitrum.io/rpc",
  "0x5acE788EF0C9f7f902642001d639AD155fF29A6C",
  42161,
);
```

#### Network Configuration Examples

For different networks, use the following configurations:

```javascript
// Base
const baseClient = new ConfidentialTransferClient(
  "https://mainnet.base.org",
  "0x05ad3FF447930ad5B4085C07B4Ef9b10Aa0a58F2",
  8453,
);

// Ethereum Mainnet
const ethClient = new ConfidentialTransferClient(
  "https://eth.public.netzach.io",
  "0x7B5A0060dE15a1AA1b9712A0146145E9D01A1acA",
  1,
);

// Tempo (Stablecoin chain with special fee handling)
const tempoClient = new ConfidentialTransferClient(
  "https://tempo-rpc.example.com",
  "0x17176c409B66bb03d102215eeEdb34259Db0F5AD",
  42431,
);
```

**Note on Tempo Chain**: The Tempo network (chainId 42431) uses token-based fees instead of native currency. The SDK automatically handles fee payment using PathUSD when detected.

### Key Functions

The following methods are the primary entry points for interacting with the confidential system.

#### `deriveKeys(signer)`

Derives the encryption keypair for a wallet. These keys are used for all confidential operations.

- **Parameters**:
  - `signer` (ethers.Signer): The ethers.js signer instance for the user.
- **Returns**: An object containing `publicKey` and `privateKey` (base64-encoded).

#### `ensureAccount(signer, options)`

Initializes or retrieves the cryptographic keys associated with an account. This step is required before performing any confidential operations. Automatically creates the account on-chain if it doesn't exist.

- **Parameters**:
  - `signer` (ethers.Signer): The ethers.js signer instance for the user.
  - `options` (object, optional):
    - `waitForFinalization` (boolean): Wait for account finalization. Default: `true`
    - `maxAttempts` (number): Maximum attempts to check finalization. Default: `30`
- **Returns**: An object containing the user's private and public keys for the confidential system.

#### `getBalance(address, privateKey, tokenAddress, options)`

Retrieves the decrypted balance for a specific token in the confidential account.

- **Parameters**:
  - `address` (string): The account address.
  - `privateKey` (string): The private key for decryption.
  - `tokenAddress` (string): The token contract address.
  - `options` (object, optional):
    - `type` (string): Balance type—`'available'` or `'pending'`. Default: `'available'`
- **Returns**: An object containing `amount` (number) and `ciphertext` (string).

#### `deposit(signer, tokenAddress, amount, options)`

Deposits a specified amount of ERC20 tokens into the confidential contract, converting them into a "pending" confidential balance.

- **Parameters**:
  - `signer` (ethers.Signer): The transaction signer.
  - `tokenAddress` (string): The contract address of the ERC20 token.
  - `amount` (bigint | string | number): The amount to deposit (ensure proper unit scaling).
  - `options` (object, optional):
    - `waitForFinalization` (boolean): Wait for deposit finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `transfer(signer, recipientAddress, tokenAddress, amount, options)`

Executes a confidential transfer of tokens from the sender to a recipient. The amount and nature of the transfer are encrypted.

- **Parameters**:
  - `signer` (ethers.Signer): The sender's signer.
  - `recipientAddress` (string): The public address of the recipient.
  - `tokenAddress` (string): The token contract address.
  - `amount` (number): The amount to transfer.
  - `options` (object, optional):
    - `useOffchainVerify` (boolean): Use offchain verification. Default: `false`
    - `waitForFinalization` (boolean): Wait for transfer finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `applyPending(signer, options)`

Moves funds from the "pending" balance to the "available" balance. This is often necessary for the recipient to utilize received funds.

- **Parameters**:
  - `signer` (ethers.Signer): The user's signer.
  - `options` (object, optional):
    - `waitForFinalization` (boolean): Wait for operation finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `withdraw(signer, tokenAddress, amount, options)`

Withdraws funds from the confidential "available" balance back to the public layer (ERC20 tokens).

- **Parameters**:
  - `signer` (ethers.Signer): The user's signer.
  - `tokenAddress` (string): The token contract address.
  - `amount` (number): The amount to withdraw.
  - `options` (object, optional):
    - `useOffchainVerify` (boolean): Use offchain verification. Default: `false`
    - `waitForFinalization` (boolean): Wait for withdrawal finalization. Default: `true`
- **Returns**: A transaction receipt.

#### `waitForPendingBalance(address, privateKey, tokenAddress, options)`

Polls for pending balance to appear after a transfer (typically after another user calls `applyPending`).

- **Parameters**:
  - `address` (string): The account address.
  - `privateKey` (string): The private key for decryption.
  - `tokenAddress` (string): The token contract address.
  - `options` (object, optional):
    - `maxAttempts` (number): Maximum polling attempts. Default: `60`
    - `intervalMs` (number): Polling interval in milliseconds. Default: `3000`
- **Returns**: An object containing `amount` and `ciphertext`.

#### `getFeeAmount()`

Retrieves the current fee amount required for confidential transfers on the network.

- **Returns**: The fee amount in wei (bigint).

#### `getTokenBalance(address, tokenAddress)`

Retrieves the public ERC20 token balance for an address (non-confidential).

- **Parameters**:
  - `address` (string): The account address.
  - `tokenAddress` (string): The token contract address.
- **Returns**: The token balance (bigint).

### Examples

For a complete implementation demonstrating the full lifecycle of a confidential transaction—from deposit to withdrawal—please refer to the `examples/complete-flow.js` file included in this repository.

Additional examples are available in the `examples/` directory:

- **complete-flow.js**: Full workflow example covering all operations
- **simple-snippets.js**: Quick code snippets for common tasks

## Error Handling

The SDK provides descriptive error messages for common issues. Here are some typical scenarios:

```javascript
try {
  await client.transfer(signer, recipientAddress, tokenAddress, amount);
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

| Operation     | Avg Duration |
| :------------ | :----------- |
| Deposit       | 63s          |
| Transfer      | 58s          |
| Apply Pending | 61s          |
| Withdraw      | 58s          |

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
   - Check available balance before initiating transfers
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
