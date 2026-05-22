const User = require('../models/User');
const Deposit = require('../models/Deposit');
const logger = require('../logger');
const mongoose = require('mongoose');

/**
 * 💓 HEARTBEAT: Quick health check of the engine
 */
async function getEngineStatus() {
  const stats = await Deposit.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$amount" } } }
  ]);
  
  return {
    timestamp: new Date(),
    stats: stats.reduce((acc, curr) => {
      acc[curr._id] = { count: curr.count, value: curr.total.toString() };
      return acc;
    }, {})
  };
}

/**
 * 📸 DAILY SNAPSHOT: The "Audit Trail"
 * Saves a simplified record of all user balances once per day.
 */
async function performDailyBalanceSnapshot() {
  const users = await User.find({}, 'balances publicAddress').lean();
  
  const snapshotEntry = users.map(u => ({
    userId: u._id,
    address: u.publicAddress,
    balances: u.balances,
    capturedAt: new Date()
  }));

  // Save this to a 'BalanceSnapshots' collection
  try {
    await mongoose.connection.collection('balance_snapshots').insertMany(snapshotEntry);
    logger.info({ module: 'Audit', event: 'daily_snapshot_success', userCount: users.length });
  } catch (err) {
    logger.error({ module: 'Audit', event: 'daily_snapshot_fail', error: err.message });
  }
}

module.exports = { getEngineStatus, performDailyBalanceSnapshot };
