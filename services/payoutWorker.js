require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
// 🔴 ADD THIS LINE AT THE TOP (The "Hands")
const { executeOnChainPayout } = require('./payoutEngine'); 

async function processPayouts() {
  console.log("🦅 BRIDGE ONLINE: Monitoring for PENDING payouts...");
  while (true) {
    try {
      const job = await Transaction.findOne({ status: 'PENDING' });
      if (job) {
        console.log("🎯 TARGET ACQUIRED:", job._id, "| Memo:", job.memo);
        
        // 1. Flip the status so no other worker grabs it
        await Transaction.updateOne({ _id: job._id }, { $set: { status: 'PROCESSING' } });

        // 🔴 ADD THIS LINE HERE (The "Action")
        // This triggers the file we fixed with the sendTransaction command
        await executeOnChainPayout(job._id); 

        console.log("✅ TRANSACTION HANDLED.");
      } else {
        process.stdout.write("."); // Pulse to show life
      }
    } catch (err) {
      console.error("❌ LOOP ERROR:", err.message);
    }
    await new Promise(r => setTimeout(r, 5000)); // Sleep 5s
  }
}


// This is the "Orchestrator" lock
const start = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ DATABASE: Connected.");
    
    // We await this so the process NEVER exits
    await processPayouts(); 
  } catch (err) {
    console.error("❌ CRITICAL FAILURE:", err.message);
    process.exit(1);
  }
};

start();

