const Session = require('../models/Session');
const { generateInitialIsoHash } = require('../utils/isoHelpers'); // Your XML helper
const logger = require('../logger');

/**
 * 🦅 THE SESSION GENERATOR
 * This is the "Front Door" of the bridge.
 */
async function createBridgeSession(userInput) {
  try {
    // 1. Generate a Unique Numeric ID (Dynamic)
    // We use a simple timestamp-based ID or a DB counter
    const newSessionId = Math.floor(Date.now() / 1000); 

    // 2. Create the "Map" in the database
    const newSession = new Session({
      session_id: newSessionId, 
      status: 'PENDING',
      inbound: {
        chain: userInput.fromChain, // e.g., 'XRPL'
        asset: userInput.asset,     // e.g., 'XRP'
      },
      outbound: {
        chain: userInput.toChain,   // e.g., 'FLARE'
        destination: userInput.userWallet,
        amount: userInput.amount
      },
      metadata: {
        // Pre-calculate the ISO link so the Reconciler can see it
        iso_hash: generateInitialIsoHash(userInput) 
      }
    });

    await newSession.save();

    logger.info(`🆕 SESSION CREATED: ${newSessionId} for ${userInput.userWallet}`);

    // 3. Return instructions to the Front-End
    return {
      success: true,
      sessionId: newSessionId,
      depositAddress: process.env[`${userInput.fromChain}_VAULT_ADDRESS`],
      requiredMemo: newSessionId // 🦅 This is what the user puts in their wallet
    };
  } catch (err) {
    logger.error(`❌ SESSION FAILED: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { createBridgeSession };

