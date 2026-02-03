# Confidential Tokens - Privacy-First Digital Assets

A complete implementation of confidential token operations using ElGamal encryption and zero-knowledge proofs. This project includes both a Solidity smart contract (GatewayContract) and a professional web frontend for confidential token management.

## 🚀 Features

### Smart Contract (GatewayContract.sol)
- **Account Management**: Create and manage confidential accounts with ElGamal keypairs
- **Token Conversion**: Convert ERC20 tokens to confidential tokens
- **Private Transfers**: Transfer confidential tokens with zero-knowledge proofs
- **Secure Withdrawals**: Convert confidential tokens back to ERC20 tokens
- **Access Control**: Role-based permissions for admin and relayer operations
- **Event Logging**: Comprehensive event system for tracking operations

### Frontend Application
- **Professional UI**: Modern, responsive design optimized for real-world usage
- **Wallet Integration**: MetaMask connection for Ethereum blockchain access
- **Account Dashboard**: View encrypted balances and account status
- **Token Operations**: Convert, transfer, and withdraw confidential tokens
- **Client-Side Security**: All cryptographic operations performed in WebAssembly
- **Real-Time Updates**: Live status updates and transaction tracking

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │  GatewayContract │    │   Relayer       │
│   (Web App)     │◄──►│   (Solidity)     │◄──►│   (Off-chain)   │
│                 │    │                  │    │                 │
│ • MetaMask      │    │ • Account Mgmt   │    │ • Proof Verify  │
│ • WebAssembly   │    │ • Token Escrow   │    │ • State Update  │
│ • Proof Gen     │    │ • Event Logging  │    │ • Balance Mgmt  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📁 Project Structure

```
elgamal-demo/
├── GatewayContract.sol          # Main smart contract
├── src/                         # Rust cryptographic library
│   ├── components/              # Core cryptographic components
│   │   ├── elgamal.rs          # ElGamal encryption implementation
│   │   ├── proofs.rs           # Zero-knowledge proofs
│   │   └── ...
│   ├── transfer.rs             # Transfer proof generation
│   ├── withdraw.rs             # Withdraw proof generation
│   └── lib.rs                  # Library exports
├── frontend/                    # Web application
│   ├── index.html              # Main application page
│   ├── styles.css              # Professional styling
│   ├── app.js                  # Main application logic
│   ├── deployment-config.js    # Configuration file
│   ├── src/lib.rs              # WebAssembly bindings
│   └── pkg/                    # Built WebAssembly files
└── scripts/                     # Deployment scripts
```

## 🛠️ Installation & Setup

### Prerequisites
- **Rust**: Latest stable version
- **Node.js**: 16+ with npm
- **Solidity**: For smart contract development
- **MetaMask**: Browser extension for wallet connection

### 1. Clone and Setup

```bash
git clone <repository-url>
cd elgamal-demo

# Install Rust dependencies
cargo build

# Setup frontend
cd frontend
npm install
npm run build:wasm
```

### 2. Smart Contract Deployment

```bash
# Deploy GatewayContract (example using Hardhat)
npx hardhat compile
npx hardhat run scripts/deploy.js --network <network>
```

### 3. Configuration

Update `frontend/deployment-config.js` with your deployed contract address and network settings:

```javascript
export const CONFIG = {
    GATEWAY_CONTRACT_ADDRESS: '0xYourDeployedContractAddress',
    NETWORK: {
        chainId: 1, // Mainnet or testnet
        name: 'Ethereum Mainnet',
        // ... other settings
    }
};
```

### 4. Start Development Server

```bash
cd frontend
npm run dev
# Open http://localhost:8080
```

## 🔧 Usage

### 1. Connect Wallet
- Click "Connect Wallet" in the header
- Approve MetaMask connection
- Verify your address is displayed

### 2. Create Confidential Account
- Click "Create Account" card
- Generate ElGamal keypair (stored locally)
- Submit account creation to contract

### 3. Convert Tokens
- Select token (USDC, USDT, DAI)
- Enter amount to convert
- Approve token transfer and confirm conversion

### 4. Private Transfers
- Enter recipient address
- Select token and amount
- Generate zero-knowledge proof
- Submit confidential transfer

### 5. Withdraw Tokens
- Select token and amount
- Generate withdrawal proof
- Convert back to ERC20 tokens

## 🔐 Security Features

### Cryptographic Security
- **ElGamal Encryption**: All balances encrypted with user-specific keys
- **Zero-Knowledge Proofs**: Transfer amounts and balances remain private
- **Client-Side Generation**: All proofs generated locally in WebAssembly
- **No Server Dependency**: Cryptographic operations don't require server trust

### Smart Contract Security
- **Access Control**: Role-based permissions for sensitive operations
- **Reentrancy Protection**: Guards against reentrancy attacks
- **Pausable Operations**: Admin can pause contract in emergencies
- **Event Logging**: Comprehensive audit trail for all operations

### Frontend Security
- **Local Key Storage**: Private keys stored in browser (use secure storage in production)
- **Input Validation**: All user inputs validated before processing
- **Error Handling**: Comprehensive error handling and user feedback
- **HTTPS Required**: All operations require secure connections

## 🌐 Network Support

### Mainnet
- Ethereum Mainnet
- Token addresses for USDC, USDT, DAI

### Testnet
- Sepolia Testnet
- Test token addresses
- Faucet integration for testing

## 📊 API Reference

### WebAssembly Functions

```javascript
// Generate ElGamal keypair
const keypair = await generate_keypair();

// Encrypt amount with public key
const encrypted = await encrypt_amount(amount, pubkey);

// Generate transfer proof
const proof = await generate_transfer_proof({
    current_balance_ciphertext,
    current_balance,
    transfer_amount,
    source_keypair,
    destination_pubkey
});

// Generate withdraw proof
const proof = await generate_withdraw_proof({
    current_balance_ciphertext,
    current_balance,
    withdraw_amount,
    keypair
});
```

### Smart Contract Functions

```solidity
// Create confidential account
function createConfidentialAccount(bytes calldata elgamalPubkey) 
    external returns (bytes32);

// Convert tokens to confidential
function deposit(DepositItem[] calldata items) 
    external returns (bytes32);

// Private transfer
function transferConfidential(address recipient, string calldata denom, bytes calldata transferProofData) 
    external returns (bytes32);

// Withdraw tokens
function withdraw(string calldata denom, uint256 amount, bytes calldata withdrawProofData) 
    external returns (bytes32);
```

## 🚀 Deployment

### Frontend Deployment (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd frontend
vercel --prod
```

### Smart Contract Deployment

```bash
# Using Hardhat
npx hardhat run scripts/deploy.js --network mainnet

# Using Foundry
forge create --rpc-url <RPC_URL> --private-key <PRIVATE_KEY> GatewayContract
```

## 🔍 Testing

### Frontend Testing

```bash
cd frontend
npm test
```

### Smart Contract Testing

```bash
npx hardhat test
```

### WebAssembly Testing

```bash
cd frontend
npm run test:wasm
```

## 📝 Development

### Adding New Features

1. **Smart Contract**: Add functions to `GatewayContract.sol`
2. **Cryptography**: Implement in Rust library (`src/`)
3. **WebAssembly**: Expose functions in `frontend/src/lib.rs`
4. **Frontend**: Add UI components in `app.js`

### Code Style

- **Rust**: Follow standard Rust conventions
- **JavaScript**: Use ES6+ features, async/await
- **Solidity**: Follow OpenZeppelin patterns
- **CSS**: Use CSS custom properties for theming

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: Report bugs and feature requests on GitHub Issues
- **Discussions**: Join community discussions on GitHub Discussions
- **Documentation**: Check the [USAGE.md](frontend/USAGE.md) for detailed usage guide

## 🔮 Roadmap

- [ ] Multi-asset support
- [ ] Batch operations
- [ ] Mobile app
- [ ] Advanced privacy features
- [ ] Integration with other DeFi protocols

---

**Built with ❤️ for privacy and decentralization**