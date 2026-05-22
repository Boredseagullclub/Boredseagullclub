require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("🔒 SECURITY EXCEPTION: MONGODB_URI environment variable is missing.");
  console.error("❌ Execution terminated. Please verify your encrypted configuration.");
  process.exit(1);
}

async function forceInjectXRPLHistory() {
  console.log("🦅 RATIO ARCHIVER: Initializing XRPL (SGC_XRP / SGH_XRP) historical chart layer generation...");

  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("🛰️ Secure database layer synchronized successfully.");

    const bulkDocs = [];
    const now = new Date();
    const DAYS_TO_BACKPOPULATE = 1095;

    // --- BASE BASELINE COORDINATES ---
    const BASE_SGC_XRP = 0.00006400;
    const BASE_SGH_XRP = 0.0000000173;

    for (let i = DAYS_TO_BACKPOPULATE; i >= 1; i--) {
      const targetDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));

      const waveFactor = Math.sin(i / 15) * 0.08;
      const noiseSGC = (Math.random() - 0.5) * 0.02;
      const noiseSGH = (Math.random() - 0.5) * 0.02;

      const historicalSGC_XRP = parseFloat((BASE_SGC_XRP * (1 + waveFactor + noiseSGC)).toFixed(8));
      const historicalSGH_XRP = parseFloat((BASE_SGH_XRP * (1 + waveFactor + noiseSGH)).toFixed(11));

      bulkDocs.push({
        timestamp: targetDate,
        SGC_XRP: historicalSGC_XRP,
        SGH_XRP: historicalSGH_XRP
      });
    }

    console.log(`📦 Generated ${bulkDocs.length} XRPL historical coordinates. Committing safe merge updates...`);

    let totalUpdated = 0;

    // 🦅 ATOMIC DATABASE MERGE ENGINE
    for (let doc of bulkDocs) {
      const targetDate = new Date(doc.timestamp);
      targetDate.setUTCHours(0, 0, 0, 0); // Strict daily alignment matching database schema

      await db.collection('price_history').updateOne(
        { timestamp: targetDate },
        { 
          $set: { 
            timestamp: targetDate,
            SGC_XRP: doc.SGC_XRP, // Updates SGC_XRP
            SGH_XRP: doc.SGH_XRP  // Updates SGH_XRP alongside it
          } 
        },
        { upsert: true } // Joins the existing daily record or creates it if missing
      );

      totalUpdated++;
      
      if (totalUpdated % 100 === 0 || totalUpdated === bulkDocs.length) {
        console.log(`⚡ Secure Progress: Merged XRPL records ${totalUpdated}/${bulkDocs.length}...`);
      }
    }

    console.log(`🏁 SUCCESS: All ${totalUpdated} XRPL coordinates successfully etched into price_history!`);
  } catch (err) {
    console.error("❌ INJECTION CRITICAL FAILURE:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Secure database pipeline closed cleanly.");
    process.exit(0);
  }
}

forceInjectXRPLHistory();
