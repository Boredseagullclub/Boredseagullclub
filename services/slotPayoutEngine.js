const mongoose = require('mongoose');
const { ethers } = require('ethers');
const xrpl = require('xrpl');
require('dotenv').config({ path: '/root/Boredseagullclub/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/seagullnet';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("🦅 SLOT PAYOUT ENGINE: Connected safely to database hub.");
    console.log("🧐 MONITORING: Watching 'payouts' collection for PENDING SLOT wins...");
    initializeLoop();
  })
  .catch(err => {
    console.error("❌ SLOT PAYOUT ENGINE DATABASE CRASH:", err.message);
    process.exit(1);
  });

function initializeLoop() {
  setInterval(async () => {
    try {
      await processSlotMachineWinners();
    } catch (err) {
      console.error("🎰 LOOP RUN TIME ERR:", err.message);
    }
  }, 6000);
}

async function processSlotMachineWinners() {
  const payoutsCollection = mongoose.connection.db.collection('payouts');
  
  const pendingWins = await payoutsCollection.find({ 
    status: 'PENDING', 
    gameSource: 'SLOTS' 
  }).toArray();

  if (pendingWins.length === 0) return;

  console.log(`🎰 [PAYOUT WORKER] Found ${pendingWins.length} pending slot machine allocations.`);
  const ERC20_ABI = ["function transfer(address to, uint256 value) returns (bool)"];

  for (let win of pendingWins) {
    const { _id, sourceChain, destinationAddress, amount } = win;
    let outboundTxHash = "";

    try {
      if (sourceChain === 'XRPL') {
        if (!process.env.XRP_SECRET) throw new Error("XRP_SECRET missing from environment space.");
        
        const client = new xrpl.Client("wss://xrplcluster.com");
        await client.connect();

        const rawSecret = process.env.XRP_SECRET;
        const words = rawSecret.split(/\s+/);
        let treasuryWallet;

        if (words.length >= 12) {
          treasuryWallet = xrpl.Wallet.fromMnemonic(rawSecret);
        } else {
          treasuryWallet = xrpl.Wallet.fromSecret(rawSecret);
        }

        const txJson = {
          TransactionType: "Payment",
          Account: treasuryWallet.address,
          Destination: destinationAddress,
          Amount: {
            currency: '53656167756C6C436F696E000000000000000000',
            issuer: 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno',
            value: amount.toString()
          }
        };

        const prepared = await client.autofill(txJson);
        const signed = treasuryWallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        
        const txResult = result.result?.meta?.TransactionResult || result.meta?.TransactionResult;

        if (txResult === "tesSUCCESS") {
          outboundTxHash = signed.hash;
        } else {
          throw new Error(`XRPL rejection code: ${txResult}`);
        }
        await client.disconnect();

      } else if (['FLARE', 'FLR'].includes(sourceChain)) {
        if (!process.env.FLARE_HOT_WALLET_KEY) throw new Error("FLARE_HOT_WALLET_KEY missing from environment space.");

        const provider = new ethers.JsonRpcProvider('https://flare-api.flare.network/ext/C/rpc');
        const treasuryWallet = new ethers.Wallet(process.env.FLARE_HOT_WALLET_KEY.trim(), provider);
        
        const contractAddress = '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f';
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, treasuryWallet);
        const parsedAmount = ethers.parseUnits(amount.toString(), 18);
        
        const txResponse = await tokenContract.transfer(destinationAddress, parsedAmount);
        await txResponse.wait();
        outboundTxHash = txResponse.hash;

      } else if (sourceChain === 'XDC') {
        if (!process.env.XDC_PRIVATE_KEY) throw new Error("XDC_PRIVATE_KEY missing from environment space.");

        const provider = new ethers.JsonRpcProvider(process.env.XDC_RPC_URL || 'https://rpc.ankr.com/xdc');
        const treasuryWallet = new ethers.Wallet(process.env.XDC_PRIVATE_KEY.trim(), provider);
        
        const contractAddress = '0xd38109F587bd0326CAd60a18CF3C1ECD546809a6';
        const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, treasuryWallet);

        let cleanRecipient = destinationAddress;
        if (cleanRecipient.startsWith('xdc')) {
          cleanRecipient = '0x' + cleanRecipient.slice(3);
        }

        const parsedAmount = ethers.parseUnits(amount.toString(), 18);
        
        const txResponse = await tokenContract.transfer(cleanRecipient, parsedAmount);
        await txResponse.wait();
        outboundTxHash = txResponse.hash;
      }

      if (outboundTxHash) {
        await payoutsCollection.updateOne(
          { _id: _id },
          {
            $set: {
              status: 'COMPLETED',
              payoutTxHash: outboundTxHash,
              processedAt: new Date()
            }
          }
        );
        console.log(`✅ [GAME WIN DISPATCHED] Sent ${amount} SGC to ${destinationAddress} via [${outboundTxHash}]`);
      }

    } catch (innerErr) {
      console.error(`❌ [GAME WIN FAILURE] Win ID ${_id} failed processing:`, innerErr.message);
      await payoutsCollection.updateOne(
        { _id: _id },
        { 
          $set: { 
            status: 'FAILED', 
            errorMessage: innerErr.message,
            updatedAt: new Date() 
          } 
        }
      );
    }
  }
}
