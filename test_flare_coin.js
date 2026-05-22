const { settleOnChain } = require('./services/BridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCOIN ISO SETTLEMENT ON FLARE...");
  try {
    const mockIsoHash = "0x" + require('crypto').randomBytes(32).toString('hex');
    const customerAddress = '0x870f64E73e7D2dc5022b4b74e58C323b3148A984'; // Burn or Test Address

    const hash = await settleOnChain(
      customerAddress, 
      'SEAGULLCOIN', 
      '0.1', 
      'FLARE', 
      mockIsoHash
    );

    console.log("✅ SUCCESS! Flare Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}
runTest();

