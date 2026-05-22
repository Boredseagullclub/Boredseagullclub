require('dotenv').config();
const { settleOnChain } = require('./services/bridgeService');

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCOIN ISO SETTLEMENT ON XRPL...");
  try {
    const hash = await settleOnChain(
      'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK', // Your XRPL destination
      'SEAGULLCASH', 
      '10', 
      'XRPL'
    );
    console.log("✅ SUCCESS! XRPL Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}

runTest();
