const BridgeService = require('./BridgeService');
const Session = require('../models/Session');
const logger = require('../logger');
const { ethers } = require('ethers');
const mongoose = require('mongoose');


// 🦅 THE ENS GLOBAL KILLER
// Overriding at the prototype level to stop Ethers from attempting 
// name resolution on chains like Flare/XDC.
ethers.resolveAddress = (target) => {
    if (typeof target === 'string' && target.startsWith('0x')) return target;
    return target;
};

/**
 * handleInboundDeposit
 * The Bridge Brain: Detects incoming funds and triggers the outbound settlement.
 */
async function handleInboundDeposit(chain, incomingTx) {
  // 🦅 1. GET THE SESSION ID (Check both Memo and Destination Tag)
    // 🦅 1. THE SOVEREIGN HANDSHAKE
  const sessionId = incomingTx.memo || incomingTx.destinationTag;
  let session;

console.log(`🔍 [ORCHESTRATOR] Inbound: ${chain} | From: ${incomingTx.from} | Amt: ${incomingTx.amount} | Memo: ${incomingTx.memo || 'NONE'}`);


  if (sessionId) {
    // 🎫 SCENARIO A: Standard Memo (HBAR/XRPL/XLM)
    session = await Session.findOne({
      $or: [{ session_id: sessionId }, { sessionId: sessionId }]
    }).lean();
    } else if (['FLARE', 'XDC', 'BASE'].includes(chain.toUpperCase())) {
    // 🏠 THE SOVEREIGN HANDSHAKE
    session = await Session.findOne({
      userId: incomingTx.from.toLowerCase(), // 🎯 PROVED BY MONGOSH
      $or: [
        { amount: incomingTx.amount },          // Match if it's a number (1.9)
        { amount: String(incomingTx.amount) }  // Match if it's a string ("1.9")
      ],
      status: { $ne: 'bridged' } 
    }).sort({ createdAt: -1 }).lean();

    console.log(`🔎 ADDRESS MATCHING: Found session for ${incomingTx.from}? ${!!session}`);
  }


  // 🦅 2. VALIDATION
  if (!session) {
    logger.debug(`Skipping TX ${incomingTx.hash}: No Session ID or Address Match found.`);
    return;
  }
    try {
    // 🦅 3. MAP THE DATA (Fixed all clipped lines)
    // Pulls from root or the nested 'outbound' object if it exists
    const targetChain  = (session.toChain || (session.outbound && session.outbound.chain) || "FLARE").toUpperCase();
    
    // 🦅 THE ENS KILLER: Clean the address string to stop "getEnsAddress" panics
    const rawAddr      = session.userWallet || (session.outbound && session.outbound.destination);
    const targetAddr   = String(rawAddr || "").trim();

    const targetAmount = session.amount || (session.outbound && session.outbound.amount);
    const targetAsset  = (session.asset || (session.outbound && session.outbound.symbol) || "SEAGULLCASH").toUpperCase();

    console.log(`🛰️  ORCHESTRATOR DEBUG: Target [${targetChain}] | Addr: ${targetAddr} | Amt: ${targetAmount}`);

    // 🦅 4. THE CORRECT HANDSHAKE
    // Passes data to BridgeService.settleOnChain
    const txHash = await BridgeService.settleOnChain(
      targetAddr,     // 1. walletAddress
      targetAmount,   // 2. amount
      targetAsset,    // 3. symbol
      targetChain     // 4. chain
    );

    // 🦅 5. UPDATE DATABASE ON SUCCESS
        // 🦅 5. THE ATOMIC HANDOFF
    // Instead of just updating the session, we trigger the Deposit record 
    // so the Payout Engine actually sees it.
      await mongoose.connection.db.collection('deposits').insertOne({
      session_id: sessionId,
      userId: session.userId || session.user_id,
      amount: targetAmount,
      symbol: targetAsset,
      chain: incomingTx.chain || session.fromChain, // The Source
      toChain: targetChain,                        // The Destination
      walletAddress: targetAddr,
      status: 'CREDITED',                          // 🦅 THE ENGINE TRIGGER
      sourceTxHash: incomingTx.hash,
      createdAt: new Date(),
      updatedAt: new Date()
    });


    // Update the original session so it doesn't process twice
    await Session.updateOne(
        { _id: session._id },
        { $set: { status: 'bridged', updatedAt: new Date() } }
    );

    console.log(`✅ HANDOFF COMPLETE: Ticket ${sessionId} moved to Payout Queue.`);

  } catch (err) {
    // This catches the ENS error if it somehow bypasses the top-level killer
    logger.error(`❌ BRIDGE FAILED: ${err.message}`);
    
    await Session.updateOne(
        { _id: session._id },
        { $set: { status: 'failed', lastError: err.message } }
    );
  }
}

module.exports = { handleInboundDeposit };

