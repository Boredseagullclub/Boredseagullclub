/**
 * 🦅 SEAGULLNET: BOOMERANG & MAINTENANCE ENGINE
 * --------------------------------------------
 * 1. AUTO-REFUND: Scans for 'failed' status and returns funds to source address.
 * 2. TICKET EXPIRY: Ghosts 'AWAITING_DEPOSIT' tickets older than 24 hours.
 * 3. ISO ARCHIVAL: Records the refund event for the ISO Terminal audit trail.
 */

const mongoose = require('mongoose');
const cron = require('node-cron');
const logger = require('../logger');
const PayoutService = require('./payoutEngine');

// --- CONFIGURATION ---
const TICKET_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 Hours
const REFUND_CHECK_INTERVAL = '*/5 * * * *';   // Every 5 Minutes

async function runMaintenance() {
    // CRITICAL: Get the DB instance safely inside the loop
    const db = mongoose.connection.db;
    
    if (!db) {
        logger.error("❌ [BOOMERANG] Database connection not ready yet. Skipping loop.");
        return;
    }

    const startTime = Date.now();
    logger.info("🧹 [BOOMERANG] Starting Maintenance & Refund Loop...");

    try {
        // --- 1. THE GHOST PROTOCOL (Ticket Expiry) ---
        const expiryThreshold = new Date(Date.now() - TICKET_EXPIRY_MS);

        const ghostResult = await db.collection('deposits').updateMany(
            {
                status: 'AWAITING_DEPOSIT',
                createdAt: { $lt: expiryThreshold }
            },
            {
                $set: {
                    status: 'EXPIRED',
                    visible: false,
                    updatedAt: new Date()
                }
            }
        );

        if (ghostResult.modifiedCount > 0) {
            logger.info(`👻 [GHOST] Archived ${ghostResult.modifiedCount} stale tickets.`);
        }

        // --- 2. THE BOOMERANG (Auto-Refund) ---
        const failedVoyages = await db.collection('deposits').find({
            status: 'failed',
            refunded: { $ne: true },
            fromAddress: { $exists: true, $ne: "" },
            fromChain: { $exists: true }
        }).toArray();

        for (const record of failedVoyages) {
            try {
                logger.warn(`🔄 [BOOMERANG] Initiating Refund: ${record.amount} ${record.symbol} -> ${record.fromAddress}`);

                const refundResult = await PayoutService.sendRefund({
                    chain: record.fromChain,
                    to: record.fromAddress,
                    amount: record.amount,
                    memo: `REFUND_${record.memo || record.tag || 'SYSTEM'}`
                });

                if (refundResult && refundResult.hash) {
                    await db.collection('deposits').updateOne(
                        { _id: record._id },
                        {
                            $set: {
                                status: 'REFUNDED',
                                refunded: true,
                                refundTxHash: refundResult.hash,
                                updatedAt: new Date()
                            }
                        }
                    );

                    // 📜 ARCHIVE REFUND IN ISO TERMINAL (pacs.004)
                    await db.collection('iso_messages').insertOne({
                        messageType: 'pacs.004.001.09',
                        uetr: record.sourceTxHash,
                        originalUetr: record.sourceTxHash,
                        refundHash: refundResult.hash,
                        sender: "SEAGULL_HOT_WALLET",
                        receiver: record.fromAddress,
                        amount: record.amount,
                        currency: record.symbol,
                        reason: "Settlement Failure - Automated Boomerang",
                        timestamp: new Date()
                    });

                    logger.info(`✅ [BOOMERANG] Success! Refund Hash: ${refundResult.hash}`);
                }
            } catch (refundErr) {
                logger.error(`❌ [BOOMERANG] Refund Failed for ${record._id}: ${refundErr.message}`);
            }
        }

    } catch (err) {
        logger.error(`❌ [BOOMERANG] Critical Engine Failure: ${err.message}`);
    }

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`✨ [BOOMERANG] Loop finished in ${duration}s.`);
}

// --- INITIALIZE ENGINE (The "Anti-Race" Guard) ---
// We only start the cron and the first run AFTER mongoose is fully connected.
mongoose.connection.once('open', () => {
    logger.info("📡 [BOOMERANG] Connection verified. Janitor is on the clock.");
    
    // Schedule the heartbeat
    cron.schedule(REFUND_CHECK_INTERVAL, runMaintenance);

    // Initial run to clean up anything that happened while we were offline
    runMaintenance();
});

module.exports = { runMaintenance };
