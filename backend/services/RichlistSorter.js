//A /root/Boredseagullclub/backend/services/RichlistSorter.js
const mongoose = require('mongoose');
                                                                   /**
 * Safely fetches the active SeagullNet database instance
 */
function getDb() {
    if (mongoose.connection.readyState !== 1) {
        throw new Error("Database not connected");                     }
    return mongoose.connection.useDb('SeagullNet');
}

/**
 * Resolves the exact, real collection name based on network and ticker criteria
 */
function getCollectionName(chain, ticker) {
    const normChain = chain.toUpperCase();
    const normTicker = ticker.toUpperCase();
                                                                       if (normChain === 'XDC') return 'xdc_holders';
    if (normChain === 'FLARE') return 'flare_holders';
    if (normChain === 'HEDERA') return 'hedera_sgcsh_holders';
    if (normChain === 'STELLAR') return 'stellar_sgcsh_holders';
    if (normChain === 'XRPL') {
        return normTicker === 'SGC' ? 'xrpl_sgc_holders' : 'xrpl_sgcsh_holders';
    }
    return null;
}

/**
 * Calculates a wallet's exact ranking position across all token holders
 */
async function calculateGlobalRank(chain, ticker, userBalance) {       if (!userBalance || parseFloat(userBalance) <= 0) return "Unranked (0 Balance)";

    try {
        const db = getDb();                                                const collectionName = getCollectionName(chain, ticker);
        if (!collectionName) return "N/A";

        const currentNum = parseFloat(userBalance);

        // 🎯 FIX: Convert string balance to double to accurately calculate how many wallets have more
        const whalesAhead = await db.collection(collectionName).countDocuments({
            $expr: { $gt: [{ $toDouble: "$balance" }, currentNum] }
        });                                                        
        return `#${whalesAhead + 1}`;                                  } catch (err) {
        console.warn(`⚠️ Ranking calculation bypassed for ${ticker}: ${err.message}`);
        return "N/A";                                                  }
}                                                                  
/**
 * Builds the top balance array records for leaderboards            */
async function getTopBalances(chain, ticker, limit = 10) {             try {
        const db = getDb();                                                const collectionName = getCollectionName(chain, ticker);
        if (!collectionName) return [];                            
        // 🎯 FIX: Run aggregation pipeline to convert strings to numbers before sorting by size
        return await db.collection(collectionName).aggregate([
            {
                $addFields: {                                                          numericBalance: { $toDouble: "$balance" }
                }
            },                                                                 { $sort: { numericBalance: -1 } },                                 { $limit: limit }
        ]).toArray();
    } catch (err) {
        console.error(`❌ Failed to retrieve richlist for ${chain}/${ticker}:`, err.message);
        return [];
    }
}

module.exports = {
    calculateGlobalRank,
    getTopBalances
};
