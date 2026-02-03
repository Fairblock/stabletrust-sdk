import { ethers } from "ethers";
import dotenv from "dotenv";
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
dotenv.config();
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x30bAc8a17DCACbA7f70F305f4ad908C9fd6d3E2E"; //Confidential MIRROR contract on arbitrum sepolia network in future version you deploy your own confiential contract on evm network of choice and use that
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS || "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"; //Standard erc20 token contract on the arbitrum sepolia
const RPC_URL =
  process.env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
const EXPLORER_URL =
  process.env.EXPLORER_URL || "https://sepolia.arbiscan.io/tx/";
const CHAIN_ID = process.env.CHAIN_ID || 421614;
async function main() {
  console.log("=== Confidential Transfer SDK - Complete Flow ===\n");
  const client = new ConfidentialTransferClient({
    rpcUrl: RPC_URL,
    contractAddress: CONTRACT_ADDRESS,
    chainID: CHAIN_ID,
  });
  console.log("SDK client initalized\n");
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
  );
  //setting up sender and reciever wallet for demo
  const sender = new ethers.Wallet(process.env.SENDER_PRIVATE_KEY, provider);
  const recipient = new ethers.Wallet(
    process.env.RECIPIENT_PRIVATE_KEY,
    provider,
  );
  //   console.log("Sender:", sender.address);
  //   console.log("Recipient:", recipient.address);
  //   //Create confidential account if doesn't exist or derive keys of already existed accounts
  //   const senderKeys = await client.ensureAccount(sender);
  //   const reciepientKeys = await client.ensureAccount(recipient);
  //   //Intial deposited token balance of the sender and reciever
  //   const senderInitialTokenBalance = await client.getTokenBalance(
  //     sender.address,
  //     TOKEN_ADDRESS,
  //   );
  //   const receipientInitialTokenBalance = await client.getTokenBalance(
  //     recipient.address,
  //     TOKEN_ADDRESS,
  //   );
  //   console.log(
  //     "Sender balance:",
  //     ethers.formatUnits(senderInitialTokenBalance, 6), //The erc220 token we are using is 6 decimal precsion one
  //   );
  //   console.log(
  //     "Recipient balance:",
  //     ethers.formatUnits(receipientInitialTokenBalance, 6),
  //   );
  //   //Deposit tokens to the confidential contract
  //   //When we deposit tokens all the tokens go to the available balance which can be deposited or transfered to know more about the architecture how thinks are working underhood visit
  //   //https://docs.fairblock.network/docs/confidential_transfers/confidential_transactions
  //   const depositAmount = ethers.parseUnits("0.001", 6);
  //   let res = await client.deposit(sender, TOKEN_ADDRESS, depositAmount); //This would take some time to conform as dealing with multiple contract(aprox time would be will calculate later)
  //   console.log(res);
  //   const senderBalanceAfterDeposit = await client.getTokenBalance(
  //     sender.address,
  //     TOKEN_ADDRESS,
  //   );
  //   console.log(
  //     "Sender confidential balance after deposit:",
  //     ethers.formatUnits(senderBalanceAfterDeposit, 6),
  //   );

  //   console.log("Transferring 30 tokens to recipient...");
  //   const transferAmount = ethers.parseUnits("0.005", 6);
  //   const senderBalanceBeforeTransfer = await client.getTokenBalance(
  //     sender.address,
  //     TOKEN_ADDRESS,
  //   );
  //   console.log(
  //     "Sender confidential balance before transfer:",
  //     ethers.formatUnits(senderBalanceBeforeTransfer, 6),
  //   );
  //   const recipientPendingBalanceBeforeTransfer = await client.getBalance(
  //     recipient.address,
  //     reciepientKeys.privateKey,
  //     TOKEN_ADDRESS,
  //     { type: "pending" },
  //   );
  //   console.log(
  //     "Recipient confidential pending balance before transfer:",
  //     ethers.formatUnits(recipientPendingBalanceBeforeTransfer.amount, 6),
  //     recipientPendingBalanceBeforeTransfer.ciphertext,
  //   );

  //   res = await client.transfer(
  //     sender,
  //     recipient.address,
  //     TOKEN_ADDRESS,
  //     transferAmount,
  //   );
  //   console.log(
  //     "See the transaction in the explorer of choice we can see that the transfer amount is hidden and cannot be know in any way this is true magic of this package",
  //   );
  //   console.log(
  //     `Transaction hash: ${res.transactionHash}, Visit: ${EXPLORER_URL}${res.transactionHash}`,
  //   );
  //   const senderBalanceAfterTransfer = await client.getTokenBalance(
  //     sender.address,
  //     TOKEN_ADDRESS,
  //   );
  //   const recipientPendingBalanceAfterTransfer = await client.getBalance(
  //     recipient.address,
  //     reciepientKeys.privateKey,
  //     TOKEN_ADDRESS,
  //     { type: "pending" },
  //   );
  //   console.log(
  //     "Sender confidential balance after transfer:",
  //     ethers.formatUnits(senderBalanceAfterTransfer, 6),
  //   );
  //   //When there is transaction the funds move from the sender available balance to the recipient pending balance
  //   console.log(
  //     "Recipient confidential pending balance after transfer:",
  //     ethers.formatUnits(recipientPendingBalanceAfterTransfer.amount, 6),
  //     recipientPendingBalanceAfterTransfer.ciphertext,
  //   );
  //Now we have to move the pending balance tokens to availble if we want to transfer or withdraw them
  //Only one applly pending is enough for all all tokens once(all the pending balance of all tokens is converted to the available balance)
  //   const avialbleRecipientBalanceBeforeApplyPending =
  //     await client.getTokenBalance(recipient.address, TOKEN_ADDRESS);
  //   console.log(
  //     "Recipient confidential available balance before apply pending:",
  //     ethers.formatUnits(avialbleRecipientBalanceBeforeApplyPending, 6),
  //   );
  //   let res = await client.applyPending(recipient);
  //   console.log(res);
  //   const avialbleRecipientBalanceAfterApplyPending =
  //     await client.getTokenBalance(recipient.address, TOKEN_ADDRESS);
  //   console.log(
  //     "Recipient confidential available balance after apply pending:",
  //     ethers.formatUnits(avialbleRecipientBalanceAfterApplyPending, 6),
  //   );
  //Now we can withdraw tokens from the confidential contract back to erc20 tokens
  const withdrawAmount = ethers.parseUnits("0.003", 6);
  console.log(
    "Withdrawing tokens from confidential contract to erc20 tokens...",
  );
  let res = await client.withdraw(recipient, TOKEN_ADDRESS, withdrawAmount);
  console.log(res);
  const recipientKeys = await client.deriveKeys(recipient);
  const recipientAvailableTokenBalance = await client.getBalance(
    recipient.address,
    recipientKeys.privateKey,
    TOKEN_ADDRESS,
    { type: "available" },
  );
  const recipientErc20TokenBalance = await client.getTokenBalance(
    recipient.address,
    TOKEN_ADDRESS,
  );
  console.log(
    "Recipient token balance after withdraw:",
    ethers.formatUnits(recipientErc20TokenBalance, 6),
  );
  console.log(
    "Recipient available after withdraw:",
    ethers.formatUnits(recipientAvailableTokenBalance.amount, 6),
  );
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
