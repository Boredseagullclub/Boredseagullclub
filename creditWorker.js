const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * 🛠️ SELF-HEALING: Unlock stuck deposits
 * Periodically resets deposits that have been "processing" for too long.
 * Broadened to catch both 'DETECTED' and 'CONFIRMED' states.
 */
async function unlockStuckDeposits() {
  const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60 * 1000);
  
  try {
    const result = await Deposit.updateMany(
      { 
        status: { $in: ['DETECTED', 'CONFIRMED'] }, 
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

  // Run cleanup every 5 minutes to release locks from crashed instances
  setInterval(unlockStuckDeposits, 5 * 60 * 1000);

  while (true) {
    // 1. Find a candidate based on chain-specific finality requirements
    // EVM: Needs external confirmation service to move DETECTED -> CONFIRMED
    // Non-EVM: Safe to process immediately upon detection
    const deposit = await Deposit.findOne({
      $or: [
        { status: 'CONFIRMED', chain: { $in: ['XDC', 'FLR'] } }, 
        { status: 'DETECTED', chain: { $in: ['XRP', 'XLM', 'HBAR'] } }
      ],
      processing: { $ne: true }
    });

    if (!deposit) {
      // 💡 Backoff: No deposits to process, wait to save CPU/DB hits
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // 2. Atomic Lock: Mirror the find query for safety
        const lockedDeposit = await Deposit.findOneAndUpdate(
          { 
            _id: deposit._id, 
            status: deposit.status, 
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
        // Increments balance and sets a heartbeat timestamp
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
        txHash: deposit.txHash,
        chain: deposit.chain
      });

    } catch (err) {
      logger.error({
        module: 'Creditor',
        event: 'credit_failed',
        depositId: deposit._id,
        error: err.message
      });

      // Reset the lock on failure so it can be retried or caught by cleanup
      try {
        await Deposit.updateOne(
          { _id: deposit._id },
          { $set: { processing: false, errorMessage: err.message } }
        );
      } catch (resetErr) {
        // Silent catch: setInterval cleanup handles this if DB connection is toggling
      }
    } finally {
      session.endSession();
    }
  }
}

module.exports = creditDeposits;
