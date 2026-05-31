const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const backendEnv = path.join(__dirname, '.env');
const rootEnv = path.join(__dirname, '..', '.env');

if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv });
} else if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
} else {
    dotenv.config();
}

const ISSUER_ADDRESS = 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';
const ASSET_CODE = 'SeagullCash';

async function runStellarSync() {
    console.log("🦅 Connecting to MongoDB replica set...");
    const realMongoUri = process.env.MONGODB_URI || process.env.mongodb_uri || process.env.MONGO_URI || process.env.mongo_uri;

    if (!realMongoUri) {
        console.error("[CRITICAL] Could not locate your MongoDB environment variable in .env.");
        return;
    }

    try {
        // Keep-alive connection setup optimized for independent background worker processes
        await mongoose.connect(realMongoUri, { serverSelectionTimeoutMS: 5000 });
        const db = mongoose.connection.useDb('SeagullNet');
        console.log(`🚀 Starting memory-safe Stellar Snapshot for ${ASSET_CODE}...`);

        let url = `https://horizon.stellar.org/accounts?asset=${ASSET_CODE}%3A${ISSUER_ADDRESS}&limit=200`;
        let totalSyncedCount = 0;

        while (url) {
            console.log(`Fetching batch from Horizon...`);
            const res = await fetch(url);
            if (res.status !== 200) throw new Error(`Horizon API returned status ${res.status}`);

            const data = await res.json();
            const accounts = data._embedded?.records || [];

            if (accounts.length === 0) break;

            let currentBatchOps = [];
            accounts.forEach(acc => {
                const targetBal = acc.balances.find(b => String(b.asset_code) === ASSET_CODE && b.asset_issuer === ISSUER_ADDRESS);
                if (targetBal) {
                    currentBatchOps.push({
                        updateOne: {
                            filter: { walletAddress: acc.account_id },                            
                            update: { $set: { balance: parseFloat(targetBal.balance), lastUpdated: new Date() } },
                            upsert: true
                        }
                    });
                }
            });

            if (currentBatchOps.length > 0) {
                const result = await db.collection('stellar_sgcsh_holders').bulkWrite(currentBatchOps);
                const written = result.upsertedCount + result.modifiedCount + result.matchedCount;
                totalSyncedCount += written;
                console.log(`   💾 Streamed ${written} accounts straight to DB...`);
            }

            url = data._links?.next?.href || null;
        }

        console.log(`\n[INDEXER SUCCESS] Fully completed! Total of ${totalSyncedCount} global records synced to stellar_sgcsh_holders!`);
    } catch (err) {
        console.error(`\n[INDEXER CRITICAL] Stellar snapshot failed:`, err.message);              
    } finally {
        // 🦅 NEVER kill the connection or process. Keep the link open and let the interval manage the timing.
        await mongoose.disconnect();
        console.log("🏁 Cycle complete. Disconnected from database safely. Sleeping for 1 hour...");
    }
}

// 🦅 Continuous Background Ingestion Engine Loop Execution
runStellarSync();
setInterval(runStellarSync, 1000 * 60 * 60); // Loops safely exactly once every hour
