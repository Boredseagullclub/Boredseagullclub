const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const axios = require('axios'); // for Slack alerts

// Per-chain confirmation modules
const chainConfirmations = {
  FLR: require('./ChainConfirmations/evm'),
  XDC: require('./ChainConfirmations/evm'),
  XRPL: require('./ChainConfirmations/xrpl'),
  XLM: require('./ChainConfirmations/stellar'),
  HBAR: require('./ChainConfirmations/hedera'),
};

// Slack webhook for alerts
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;


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

// Slack alert helper
async function sendSlackAlert(message) {
  if (!SLACK_WEBHOOK) return;
  try {
    await axios.post(SLACK_WEBHOOK, { text: message });
  } catch (err) {
    logger.error(`[DepositEngine] Failed to send Slack alert: ${err.message}`);
  }
}

// Process a single deposit with retries
async function processDeposit(dep, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTransaction(async (session) => {
        const locked = await Deposit.findOneAndUpdate(
          { _id: dep._id, status: 'DETECTED' },
          { status: 'PROCESSING' },
          { session, new: true }
        );

        if (!locked) {
          logger.warn(`[DepositEngine] Deposit ${dep._id} already locked, skipping`);
          return 'SKIPPED';
        }

        logger.info(`[DepositEngine] Processing ${dep._id} on ${dep.chain} (attempt ${attempt})`);

        const confirmFn = chainConfirmations[dep.chain];
        if (!confirmFn) throw new Error('Unsupported chain');

        const confirmed = await confirmFn(dep);
        if (!confirmed) {
          await Deposit.updateOne(
            { _id: dep._id },
            { status: 'DETECTED' },
            { session }
          );
          logger.info(`[DepositEngine] Deposit ${dep._id} not yet confirmed`);
          return 'SKIPPED';
        }

        const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
        if (!user) throw new Error('User not found');

        await creditUser(user, dep.token, dep.amount, session);

        await Deposit.updateOne(
          { _id: dep._id },
          { status: 'CREDITED' },
          { session }
        );

        logger.info(`[DepositEngine] Deposit ${dep._id} credited successfully`);
        return 'CREDITED';
      });

      return result;

    } catch (err) {
      logger.error(`[DepositEngine] Failed to process ${dep._id} on attempt ${attempt}: ${err.message}`);

      if (attempt === maxRetries) {
        await Deposit.updateOne({ _id: dep._id }, { status: 'FAILED' });
        await sendSlackAlert(
          `[DepositEngine] ❌ Deposit ${dep._id} FAILED after ${maxRetries} attempts: ${err.message}`
        );
        return 'FAILED';
      }

      const delay = 1000 * 2 ** attempt;
      logger.info(`[DepositEngine] Retrying ${dep._id} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Run a confirmation cycle and log metrics
async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(50);

  const metrics = {
    processed: 0,
    credited: 0,
    failed: 0,
    skipped: 0,
  };

  for (const dep of deposits) {
    const result = await processDeposit(dep);
    metrics.processed++;

    if (result === 'CREDITED') metrics.credited++;
    if (result === 'FAILED') metrics.failed++;
    if (result === 'SKIPPED') metrics.skipped++;
  }

  logger.info({
    msg: '[DepositEngine] Confirmation cycle completed',
    metrics
  });
}

  module.exports = { runConfirmationCycle };
