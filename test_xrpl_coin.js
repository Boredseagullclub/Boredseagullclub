require('dotenv').config();
const { settleOnChain } = require('./services/bridgeService');

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCOIN ISO SETTLEMENT ON XRPL...");
  try {
    const hash = await settleOnChain(
      'rQrd9HrDAwq2ehHe9rNFLQMwoJ1G4puA55', // Your XRPL destination
      'SEAGULLCOIN', 
      '10', 
      'XRPL'
    );
    console.log("✅ SUCCESS! XRPL Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}

runTest();
