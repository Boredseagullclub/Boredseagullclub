const mongoose = require('mongoose');
const path = require('path');

// 🦅 SECURELY INGEST ENVIRONMENTAL VARIABLE CONFIGURATIONS
// Points straight to your core project .env folder location
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URI = process.env.MONGODB_URI;

async function seedHistoricalMatrix() {
  console.log("🦅 SEAGULL NET TIME-SERIES BACKFILLER: Initializing...");
  
  if (!MONGO_URI) {
    console.error("❌ SECURITY FAULT: MONGODB_URI is completely missing from your .env file!");
    process.exit(1);
  }
  
  try {
    // 🦅 Connect securely using your production credential string
    await mongoose.connect(MONGO_URI);
    console.log("📡 Secured MongoDB connection locked in cleanly via .env configuration.");
    
    const db = mongoose.connection.db;
    
    console.log("🗑 Wiping out old price_history data...");
    await db.collection('price_history').deleteMany({});
    console.log("✨ Collection cleared successfully.");

    const batchEntries = [];
    const nowMs = Date.now();
    const daysToBackfill = 180; // 6 months of historical data points
    
    console.log(`🚀 Generating ${daysToBackfill} days of high-fidelity historical matrices...`);

    for (let i = daysToBackfill; i > 0; i--) {
      const historicalDate = new Date(nowMs - (i * 24 * 60 * 60 * 1000));
      
      const seed = i * 0.15;
      const wave = Math.sin(seed) * 0.04;
      const secondaryNoise = Math.cos(seed * 2) * 0.015;

      const snapshot = {
        timestamp: historicalDate,
        SGC_XRP: parseFloat((0.00006400 * (1 + wave)).toFixed(8)),
        SGH_XRP: parseFloat((0.0000000173 * (1 + wave + secondaryNoise)).toFixed(11)),
        SGC_XDC: parseFloat((0.00001921 * (1 + wave * 0.5)).toFixed(8)),
        SGC_FLR: parseFloat((0.00000763 * (1 + wave * 0.8)).toFixed(8)),
        SGH_XLM: parseFloat((0.0000000038 * (1 + secondaryNoise)).toFixed(11)),
        SGH_HBAR: parseFloat((0.0000000019 * (1 + wave)).toFixed(11))
      };

      batchEntries.push(snapshot);
    }

    console.log(`💾 Injecting ${batchEntries.length} chronological rows into price_history collection...`);
    await db.collection('price_history').insertMany(batchEntries);
    
    console.log("🦅 SUCCESS! 6 Months of historical assets loaded perfectly with secure auth.");
  } catch (err) {
    console.error("❌ BACKFILL FAULTED:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Database connection closed safely.");
    process.exit(0);
  }
}

seedHistoricalMatrix();
