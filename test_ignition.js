const { settleOnChain } = require('./services/bridgeService');

async function test() {
  console.log("🚀 IGNITING ISO 20022 SETTLEMENT...");
  try {
    // Correct Order: 1. Address, 2. Symbol, 3. Amount, 4. Chain
    const tx = await settleOnChain(
      'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 
      'XRP', 
      10, 
      'XRPL'
    );
    console.log("✅ SETTLEMENT SUCCESS! Hash:", tx);
  } catch (err) {
    console.error("❌ SETTLEMENT FAILED:", err.message);
  }
}

test();
