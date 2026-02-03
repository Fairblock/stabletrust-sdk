# @fairblock/stabletrust

## Overview

The StableTrust SDK by Fairblock provides a robust interface for executing confidential transfers using homomorphic encryption and zero-knowledge proofs. This package enables developers to integrate confidentiality features directly into their applications, allowing for secure token deposits, private transfers, and withdrawals while maintaining the integrity and auditability of the underlying blockchain transactions.

For a comprehensive technical understanding of the architecture and cryptographic primitives, please refer to the following documentation:

- **Technical Overview**: [Fairblock Confidential Transfers](https://docs.fairblock.network/docs/confidential_transfers/technical_overview)
- **StableTrust Protocol**: [StableTrust Documentation](https://docs.fairblock.network/docs/confidential_transfers/stabletrust)
- **Confidential Transactions**: [Transaction Mechanics](https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions)

## Installation

To install the package in your project, execute the following command:

```bash
npm install @fairblock/stabletrust
```

## Usage

The SDK revolves around the `ConfidentialTransferClient`, which manages interactions with the confidential transfer contract and handles the necessary cryptographic operations.

### Initialization

Import and initialize the client with your network configuration.

```javascript
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";

// Configuration for Arbitrum Sepolia (example)
const client = new ConfidentialTransferClient({
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  contractAddress: "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E",
  chainID: 421614,
});
```

### Key Functions

The following methods are the primary entry points for interacting with the confidential system.

#### `ensureAccount(signer)`

Initializes or retrieves the cryptographic keys associated with an account. This step is required before performing any confidential operations.

- **Parameters**:
  - `signer` (ethers.Signer): The ethers.js signer instance for the user.
- **Returns**: An object containing the user's private and public keys for the confidential system.

#### `deposit(signer, tokenAddress, amount)`

Deposits a specified amount of ERC20 tokens into the confidential contract, converting them into a "pending" confidential balance.

- **Parameters**:
  - `signer` (ethers.Signer): The transaction signer.
  - `tokenAddress` (string): The contract address of the ERC20 token.
  - `amount` (bigint): The amount to deposit (ensure proper unit scaling).
- **Returns**: A transaction receipt.

#### `transfer(signer, recipientAddress, tokenAddress, amount)`

Executes a confidential transfer of tokens from the sender to a recipient. The amount and nature of the transfer are encrypted.

- **Parameters**:
  - `signer` (ethers.Signer): The sender's signer.
  - `recipientAddress` (string): The public address of the recipient.
  - `tokenAddress` (string): The token contract address.
  - `amount` (bigint): The amount to transfer.
- **Returns**: A transaction receipt.

#### `applyPending(signer)`

Moves funds from the "pending" balance to the "available" balance. This is often necessary for the recipient to utilize received funds.

- **Parameters**:
  - `signer` (ethers.Signer): The user's signer.
- **Returns**: A transaction receipt.

#### `withdraw(signer, tokenAddress, amount)`

Withdraws funds from the confidential "available" balance back to the public layer (ERC20 tokens).

- **Parameters**:
  - `signer` (ethers.Signer): The user's signer.
  - `tokenAddress` (string): The token contract address.
  - `amount` (bigint): The amount to withdraw.
- **Returns**: A transaction receipt.

### Examples

For a complete implementation demonstrating the full lifecycle of a confidential transaction—from deposit to withdrawal—please refer to the `examples/complete-flow.js` file included in this repository.

## Performance Metrics

The following are estimated execution times for standard operations within the confidential flow. Please note that these durations may vary based on network congestion and client hardware performance.

| Operation     | Avg Duration |
| :------------ | :----------- |
| Deposit       | 63s          |
| Transfer      | 58s          |
| Apply Pending | 61s          |
| Withdraw      | 58s          |

## Resources

- **Website**: [https://fairblock.network](https://fairblock.network)
- **Twitter**: [https://twitter.com/0xfairblock](https://twitter.com/0xfairblock)
