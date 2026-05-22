const stellar = require('stellar-sdk');
const StellarSdk = require('stellar-sdk');
const { Client: HbarClient, TransferTransaction, Hbar } = require("@hashgraph/sdk");
const {
  getAndIncrementNonce,
  syncNonceWithChain,
  decrementNonce,
} = require('./nonceManager');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { settleOnChain } = require('./bridgeService');
const xrpl = require('xrpl');

const socketService = require('./socketService');
const { ethers } = require('ethers');

// 🦅 THE SOVEREIGN OVERRIDE: Kills ENS and Checksum errors
ethers.resolveAddress = (target) => {
    if (typeof target === 'string') {
        let clean = target.toLowerCase().trim();
        clean = clean.replace(/^0x/, '').replace(/^xdc/, '');
        return `0x${clean}`;
    }
    return target;
};

const TREASURY = {
  XRPL: { address: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF' },
  XLM: { address: 'GD2VMYH62JD2ZGTMMWFCU5YNMASC5NWZ5FM5WN2GWLYAACYXP6BKG44I' },
  HBAR: { address: '0.0.10419620' },
  XDC: { address: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D' },
  FLARE: { address: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC' }
};


// 🦅 BULLETPROOF NOTIFY
const notifyUser = (socketService && socketService.notifyUser)
  ? socketService.notifyUser
  : (uid, ev, data) => console.log(`📢 MOCK_NOTIFY: [${ev}] for ${uid}`);

const EngineTransaction = require('../models/Transaction');
const logger = require('../utils/logger');
const config = require('../config');

const MAX_NONCE_RETRIES = 2;

async function executeOnChainPayout(withdrawalId) {
  const safeId = new mongoose.Types.ObjectId(withdrawalId);

  // 🦅 THE ATOMIC LOCK: One-way ticket to stop the double-send
  const result = await mongoose.connection.db.collection('deposits').findOneAndUpdate(
    { _id: safeId, status: 'CREDITED' },
    { $set: { status: 'PROCESSING', startedAt: new Date() } },
    { returnDocument: 'after' }
  );

  // Handle both possible return structures from Mongo driver
  const payout = result.value || result;

  if (!payout || payout.status !== 'PROCESSING') {
    console.log(`⚠️  LOCK FAILED: Ticket ${safeId} already processing or not found.`);
    return;
  }

  // 🦅 2.5 THE SOVEREIGN SYNC
  const ticket = await mongoose.connection.db.collection('deposits').findOne({
    memo: payout.memo
  }) || payout;

  const toChain = (ticket.toChain || payout.toChain).toUpperCase();
  const fromChain = (ticket.fromChain || payout.chain).toUpperCase();

  // 🎯 STEP 1: DEFINE THE TARGET BASED ON YOUR HARDCODED RULES
  let targetSymbol;

  if (['XDC', 'FLARE'].includes(toChain)) {
      targetSymbol = 'SEAGULLCOIN';
  } else if (toChain === 'XRP' || toChain === 'XRPL') {
      targetSymbol = String(ticket.toSymbol || ticket.symbol || "SEAGULLCOIN").toUpperCase().trim();
  } else {
      targetSymbol = String(ticket.toSymbol || ticket.symbol || "SEAGULLCASH").toUpperCase().trim();
  }

  const fromSymbol = String(ticket.symbol || "SEAGULLCASH").toUpperCase().trim();
  const token = targetSymbol;
  const amount = parseFloat(ticket.amount ? ticket.amount.toString() : "0");

  let ratio = "1:1";
  let amountToSend;

  // 🦅 THE SOVEREIGN CROSS-ASSET ENGINE
  if (fromSymbol === 'SEAGULLCASH' && token === 'SEAGULLCOIN') {
      amountToSend = (amount / 1000).toFixed(7);
      ratio = "1000:1 (Contraction)";
  }
  else if (fromSymbol === 'SEAGULLCOIN' && token === 'SEAGULLCASH') {
      amountToSend = (amount * 1000).toFixed(7);
      ratio = "1:1000 (Expansion)";
  }
  else {
      amountToSend = amount.toFixed(7);
      ratio = "1:1 (Parity)";
  }

  payout.symbol = token;
  payout.amount = amountToSend;

  console.log(`🛰️  VOYAGE: [${fromChain}] -> [${toChain}] | Math: ${ratio} | Asset: ${token}`);

  // 🦅 3. CREDENTIAL RECOVERY
  const rpcUrl = process.env[`${toChain}_RPC_URL`];
  const hotWalletKey = process.env[`${toChain}_HOT_WALLET_KEY`];

  if (!rpcUrl || !hotWalletKey) {
    const msg = `Missing RPC/Key for ${toChain}`;
    await mongoose.connection.db.collection('withdrawals').updateOne({ _id: safeId }, { $set: { status: 'FAILED', error: msg, updatedAt: new Date() } });
    throw new Error(msg);
  }

  try {
    // 🦅 4. THE SUPER SANITIZER
    const rawAddr = String(ticket.destinationAddress || payout.walletAddress || "").trim();
    let finalAddress = "";

    if (toChain === 'HBAR') {
        finalAddress = rawAddr;
    } else if (toChain === 'XRP' || toChain === 'XRPL') {
        finalAddress = rawAddr;
    } else if (toChain === 'XLM') {
        finalAddress = rawAddr.toUpperCase().replace(/^0X/, '');
    } else {
        let cleanHex = rawAddr.toLowerCase().replace(/^0x/, '').replace(/^xdc/, '');
        finalAddress = `0x${cleanHex}`;
    }

    console.log(`🚀 Bridge Ignited: [${toChain}] Sending ${amountToSend} ${token} to ${finalAddress}`);

    // 🚀 5. THE UNIVERSAL BROADCAST
    const txHash = await settleOnChain(finalAddress, amountToSend, token, toChain);

    // 🏦 5.5 INSTITUTIONAL ARCHIVE: Save the ISO 20022 Record
    try {
      await mongoose.connection.db.collection('isomessages').insertOne({
        txHash: txHash,
        chain: toChain,
        messageType: 'pacs.008', // Customer Credit Transfer
        endToEndId: ticket.memo || `SGL-${Date.now()}`,
        instructionId: safeId.toString(),
        debtor: {
          name: "Seagull Liquidity Node",
          address: TREASURY[toChain]?.address || "INTERNAL_VAULT",
          agent: "SEAGULL_PROTOCOL"
        },
        creditor: {
          name: "Sovereign Recipient",
          address: finalAddress,
          agent: "EXTERNAL_WALLET"
        },
        remittanceInfo: `Bridge Settlement: ${fromChain} to ${toChain}`,
        rawXml: `<FIToFICstmrCdtTrf>
                   <GrpHdr><MsgId>${txHash}</MsgId></GrpHdr>
                   <CdtTrfTxInf>
                     <PmtId><EndToEndId>${ticket.memo}</EndToEndId></PmtId>
                     <IntrBkSttlmAmt Ccy="${token}">${amountToSend}</IntrBkSttlmAmt>
                   </CdtTrfTxInf>
                 </FIToFICstmrCdtTrf>`,
        createdAt: new Date()
      });
      console.log(`🏦 ISO ARCHIVE: Message recorded for ${txHash}`);
    } catch (isoErr) {
      console.error(`⚠️ ISO ARCHIVE FAILED: ${isoErr.message}`);
      // We don't throw here because the payment actually succeeded
    }

    // 🦅 6. THE ATOMIC COMPLETION
    await mongoose.connection.db.collection('deposits').updateOne(
      { _id: safeId },
      {
        $set: {
          status: 'COMPLETED',
          payoutHash: txHash,
          token: token,
          confirmations: 1,
          updatedAt: new Date(),
          isoAnchored: true, // ⚓ Now truly anchored in the DB
          conversion: {
            ratio,
            baseAmount: amount,
            issuedAmount: amountToSend
          }
        }
      }
    );


    // 📢 7. THE NOTIFICATION
    const userId = payout.userId || payout.user_id;
    if (userId && typeof notifyUser === 'function') {
      notifyUser(userId, 'BRIDGE_SETTLED', { txHash, asset: token, amount: amountToSend, status: 'COMPLETED', network: toChain });
    }

    console.log(`✅ VOYAGE COMPLETE: [${fromChain} ➔ ${toChain}] Hash: ${txHash}\n`);

  } catch (err) {
    console.error(`❌ SETTLEMENT FAILED: ${err.message}`);
    const errorData = { status: 'FAILED', error: err.message, updatedAt: new Date() };
    await mongoose.connection.db.collection('deposits').updateOne({ _id: safeId }, { $set: errorData });
    throw err;
  }
}

// 🦅 THE BOOTLOADER
const startEngine = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/SeagullNet');
    console.log("✅ CONNECTED: Monitoring SeagullNet for PENDING payouts...");

    // 🔄 THE WATCHER: Running at 17 seconds to offset the API heartbeat
    setInterval(async () => {
      console.log("🧐 HEARTBEAT: Checking 'deposits' collection...");
      const pending = await mongoose.connection.db.collection('deposits')
        .find({ status: 'CREDITED' })
        .toArray();

      if (pending.length > 0) {
        console.log(`🎯 TARGETS ACQUIRED: Found ${pending.length} payouts.`);
        for (const tx of pending) {
          try {
            await executeOnChainPayout(tx._id);
          } catch (e) {
            console.error(`❌ Payout Failed for ID: ${tx._id} | ${e.message}`);
          }
        }
      }
    }, 17000);

  } catch (err) {
    console.error("🚨 CRITICAL: Engine failed to connect to SeagullNet:", err.message);
  }
};

startEngine();
module.exports = { executeOnChainPayout };
