require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("🔒 SECURITY EXCEPTION: MONGODB_URI environment variable is missing.");
  console.error("❌ Execution terminated. Verify your encrypted configuration.");
  process.exit(1);
}

async function forceInjectStellarHistory() {
  console.log("🦅 RATIO ARCHIVER: Initializing STELLAR (SGH_XLM) historical chart layer generation...");

  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    console.log("🛰️ Secure database layer synchronized successfully.");

    const bulkDocs = [];
    const now = new Date();
    const DAYS_TO_BACKPOPULATE = 1095; // 3 years matching the XRPL canvas

    // --- STELLAR SGH_XLM BASELINE TARGET ---
    const BASE_SGH_XLM = 0.0000000038;

    // Generate the array of objects first, exactly as your original pipeline did
    for (let i = DAYS_TO_BACKPOPULATE; i >= 1; i--) {
      const targetDate = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));

      // Independent wave factor oscillation for Stellar trends
      const waveFactor = Math.sin(i / 12) * 0.10; // Max 10% swing variance
      const noiseSGH_XLM = (Math.random() - 0.5) * 0.03; // 3% granular micro noise

      const historicalSGH_XLM = parseFloat((BASE_SGH_XLM * (1 + waveFactor + noiseSGH_XLM)).toFixed(11));

      bulkDocs.push({
        timestamp: targetDate,
        SGH_XLM: historicalSGH_XLM
      });
    }

    console.log(`📦 Generated ${bulkDocs.length} Stellar historical coordinates. Committing safe merge updates...`);

    let totalUpdated = 0;

    // 🦅 ATOMIC DATABASE MERGE ENGINE
    // Loops through the generated records and safely updates ONLY the Stellar field per day
    for (let doc of bulkDocs) {
      const targetDate = new Date(doc.timestamp);
      targetDate.setUTCHours(0, 0, 0, 0); // Strict daily alignment matching database schema

      await db.collection('price_history').updateOne(
        { timestamp: targetDate },
        { 
          $set: { 
            timestamp: targetDate,
            SGH_XLM: doc.SGH_XLM // Updates only Stellar; leaves other asset data fully intact
          } 
        },
        { upsert: true } // Creates the daily document if it's missing, updates it if it exists
      );

      totalUpdated++;
      
      if (totalUpdated % 100 === 0 || totalUpdated === bulkDocs.length) {
        console.log(`⚡ Secure Progress: Merged Stellar records ${totalUpdated}/${bulkDocs.length}...`);
      }
    }

    console.log(`🏁 SUCCESS: All ${totalUpdated} Stellar coordinates successfully etched into price_history!`);
  } catch (err) {
    console.error("❌ INJECTION CRITICAL FAILURE:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Secure database pipeline closed cleanly.");
    process.exit(0);
  }
}

forceInjectStellarHistory();
