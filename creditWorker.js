const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * 🛠️ SELF-HEALING: Unlock stuck deposits
 * Periodically resets deposits that have been "processing" for too long.
 */
async function unlockStuckDeposits() {
  const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60 * 1000);
  
  try {
    const result = await Deposit.updateMany(
      { 
        status: 'DETECTED', 
        processing: true, 
        processingStartedAt: { $lt: FIVE_MINUTES_AGO } 
      },
      { 
        $set: { processing: false },
        $inc: { retryCount: 1 }
      }
    );
    
    if (result.modifiedCount > 0) {
      logger.warn({
        module: 'Creditor',
        event: 'cleanup_stuck_locks',
        count: result.modifiedCount
      });
    }
  } catch (err) {
    logger.error({ module: 'Creditor', event: 'cleanup_error', error: err.message });
  }
}

/**
 * 🔥 THE REFINED CREDITOR
 * Uses MongoDB ACID Transactions to ensure balances and deposit 
 * statuses are updated together or not at all.
 */
async function creditDeposits() {
  logger.info({ module: 'Creditor', event: 'start' });

  // Run cleanup every 5 minutes
  setInterval(unlockStuckDeposits, 5 * 60 * 1000);

  while (true) {
    // 1. Find a candidate without locking yet
    const deposit = await Deposit.findOne({
      status: 'DETECTED',
      processing: { $ne: true }
    });

    if (!deposit) {
      // 💡 Backoff: No deposits to process, wait longer to save CPU/DB hits
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // 2. Atomic Lock: Ensure no other worker instance grabs this specific deposit
        const lockedDeposit = await Deposit.findOneAndUpdate(
          { 
            _id: deposit._id, 
            status: 'DETECTED', 
            processing: { $ne: true } 
          },
          { 
            $set: { 
              processing: true,
              processingStartedAt: new Date()
            } 
          },
          { session, new: true }
        );

        if (!lockedDeposit) return;

        // 3. Atomic Credit
        // MongoDB handles Decimal128 math natively with $inc
        const userUpdate = await User.updateOne(
          { _id: lockedDeposit.userId },
          { 
            $inc: { [`balances.${lockedDeposit.token}`]: lockedDeposit.amount },
            $set: { lastBalanceUpdate: new Date() }
          },
          { session }
        );

        if (userUpdate.matchedCount === 0) {
          throw new Error(`User ${lockedDeposit.userId} not found for deposit ${lockedDeposit._id}`);
        }

        // 4. Finalize Deposit Status
        await Deposit.updateOne(
          { _id: lockedDeposit._id },
          { 
            $set: { 
              status: 'CREDITED', 
              processing: false,
              creditedAt: new Date() 
            } 
          },
          { session }
        );
      });

      logger.info({
        module: 'Creditor',
        event: 'credit_success',
        userId: deposit.userId,
        amount: deposit.amount.toString(),
        token: deposit.token,
        txHash: deposit.txHash
      });

    } catch (err) {
      logger.error({
        module: 'Creditor',
        event: 'credit_failed',
        depositId: deposit._id,
        error: err.message
      });

      // Manual reset on catch so it can be retried immediately if it was just a transient DB error
      try {
        await Deposit.updateOne(
          { _id: deposit._id },
          { $set: { processing: false, errorMessage: err.message } }
        );
      } catch (resetErr) {
        // Silent catch: the setInterval cleanup will eventually handle this if the DB is down
      }
    } finally {
      session.endSession();
    }
  }
}

module.exports = creditDeposits;
