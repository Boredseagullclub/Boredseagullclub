const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 STARTING SEAGULLCASH ISO SETTLEMENT ON XDC...");
  try {
    const hash = await settleOnChain(
      'xdc742A3dDb6CD35fF9C56111C110098f98A4D1A2B3', // Test XDC destination
      'SEAGULLCASH', 
      '50', 
      'XDC'
    );
    console.log("✅ SUCCESS! XDC Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}

runTest();
