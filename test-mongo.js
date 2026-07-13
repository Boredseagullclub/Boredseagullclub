require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGO_URI || process.env.DATABASE_URL;
if (!uri) {
  console.error("❌ ERROR: No MongoDB URI found in .env");
  process.exit(1);
}

// Mask password for safe terminal output
console.log("📡 Attempting to connect to:", uri.replace(/:([^:@]{3,})@/, ':***@'));

mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log("✅ MONGODB CONNECTION SUCCESS! The network is wide open.");
    process.exit(0);
  })
  .catch(err => {
    console.error("❌ MONGODB CONNECTION FAILED:");
    console.error(err.message);
    process.exit(1);
  });
