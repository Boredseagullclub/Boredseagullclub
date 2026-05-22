const { settleOnChain } = require('./services/bridgeService');
require('dotenv').config();

async function runTest() {
  console.log("🦅 IGNITING SEAGULLCOIN ISO SETTLEMENT ON XDC...");
  try {
    // ⚓ STEP 1: Define the ISO Hash (Your "Audit Trail")
    const mockIsoHash = "0xb998672d82078bc52aaafd8e1133b56277f526e3beeaaffea1f9eac0c6212cac";

    // 🎯 STEP 2: Change the destination to a DIFFERENT address
    // This is a "Burn" address to simulate a customer wallet
    const customerAddress = 'xdc870f64E73e7D2dc5022b4b74e58C323b3148A984';

    const hash = await settleOnChain(
      customerAddress,  // 1: Customer (NOT SELF)
      'SEAGULLCOIN',     // 2: Symbol
      '0.1',            // 3: Amount
      'XDC',            // 4: Chain
      mockIsoHash       // 5: THE ISO ANCHOR 🦅
    );

    console.log("✅ SUCCESS! XDC Hash: " + hash);
  } catch (err) {
    console.error("❌ FAILED: " + err.message);
  }
}
runTest();

