const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCASH SETTLEMENT ON STELLAR...");
  try {
    // Replace this with a real destination G-address that has a Trustline
    const dest = process.env.BRIDGE_STELLAR_ISSUER_ADDRESS; 
    
    const hash = await settleOnChain(
      dest, 
      'SEAGULLCASH', 
      '5', // Sending 5 SeagullCash
      'XLM'
    );
    console.log("✅ SUCCESS! Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}
runTest();
