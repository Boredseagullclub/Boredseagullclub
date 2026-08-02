const mongoose = require('mongoose');
const { ethers } = require('ethers');
const xrpl = require('xrpl');
require('dotenv').config({ path: '/root/Boredseagullclub/.env' }); 

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/seagullnet'; 

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("🦅 SLOT PAYOUT ENGINE: Connected safely to database hub.");
    initializeLoop();
  })
  .catch(err => {
    console.error("❌ SLOT PAYOUT ENGINE DATABASE CRASH:", err.message);
    process.exit(1);
  }); 

let isProcessing = false; 

function initializeLoop() {
  setInterval(async () => {
    if (isProcessing) {
      console.log("⏳ Engine still processing previous batch, skipping tick...");
      return;
    }
    isProcessing = true;
    try {
      await processSlotMachineWinners();
    } catch (err) {
      console.error("🎰 LOOP ERR:", err.message);
    } finally {
      isProcessing = false;
    }
  }, 6000);
} 

async function processSlotMachineWinners() {
  const payoutsCollection = mongoose.connection.db.collection('payouts');
  const pendingWins = await payoutsCollection.find({ status: 'PENDING', gameSource: 'SLOTS' }).toArray(); 

  if (pendingWins.length === 0) return; 

  const ERC20_ABI = ["function transfer(address to, uint256 value) returns (bool)"]; 

  for (let win of pendingWins) {
    const destinationAddress = win.userWallet || win.destinationAddress || win.address || win.userAddress;
    const { _id, sourceChain, amount, wagerTimestamp } = win; 
    
    // Audit string per your instruction
    const auditString = `SLOT_PAYOUT_${wagerTimestamp || Date.now()}`;
    const hexData = ethers.hexlify(ethers.toUtf8Bytes(auditString));

    // HARD VALIDATION: Prevents engine crash on bad destination data
    const isXRPL = sourceChain === 'XRPL';
    const isEVM = ['FLARE', 'FLR', 'XDC'].includes(sourceChain);
    const isValidFormat = (isXRPL && destinationAddress.startsWith('r')) ||
                          (isEVM && (destinationAddress.startsWith('0x') || destinationAddress.startsWith('xdc'))); 

    if (!isValidFormat) {
      console.error(`🛑 [CRITICAL] Win ID ${_id}: Address ${destinationAddress} incompatible with ${sourceChain}. Skipping.`);
      await payoutsCollection.updateOne({ _id }, { $set: { status: 'FAILED', errorMessage: 'Invalid Destination Format' } });
      continue;
    } 

    let outboundTxHash = "";
    try {
      if (sourceChain === 'XRPL') {
        const client = new xrpl.Client("wss://s2.ripple.com", { connectionTimeout: 10000 });
        try {
          await client.connect();
          const treasuryWallet = process.env.XRP_SECRET.split(/\s+/).length >= 12
            ? xrpl.Wallet.fromMnemonic(process.env.XRP_SECRET)
            : xrpl.Wallet.fromSecret(process.env.XRP_SECRET); 

          const txJson = {
            TransactionType: "Payment",
            Account: treasuryWallet.address,
            Destination: destinationAddress,
            Amount: {
              currency: '53656167756C6C436F696E000000000000000000',
              issuer: 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno',
              value: amount.toString()
            },
            Memos: [{
              Memo: {
                 MemoType: Buffer.from("transaction-payout", "utf8").toString("hex").toUpperCase(),
                MemoData: Buffer.from(auditString, "utf8").toString("hex").toUpperCase()
              }
            }]
          }; 

          const prepared = await client.autofill(txJson);
          const signed = treasuryWallet.sign(prepared);
          const result = await client.submitAndWait(signed.tx_blob); 

          if (result.result.meta.TransactionResult !== "tesSUCCESS") {
            throw new Error(result.result.meta.TransactionResult);
          }
          outboundTxHash = result.result.hash;
        } finally {
          await client.disconnect();
        }
      } else if (['FLARE', 'FLR', 'XDC'].includes(sourceChain)) {
        const rpcUrl = sourceChain === 'XDC' ? (process.env.XDC_RPC_URL || 'https://erpc.xinfin.network') : 'https://flare-api.flare.network/ext/C/rpc';
        const privKey = sourceChain === 'XDC' ? process.env.XDC_PRIVATE_KEY : process.env.FLARE_HOT_WALLET_KEY;
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const treasuryWallet = new ethers.Wallet(privKey.trim(), provider);
        const contractAddress = sourceChain === 'XDC' ? '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6' : '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f';
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, treasuryWallet);
        const nonce = await provider.getTransactionCount(treasuryWallet.address, 'pending');
        const network = await provider.getNetwork();
        let cleanRecipient = destinationAddress.startsWith('xdc') ? '0x' + destinationAddress.slice(3) : destinationAddress;
        const feeData = await provider.getFeeData();
        const txParams = {
          nonce: nonce,
          chainId: Number(network.chainId),
          gasLimit: 150000n,
          gasPrice: feeData.gasPrice,
          data: tokenContract.interface.encodeFunctionData("transfer", [cleanRecipient, ethers.parseUnits(amount.toString(), 18)]) + hexData.slice(2)
        };
        const txResponse = await treasuryWallet.sendTransaction({
            to: contractAddress,
            value: 0,
            gasLimit: txParams.gasLimit,
            gasPrice: txParams.gasPrice,
            nonce: txParams.nonce,
            chainId: txParams.chainId,
            data: txParams.data
        });
        await txResponse.wait();
        outboundTxHash = txResponse.hash;
      } 

      await payoutsCollection.updateOne({ _id }, { $set: { status: 'COMPLETED', payoutTxHash: outboundTxHash, processedAt: new Date() } });
      console.log(`✅ [DISPATCHED] ${amount} SGC | Audit: ${auditString}`);
    } catch (innerErr) {
      console.error(`❌ [FAILURE] Win ID ${_id}:`, innerErr.message);
      await payoutsCollection.updateOne({ _id }, { $set: { status: 'FAILED', errorMessage: innerErr.message, updatedAt: new Date() } });
    }
  }
}
