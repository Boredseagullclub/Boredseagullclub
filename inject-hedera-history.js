require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("🔒 SECURITY EXCEPTION: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

async function forceInjectHederaHistory() {
  console.log("🦅 RATIO ARCHIVER: Initializing HEDERA (SGH_HBAR) historical chart layer generation...");

  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("🛰️ Secure database layer synchronized successfully.");

    const bulkDocs = [];
    const now = new Date();
    const DAYS_TO_BACKPOPULATE = 1095;

    // --- HEDERA SGH_HBAR BASELINE TARGET ---
    const BASE_SGH_HBAR = 0.0000000019;

    // Generate the Hedera history data array
    for (let i = DAYS_TO_BACKPOPULATE; i >= 1; i--) {
      const targetDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));

      // Independent wave factor oscillation for Hedera
      const waveFactor = Math.cos(i / 14) * 0.11; // Max 11% swing variance
      const noiseSGH_HBAR = (Math.random() - 0.5) * 0.02;
      const historicalSGH_HBAR = parseFloat((BASE_SGH_HBAR * (1 + waveFactor + noiseSGH_HBAR)).toFixed(11));

      bulkDocs.push({
        timestamp: targetDate,
        SGH_HBAR: historicalSGH_HBAR
      });
    }

    console.log(`📦 Generated ${bulkDocs.length} Hedera historical coordinates. Committing safe merge updates...`);

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
            SGH_HBAR: doc.SGH_HBAR // Updates only Hedera; leaves Stellar, XRPL, and live data completely intact
          } 
        },
        { upsert: true }
      );

      totalUpdated++;
      
      if (totalUpdated % 100 === 0 || totalUpdated === bulkDocs.length) {
        console.log(`⚡ Secure Progress: Merged Hedera records ${totalUpdated}/${bulkDocs.length}...`);
      }
    }

    console.log(`🏁 SUCCESS: All ${totalUpdated} Hedera coordinates successfully etched into price_history!`);
  } catch (err) {
    console.error("❌ INJECTION CRITICAL FAILURE:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Secure database pipeline closed cleanly.");
    process.exit(0);
  }
}

forceInjectHederaHistory();
