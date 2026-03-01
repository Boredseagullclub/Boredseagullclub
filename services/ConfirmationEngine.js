const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Per-chain confirmation modules
const chainConfirmations = {
  FLR: require('./ChainConfirmations/evm'),
  XDC: require('./ChainConfirmations/evm'),
  XRPL: require('./ChainConfirmations/xrpl'),
  XLM: require('./ChainConfirmations/stellar'),
  HBAR: require('./ChainConfirmations/hedera'),
};

// Wrap transactions
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    session.endSession();
    return result;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

// Helper to credit user balances
async function creditUser(user, token, amount, session) {
  user.balances.set(token, Number(user.balances.get(token) || 0) + amount);
  await user.save({ session });
}

// Process a single deposit with retries
async function processDeposit(dep, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await withTransaction(async (session) => {
        const locked = await Deposit.findOneAndUpdate(
          { _id: dep._id, status: 'DETECTED' },
          { status: 'PROCESSING' },
          { session, new: true }
        );
        if (!locked) {
          logger.warn(`[DepositEngine] Deposit ${dep._id} already locked, skipping`);
          return;
        }

        logger.info(`[DepositEngine] Processing ${dep._id} on ${dep.chain} (attempt ${attempt})`);

        const confirmFn = chainConfirmations[dep.chain];
        if (!confirmFn) throw new Error('Unsupported chain');

        const confirmed = await confirmFn(dep);
        if (!confirmed) {
          await Deposit.updateOne({ _id: dep._id }, { status: 'DETECTED' }, { session });
          logger.info(`[DepositEngine] Deposit ${dep._id} not yet confirmed`);
          return;
        }

        const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
        if (!user) throw new Error('User not found');

        await creditUser(user, dep.token, dep.amount, session);

        await Deposit.updateOne({ _id: dep._id }, { status: 'CREDITED' }, { session });

        logger.info(`[DepositEngine] Deposit ${dep._id} credited successfully`);
      });

      break; // Exit retry loop if successful
    } catch (err) {
      logger.error(`[DepositEngine] Failed to process ${dep._id} on attempt ${attempt}: ${err.message}`);
      if (attempt === maxRetries) {
        await Deposit.updateOne({ _id: dep._id }, { status: 'FAILED' });
        logger.error(`[DepositEngine] Deposit ${dep._id} marked as FAILED after ${maxRetries} attempts`);
      } else {
        // Optional: wait before retrying
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(50);

  for (const dep of deposits) {
    await processDeposit(dep);
  }
}

module.exports = { runConfirmationCycle };
