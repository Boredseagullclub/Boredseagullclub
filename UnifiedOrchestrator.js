const BridgeService = require('./services/bridgeService');
const Session = require('./models/Session');
const Withdrawal = require('./models/Withdrawal'); 
const logger = require('./utils/logger');
const { ethers } = require('ethers');
const mongoose = require('mongoose');

/**
 * 🦅 THE ENS GLOBAL KILLER
 */
if (ethers.resolveAddress) {
    ethers.resolveAddress = (target) => {
        if (typeof target === 'string' && target.startsWith('0x')) return target;
        return target;
    };
}

/**
 * handleInboundDeposit
 * Fixed for Strict Model Validation and Cross-Chain Execution.
 */
async function handleInboundDeposit(sourceChain, incomingTx) {
  let session = null; 

  try {
    const txHash = incomingTx.hash;
    const txAmount = String(incomingTx.amount);

    const sessionId = (
      incomingTx.memo ||
      incomingTx.destinationTag ||
      incomingTx.memo_text ||
      incomingTx.tag
    );

    logger.info(`🔍 [${sourceChain}] Processing Inbound: ${txHash} | Amt: ${txAmount} | ID: ${sessionId || 'NONE'}`);

    const ticket = await mongoose.connection.db.collection('deposits').findOne({
      $or: [
        { sourceTxHash: txHash },
        { amount: txAmount, status: 'AWAITING_DEPOSIT', fromChain: sourceChain }
      ]
    });

    if (sessionId) {
      session = await Session.findOne({
        $or: [
          { session_id: String(sessionId) },
          { sessionId: String(sessionId) },
          { "inbound.tag": String(sessionId) }
        ]
      }).lean();
    }

    if (!ticket && !session) {
      logger.warn(`⚠️  [${sourceChain}] STALL: No matching Ticket or Session for Tx ${txHash}`);
      return;
    }

    // 🦅 5. UNIFIED PAYOUT MAPPING (Fixed for Schema Validation)
    const payoutData = {
      // Stripped userId because "0x..." string fails BSON ObjectId validation
      amount: txAmount,
      token: "SEAGULLCASH", // Model requires 'token', not 'symbol'
      toAddress: (ticket?.walletAddress || ticket?.toAddress || session?.targetAddress || "").trim(),
      chain: (ticket?.toChain || session?.targetChain || "XRPL").toLowerCase(), // Model rejected 'XRPL'
      status: 'PENDING', // Model rejected 'ready', using standard initial status
      memo: String(sessionId || ticket?.memo || ticket?.tag || ""),
      sourceTxHash: txHash,
      sourceChain: sourceChain,
      createdAt: new Date()
    };

    if (!payoutData.toAddress) {
      throw new Error("Payout failed: No toAddress found in Ticket or Session.");
    }

             // 🦅 6. EXECUTE PAYOUT TRIGGER (The "Everything" Mapping)
    try {
      await mongoose.connection.db.collection('deposits').insertOne({
        ...payoutData,
        txHash: `PENDING_${txHash}`,
        status: 'CREDITED', 
        symbol: 'SEAGULLCASH',
        chain: 'XRPL',
        // 🚀 SHOTGUN MAPPING: Feed the engine every possible key it might want
        address: payoutData.toAddress,      // Common for EVM
        destination: payoutData.toAddress,  // Common for XRPL/XLM
        walletAddress: payoutData.toAddress,// Common for internal logic
        target: payoutData.toAddress,       // Common for legacy code
        to: payoutData.toAddress            // Just in case
      });
      
      logger.info(`🎯 [XLM] ALIGNED WITH ECOSYSTEM: Record added with redundant keys.`);
    } catch (writeErr) {
      logger.error(`❌ DB Write Failure: ${writeErr.message}`);
    }



    // 🦅 7. GENERATE & ARCHIVE ISO 20022 MESSAGE
    try {
      const isoPayload = {
        messageType: 'pacs.008.001.08',
        uetr: txHash,
        sender: sourceChain,
        receiver: payoutData.chain.toUpperCase(),
        amount: txAmount,
        currency: "SEAGULLCASH",
        instructedAmount: txAmount,
        endToEndId: payoutData.memo,
        timestamp: new Date()
      };
      await mongoose.connection.db.collection('iso_messages').insertOne(isoPayload);
      logger.info(`📜 ISO 20022 MESSAGE ARCHIVED: ${txHash}`);
    } catch (isoErr) {
      logger.error(`⚠️ ISO Archival Failed: ${isoErr.message}`);
    }

    if (ticket) {
      await mongoose.connection.db.collection('deposits').updateOne(
        { _id: ticket._id },
        { $set: { status: 'COMPLETED', actualAmountReceived: txAmount, sourceTxHash: txHash, updatedAt: new Date() } }
      );
    }

    logger.info(`✅ BRIDGE IGNITED: ${sourceChain} -> ${payoutData.chain} | Dest: ${payoutData.toAddress}`);

  } catch (err) {
    logger.error(`❌ BRIDGE FAILED [${sourceChain}]: ${err.message}`);

    if (session && session._id) {
      await Session.updateOne(
        { _id: session._id },
        { $set: { status: 'failed', lastError: err.message, updatedAt: new Date() } }
      );
    }
  }
}

module.exports = { handleInboundDeposit };
