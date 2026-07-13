const { ethers } = require('ethers');
const xrpl = require('xrpl');
const mongoose = require('mongoose');

// The REAL Ecosystem Registry
const REGS = {
    XDC_SGC:      '0xd38109f587bd0326cad60a18cf3c1ecd546809a6', // SeagullCoin on XDC
    FLR_SGC:      '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f', // SeagullCoin on Flare
    XRPL_SGC:     'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno',         // SeagullCoin on XRPL
    XRPL_SGCSH:   'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK',         // SeagullCash on XRPL
    HEDERA_SGCSH: '0.0.3115556',                                // SeagullCash on Hedera (HTS ID)
    STELLAR_SGCSH:'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7'
};

function getDbSafely() {
    if (mongoose.connection.readyState !== 1) {
        throw new Error("Mongoose is not fully connected to MongoDB yet.");
    }
    const targetDb = mongoose.connection.useDb('SeagullNet');
    if (!targetDb) {
        throw new Error("Failed to switch to the SeagullNet database instance.");
    }
    return targetDb;
}

/** * 🏛️ TASK A: INDEX NATIVE EVM HOLDERS (XDC & Flare)
 */
async function syncEvmHolders(chainKey, rpcUrl, contractAddress) {
    try {
        const db = getDbSafely();
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(contractAddress, [
            "event Transfer(address indexed from, address indexed to, uint256 value)",            
            "function balanceOf(address owner) view returns (uint256)"
        ], provider);

        const filter = contract.filters.Transfer();
                const latestBlock = await provider.getBlockNumber();
        const uniqueAddresses = new Set();

        const targetLookback = chainKey.toUpperCase() === 'FLARE' ? 2000000 : 100000;
        const chunkSize = 1000;

        let currentMax = latestBlock;
        let totalScanned = 0;

        while (totalScanned < targetLookback) {
            let fromBlock = currentMax - chunkSize;
            if (fromBlock < 0) fromBlock = 0;

            try {
                const chunkLogs = await contract.queryFilter(filter, fromBlock, currentMax);
                chunkLogs.forEach(log => {
                    if (log.args) {
                        uniqueAddresses.add(log.args.from);
                        uniqueAddresses.add(log.args.to);
                    }
                });

            } catch (rpcErr) {
                // If a chunk fails, log it and keep moving so the script doesn't crash
                console.warn(`[INDEXER] Chunk ${fromBlock}-${currentMax} skipped:`, rpcErr.message);
            }

            currentMax = fromBlock - 1;
            totalScanned += chunkSize;
            if (fromBlock === 0) break;
        }


        const bulkOps = [];
        for (const wallet of uniqueAddresses) {
            if (!wallet || wallet === ethers.ZeroAddress) continue;
            try {
                const rawBal = await contract.balanceOf(wallet);
                const cleanBal = parseFloat(ethers.formatEther(rawBal));

                bulkOps.push({
                    updateOne: {
                        filter: { walletAddress: wallet.toLowerCase() },                          
                        update: { $set: { balance: cleanBal, lastUpdated: new Date() } },
                        upsert: true
                    }
                });
            } catch (e) {
                console.error(`[INDEXER ERROR] Failed fetching balance for wallet ${wallet}:`, e.message);
            }
        }

        if (bulkOps.length > 0) {
            const colName = `${chainKey.toLowerCase()}_holders`;
            const result = await db.collection(colName).bulkWrite(bulkOps);
            console.log(`[INDEXER SUCCESS] Synced ${result.upsertedCount + result.modifiedCount} records to ${colName}`);
        } else {
            console.log(`[INDEXER info] No recent EVM transfers found for ${chainKey}`);
        }
    } catch (err) {
        console.error(`[INDEXER CRITICAL] EVM Sync failed for ${chainKey}:`, err.message);        
    }
}

/**
 * 🏛️ TASK B: INDEX NATIVE XRPL TRUSTLINE HOLDERS (SGC & SGCSH)
 * 🎯 FIXED: Implements an infinite page marker traversal loop to gra[Bb ALL accounts on the ledger
 */
async function syncXrplHolders(ticker, issuerAddress) {
    let client;
    try {
        const db = getDbSafely();
        client = new xrpl.Client("wss://xrpl.ws");
        await client.connect();

        let marker = undefined;
        let allLines = [];

        // Loop and exhaust the ledger page streams completely
        do {
            const response = await client.request({
                command: "account_lines",
                account: issuerAddress,
                limit: 400,
                marker: marker
            });

            if (response.result && response.result.lines) {
                allLines.push(...response.result.lines);
            }
            marker = response.result.marker;
        } while (marker);

        console.log(`[INDEXER INFO] Retrieved total of ${allLines.length} live trustline structures for ${ticker}`);

        const bulkOps = allLines.map(line => {
            const verifiedPositiveBalance = Math.abs(parseFloat(line.balance) * -1);
            return {
                updateOne: {
                    filter: { walletAddress: line.account },
                    update: { $set: { balance: verifiedPositiveBalance, lastUpdated: new Date() } },
                    upsert: true
                }
            };
        });

        if (bulkOps.length > 0) {
            const colName = `xrpl_${ticker.toLowerCase()}_holders`;
            const result = await db.collection(colName).bulkWrite(bulkOps);
            console.log(`[INDEXER SUCCESS] Fully Synced ${result.upsertedCount + result.modifiedCount} complete trustlines into ${colName}`);
        }
    } catch (err) {
        console.error(`[INDEXER CRITICAL] XRPL sync failed for ${ticker}:`, err.message);
    } finally {
        if (client) await client.disconnect();
    }
}

/**
 * 🏛️ TASK C: INDEX NATIVE STELLAR CASH HOLDERS (Only SGCSH)
 * 🎯 FIXED: Navigates Horizon's cursor pagination to harvest thousands of addresses
 */
async function syncStellarCash(issuerAddress) {
    try {
        const db = getDbSafely();
        let url = `https://horizon.stellar.org/accounts?asset=SGCSH%3A${issuerAddress}&limit=200`;
        let bulkOps = [];

        while (url) {
            const res = await fetch(url);
            if (res.status !== 200) throw new Error(`Horizon API returned status ${res.status}`);
            const data = await res.json();
            const accounts = data._embedded?.records || [];

            if (accounts.length === 0) break;

            accounts.forEach(acc => {
                const targetBal = acc.balances.find(b => String(b.asset_code).toUpperCase() === 'SGCSH' && b.asset_issuer === issuerAddress);
                bulkOps.push({
                    updateOne: {
                        filter: { walletAddress: acc.account_id },                                
                        update: { $set: { balance: targetBal ? parseFloat(targetBal.balance) : 0, lastUpdated: new Date() } },
                        upsert: true
                    }
                });
            });

            // Point to the next data cursor string if it exists
            url = data._links?.next?.href || null;
        }

        if (bulkOps.length > 0) {
            const result = await db.collection('stellar_sgcsh_holders').bulkWrite(bulkOps);       
            console.log(`[INDEXER SUCCESS] Synced ${bulkOps.length} global records to stellar_sgcsh_holders`);
        }
    } catch (err) {
        console.error(`[INDEXER CRITICAL] Stellar snapshot failed:`, err.message);                
    }
}


/**
 * 🏛️ TASK D: INDEX NATIVE HEDERA CASH HOLDERS (Only SGCSH)
 * 🎯 FIXED: Iterates across the Hedera Mirror next link array boundaries to secure every single balance
 */
async function syncHederaCash(tokenId) {
    try {
        const db = getDbSafely();
        let url = `https://mainnet.mirrornode.hedera.com/api/v1/tokens/${tokenId}/balances?limit=100&order=desc`;
        let bulkOps = [];

        while (url) {
            const res = await fetch(url);
            if (res.status !== 200) throw new Error(`Hedera Mirror API returned status ${res.status}`);
            const data = await res.json();
            const holderList = data.balances || [];

            if (holderList.length === 0) break;

            holderList.forEach(item => {
                bulkOps.push({
                    updateOne: {
                        filter: { walletAddress: item.account },
                        update: { $set: { balance: parseFloat(item.balance) / 1000000, lastUpdated: new Date() } },
                        upsert: true
                    }
                });
            });

            url = data.links?.next ? `https://mainnet.mirrornode.hedera.com${data.links.next}` : null;
        }

        if (bulkOps.length > 0) {
            const result = await db.collection('hedera_sgcsh_holders').bulkWrite(bulkOps);        
            console.log(`[INDEXER SUCCESS] Synced ${bulkOps.length} comprehensive records to hedera_sgcsh_holders`);
        }
    } catch (err) {
        console.error(`[INDEXER CRITICAL] Hedera snapshot failed:`, err.message);                 
    }
}

async function triggerGlobalEcosystemSync() {
    console.log(`[${new Date().toISOString()}] 🚀 Initiating Strict Multi-Chain Holder Sync...`); 
    try {
        getDbSafely();

        // 1. SeagullCoin Track (SGC)
        await syncEvmHolders('XDC', 'https://erpc.xinfin.network', REGS.XDC_SGC);
        await syncEvmHolders('FLARE', 'https://rpc.ankr.com/flare', REGS.FLR_SGC);
        await syncXrplHolders('SGC', REGS.XRPL_SGC);

        // 2. SeagullCash Track (SGCSH)
        await syncXrplHolders('SGCSH', REGS.XRPL_SGCSH);
        await syncStellarCash(REGS.STELLAR_SGCSH);
        await syncHederaCash(REGS.HEDERA_SGCSH);

        console.log(`[${new Date().toISOString()}] 🏁 All sync operational loops executed.`);     
    } catch (dbErr) {
        console.error("[INDEXER ABORTED] Database driver state unready:", dbErr.message);
    }
}

module.exports = { triggerGlobalEcosystemSync };
