const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCOIN ON STELLAR...");
  try {
    // We pull the address directly inside the JS so there's no shell error
    const dest = process.env.BRIDGE_STELLAR_ISSUER_ADDRESS;
    if (!dest) throw new Error("BRIDGE_STELLAR_ISSUER_ADDRESS is missing in .env");

    const hash = await settleOnChain(
      dest, 
      'SEAGULLCOIN', 
      '1', 
      'XLM'
    );
    console.log("✅ SUCCESS! Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}
runTest();
