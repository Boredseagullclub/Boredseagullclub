const mongoose = require('mongoose');
const Withdrawal = require('../models/Withdrawal');
const { executeOnChainPayout } = require('../services/payoutEngine');

console.log("🚀 PAYOUT ENGINE: Initializing Process...");

async function startWorker() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error("❌ FATAL: MONGO_URI is missing from environment!");
      process.exit(1);
    }

    console.log("🛠️  CONNECTING: Attempting handshake with MongoDB...");
    
    // Connect to MongoDB
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log("✅ CONNECTED: Monitoring bridge_db for PENDING payouts...");

    // THE INFINITE LOOP: This keeps the container ALIVE
    while (true) {
      try {
        const pending = await Withdrawal.findOne({ status: 'PENDING' });
        
        if (pending) {
          console.log(`🎯 TARGET ACQUIRED: Memo ${pending.memo}. Executing payout...`);
          await executeOnChainPayout(pending._id);
        }
      } catch (loopErr) {
        console.error("⚠️  LOOP ERROR:", loopErr.message);
      }

      // Wait 15 seconds before checking again
      await new Promise(r => setTimeout(r, 15000));
    }
  } catch (err) {
    console.error("❌ FATAL BOOT ERROR:", err.message);
    process.exit(1);
  }
}

// THIS IS THE "STARTER CORD" - It kicks off the function above
startWorker().catch(err => {
  console.error("❌ UNHANDLED BOOT ERROR:", err);
  process.exit(1);
});

