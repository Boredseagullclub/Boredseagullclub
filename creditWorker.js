const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * 🔥 THE REFINED CREDITOR
 * Uses MongoDB ACID Transactions to ensure balances and deposit 
 * statuses are updated together or not at all.
 */
async function creditDeposits() {
  logger.info({ module: 'Creditor', event: 'start' });

  while (true) {
    // 1. Find a candidate without locking yet
    const deposit = await Deposit.findOne({
      status: 'DETECTED',
      processing: { $ne: true }
    });

    if (!deposit) {
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

        if (!lockedDeposit) {
          // Another worker thread/process beat us to it
          return;
        }

        // 3. Atomic Credit
        // We pass lockedDeposit.amount (Decimal128) directly to $inc.
        // MongoDB handles Decimal128 math natively, preserving all 18+ decimals.
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

      // Reset the processing flag so the background worker can try again
      try {
        await Deposit.updateOne(
          { _id: deposit._id },
          { $set: { processing: false, errorMessage: err.message } }
        );
      } catch (resetErr) {
        logger.error('Failed to reset processing flag:', resetErr.message);
      }
    } finally {
      session.endSession();
    }
  }
}

module.exports = creditDeposits;
