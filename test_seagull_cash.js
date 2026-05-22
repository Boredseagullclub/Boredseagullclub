const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 STARTING SEAGULLCASH ISO SETTLEMENT...");
  try {
    const hash = await settleOnChain(
      'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', // Test destination
      'SEAGULLCASH', 
      '100', 
      'XRPL'
    );
    console.log("✅ SUCCESS! Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}

runTest();
