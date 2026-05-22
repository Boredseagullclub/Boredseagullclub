const mongoose = require('mongoose');

// Adjust this URI if your app uses a different connection string or database name
const MONGO_URI = ""; 

async function runTest() {
  try {
    console.log("Connecting to database...");
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    console.log("Connected successfully to:", db.databaseName);

    const targetWallet = "0x870f64e73e7d2dc5022b4b74e58c323b3148a984";
    
    console.log(`\nAttempting to update/upsert kycStatus to TIER_2_INSTITUTIONAL in 'users' collection...`);
    
    const result = await db.collection('users').updateOne(
      { walletAddress: targetWallet },
      {
        $set: {
          walletAddress: targetWallet,
          publicAddress: targetWallet, // Populating the unique index field
          kycStatus: "TIER_2_INSTITUTIONAL",
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log("Database response:", result);

    console.log("\nVerifying the saved document...");
    const verifiedDoc = await db.collection('users').findOne({ walletAddress: targetWallet });
    console.log("Document in DB:", verifiedDoc);

  } catch (error) {
    console.error("\n❌ DATABASE WRITE FAILED!");
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from DB.");
  }
}

runTest();
