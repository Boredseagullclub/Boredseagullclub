const path = require('path');
const { ethers } = require('ethers'); // 🦅 ADDED: To kill ENS globally

// This forces Node to look in the exact folder where the script lives
require('dotenv').config({ path: path.join(__dirname, '.env') });

const mongoose = require('mongoose');

// 🦅 FIXED: Full paths for the new folder structure
const { createBridgeSession } = require('./services/sessionManager');
const { handleInboundDeposit } = require('./services/bridgeOrchestrator');

// 🦅 THE ENS KILLER:
// This prevents ethers from trying to resolve ".eth" names on Flare
// It forces every string to be treated as a direct Hex address.
const originalGetAddress = ethers.getAddress;
ethers.resolveAddress = (target) => {
    if (typeof target === 'string' && target.startsWith('0x')) return target;
    return target;
};

async function runFullDynamicTest() {
  // 1. Database Connection
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.error("❌ ERROR: No database URI found in .env! Check your setup.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("📂 DATABASE CONNECTED...");
  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    process.exit(1);
  }

  // 2. ACT AS THE FRONT-END: Create a Request
  const mockUserInput = {
    fromChain: 'XRPL',
    toChain: 'FLARE',
    asset: 'XRP',
    userWallet: '0x870f64E73e7D2dc5022b4b74e58C323b3148A984',
    amount: '0.0996'
  };

  console.log("🆕 STEP 1: Front-end requesting bridge...");
  const sessionData = await createBridgeSession(mockUserInput);

  // 🦅 Access the ID directly (handles both MongoDB object and Lean object)
  const sId = sessionData.sessionId || sessionData._id || sessionData.id;
  console.log(`✅ SESSION CREATED! Tag/Memo/ID: ${sId}`);

  // 3. ACT AS THE BLOCKCHAIN: Simulate a deposit hitting the vault
  console.log("🛰️ STEP 2: Simulating XRPL deposit detection...");
  const mockIncomingTx = {
    destinationTag: String(sId),
    hash: '0xSIMULATED_XRPL_HASH_12345',
    memo: String(sId)
  };

  // 4. ACT AS THE ORCHESTRATOR: Process the deposit
  // This triggers the logic that calls BridgeService.js
  try {
    console.log("⚡ TRIGGERING ORCHESTRATOR...");
    await handleInboundDeposit('XRPL', mockIncomingTx);
  } catch (err) {
    console.error("❌ ORCHESTRATOR ERROR:", err.message);
    // If you see the ENS error here, it means the Orchestrator 
    // needs the 'staticNetwork' flag in its provider setup too.
  }

  console.log("🏁 TEST FINISHED. Check logs for 'BRIDGE COMPLETE'.");
  
  // Give it a second to finish any async logging before closing
  setTimeout(() => process.exit(0), 2000);
}

// 🦅 IGNITION: This starts the test
runFullDynamicTest();

