const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCASH ON HEDERA HASHGRAPH...");
  try {
    const dest = process.env.HEDERA_RECEIVER_ID; // Must be 0.0.xxxx
    const hash = await settleOnChain(dest, 'SEAGULLCASH', '1', 'HBAR');
    console.log("✅ SUCCESS! Hedera ID: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}
runTest();
