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
  user.balances.set(
    token,
    BigInt(user.balances.get(token) || 0n) + BigInt(amount)
  );
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
          logger.warn({
            module: 'DepositEngine',
            depositId: dep._id,
            msg: 'Already locked or invalid state'
          });
          return 'SKIPPED';
        }

        logger.info({
          module: 'DepositEngine',
          depositId: dep._id,
          chain: dep.chain,
          attempt
        });

        const confirmFn = chainConfirmations[dep.chain];
        if (!confirmFn) throw new Error('Unsupported chain');

        const { confirmed, confirmations } = await confirmFn(dep);
        
        if (!confirmed) {
          await Deposit.updateOne(
  { _id: dep._id },
  { $set: { confirmations } },
  { session }
);
          return 'SKIPPED';
        }

        const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
        if (!user) throw new Error('User not found');

        await creditUser(user, dep.token, dep.amount, session);

        const updated = await Deposit.findOneAndUpdate(
  { _id: dep._id, status: 'PROCESSING' },
  { status: 'CREDITED', creditedAt: new Date() },
  { session, new: true }
);

if (!updated) throw new Error('Deposit state changed unexpectedly');

        logger.info({
          module: 'DepositEngine',
          depositId: dep._id,
          status: 'CREDITED'
        });

        return 'CREDITED';
      });

      return result;

    } catch (err) {

      logger.error({
        module: 'DepositEngine',
        depositId: dep._id,
        attempt,
        error: err.message
      });

      if (attempt === maxRetries) {
        await Deposit.updateOne(
          { _id: dep._id },
          { status: 'FAILED' }
        );

        await sendSlackAlert(
          `[DepositEngine] ❌ Deposit ${dep._id} FAILED after ${maxRetries} attempts: ${err.message}`
        );

        return 'FAILED';
      }

      const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
    }
  }
}


// runConfirmationCycle fixed
async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(50);

  const metrics = {
    processed: 0,
    credited: 0,
    failed: 0,
    skipped: 0,
  };

  for (let i = 0; i < deposits.length; i += 10) {
    const batch = deposits.slice(i, i + 10);

    const results = await Promise.allSettled(
      batch.map(dep => processDeposit(dep))
    );

    for (const r of results) {
      metrics.processed++;

      if (r.status === 'fulfilled') {
        if (r.value === 'CREDITED') metrics.credited++;
        else if (r.value === 'FAILED') metrics.failed++;
        else if (r.value === 'SKIPPED') metrics.skipped++;
      } else {
        metrics.failed++;
      }
    }
  }

  logger.info({
    module: 'DepositEngine',
    msg: 'Confirmation cycle completed',
    metrics
  });
}

  module.exports = { runConfirmationCycle };
