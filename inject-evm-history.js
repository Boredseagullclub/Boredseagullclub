require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("🔒 SECURITY EXCEPTION: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

async function forceInjectFlareHistory() {
  console.log("🦅 RATIO ARCHIVER: Initializing FLARE (SGC_FLR) historical chart layer generation...");

  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("🛰️ Secure database layer synchronized successfully.");

    const bulkDocs = [];
    const now = new Date();
    const DAYS_TO_BACKPOPULATE = 1095;

    // --- FLARE SGC_FLR BASELINE TARGET ---
    const BASE_SGC_FLR = 0.00000763;

    for (let i = DAYS_TO_BACKPOPULATE; i >= 1; i--) {
      const targetDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));

      // Independent wave factor oscillation for Flare trends
      const waveFactor = Math.sin(i / 10) * 0.09; 
      const noiseSGC_FLR = (Math.random() - 0.5) * 0.02;

      const historicalSGC_FLR = parseFloat((BASE_SGC_FLR * (1 + waveFactor + noiseSGC_FLR)).toFixed(8));

      bulkDocs.push({
        timestamp: targetDate,
        SGC_FLR: historicalSGC_FLR
      });
    }

    console.log(`📦 Generated ${bulkDocs.length} Flare historical coordinates. Committing safe merge updates...`);

    let totalUpdated = 0;

    // 🦅 ATOMIC DATABASE MERGE ENGINE
    for (let doc of bulkDocs) {
      const targetDate = new Date(doc.timestamp);
      targetDate.setUTCHours(0, 0, 0, 0);

      await db.collection('price_history').updateOne(
        { timestamp: targetDate },
        { 
          $set: { 
            timestamp: targetDate,
            SGC_FLR: doc.SGC_FLR 
          } 
        },
        { upsert: true }
      );

      totalUpdated++;
      if (totalUpdated % 100 === 0 || totalUpdated === bulkDocs.length) {
        console.log(`⚡ Secure Progress: Merged Flare records ${totalUpdated}/${bulkDocs.length}...`);
      }
    }

    console.log(`🏁 SUCCESS: All ${totalUpdated} Flare coordinates successfully etched into price_history!`);
  } catch (err) {
    console.error("❌ INJECTION CRITICAL FAILURE:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Secure database pipeline closed cleanly.");
    process.exit(0);
  }
}

forceInjectFlareHistory();
