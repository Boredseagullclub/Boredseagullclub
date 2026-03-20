const mongoose = require('mongoose');
const config = require('../config/walletconfig');
const WalletStats = require('../models/WalletStats');
const logger = require('../utils/logger');

/**
 * 🛡️ The Treasury Guard
 * Ensures no token exceeds its daily hot-wallet outflow limit.
 */
async function checkAndLockQuota(token, amount, session) {
  const today = new Date().toISOString().split('T')[0];
  const limit = config.DAILY_LIMITS[token] || "1000"; 
  
  // 1. Find/Update today's tally
  const stats = await WalletStats.findOneAndUpdate(
    { chain: token, date: today },
    { $setOnInsert: { limit: limit } },
    { upsert: true, new: true, session }
  );

  const currentSent = parseFloat(stats.totalSent.toString());
  const requested = parseFloat(amount.toString());

  // 2. The Red Line Check
  if (currentSent + requested > parseFloat(limit)) {
    logger.error({
      event: 'QUOTA_EXCEEDED',
      token,
      requested,
      currentSent,
      limit
    });
    throw new Error(`🛑 DAILY LIMIT EXCEEDED: ${token} is capped at ${limit} daily.`);
  }

  // 3. Increment the tally
  await WalletStats.updateOne(
    { _id: stats._id },
    { $inc: { totalSent: mongoose.Types.Decimal128.fromString(amount.toString()) } },
    { session }
  );
  
  return true;
}

module.exports = { checkAndLockQuota };
