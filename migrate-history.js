require('dotenv').config({ path: '/root/Boredseagullclub/.env' });
const mongoose = require('mongoose');

async function migrateHistory() {
  console.log("🦅 SEAGULL NET MIGRATION CORE: Starting database synchronization...");

  // Setup dual connection strings using your environment URI base
  const sourceConnection = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'seagull_db' }).asPromise();
  const targetConnection = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'SeagullNet' }).asPromise();

  try {
    const sourceCollection = sourceConnection.db.collection('price_history');
    const targetCollection = targetConnection.db.collection('price_history');

    // 1. WIPE SEAGULL NET FIRST
    console.log("🗑️ Purging old history collection from SeagullNet namespace...");
    await targetCollection.deleteMany({});
    console.log("🧹 Target collection in SeagullNet is completely clean.");

    // 2. READ PRISTINE STACK FROM SEAGULL_DB
    console.log("📦 Extracting high-fidelity candles from seagull_db...");
    const pristineData = await sourceCollection.find({}).sort({ timestamp: 1 }).toArray();

    if (pristineData.length === 0) {
      throw new Error("Source collection 'seagull_db' contains zero rows. Re-run your inject script first.");
    }

    console.log(`📡 Transferring ${pristineData.length} chronological historical nodes over to SeagullNet...`);

    // Remove old ObjectIds from the source documents so MongoDB builds fresh ones on insert
    const cleanPayload = pristineData.map(doc => {
      const { _id, ...cleanDoc } = doc;
      return cleanDoc;
    });

    // 3. EXECUTE THE TRANSFER BULK OPERATION
    const result = await targetCollection.insertMany(cleanPayload);
    console.log(`🏁 SUCCESS: Migration complete! Seeded ${result.insertedCount} pristine data blocks into SeagullNet.`);

  } catch (err) {
    console.error("\n❌ MIGRATION ENGINE ENCOUNTERED FAULT:", err.message);
  } finally {
    // Gracefully detach both database connections from the cluster pool
    await sourceConnection.close();
    await targetConnection.close();
    process.exit(0);
  }
}

migrateHistory();
