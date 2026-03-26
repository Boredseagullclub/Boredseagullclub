// services/ConfirmationEngine.js
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const logger = require('../utils/logger');
const axios = require('axios');

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

// Per-chain confirmation modules (these should exist or return simple {confirmed, confirmations})
const chainConfirmations = {
  FLR: require('./ChainConfirmations/evm'),
  XDC: require('./ChainConfirmations/evm'),
  XRPL: require('./ChainConfirmations/xrpl'),
  XLM: require('./ChainConfirmations/stellar'),
  HBAR: require('./ChainConfirmations/hedera'),
};

// Atomic transaction wrapper
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// Safe credit using Decimal.js
async function creditUser(user, token, amount, session) {
  const current = user.balances.get(token)
    ? new Decimal(user.balances.get(token).toString())
    : new Decimal(0);

  const delta = new Decimal(amount.toString()); // safe even if amount is Decimal128 string
  const newBalance = current.plus(delta);

  user.balances.set(token, mongoose.Types.Decimal128.fromString(newBalance.toFixed(18)));
  await user.save({ session });
}

// Slack alert
async function sendSlackAlert(message) {
  if (!SLACK_WEBHOOK) return;
  try {
    await axios.post(SLACK_WEBHOOK, { text: message });
  } catch (err) {
    logger.error(`[DepositEngine] Slack alert failed: ${err.message}`);
  }
}

// Process single deposit safely
async function processDeposit(dep) {
  if (!dep || dep.status !== 'DETECTED') return 'SKIPPED';

  return withTransaction(async (session) => {
    // Optimistic lock
    const locked = await Deposit.findOneAndUpdate(
      { _id: dep._id, status: 'DETECTED' },
      { status: 'PROCESSING' },
      { session, new: true }
    );

    if (!locked) {
      logger.warn({ module: 'DepositEngine', depositId: dep._id, msg: 'Already processed or locked' });
      return 'SKIPPED';
    }

    const confirmFn = chainConfirmations[dep.chain];
    if (!confirmFn) throw new Error(`Unsupported chain: ${dep.chain}`);

    const { confirmed, confirmations = 0 } = await confirmFn(dep);

    if (!confirmed) {
      await Deposit.updateOne(
        { _id: dep._id },
        { $set: { confirmations } },
        { session }
      );
      return 'SKIPPED';
    }

    const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
    if (!user) throw new Error('User not found for deposit');

    await creditUser(user, dep.token, dep.amount, session);

    const updated = await Deposit.findOneAndUpdate(
      { _id: dep._id, status: 'PROCESSING' },
      { status: 'CREDITED', creditedAt: new Date(), confirmations },
      { session, new: true }
    );

    if (!updated) throw new Error('Deposit state changed unexpectedly');

    logger.info({
      module: 'DepositEngine',
      depositId: dep._id,
      token: dep.token,
      amount: dep.amount.toString(),
      status: 'CREDITED'
    });

    return 'CREDITED';
  }).catch(async (err) => {
    logger.error({
      module: 'DepositEngine',
      depositId: dep._id,
      error: err.message
    });

    await Deposit.updateOne(
      { _id: dep._id },
      { status: 'FAILED', error: err.message }
    ).catch(() => {});

    await sendSlackAlert(`[DepositEngine] ❌ Deposit ${dep._id} FAILED: ${err.message}`);
    return 'FAILED';
  });
}

// Main cycle — called from app.js interval
async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(30); // conservative batch

  let processed = 0;
  for (const dep of deposits) {
    await processDeposit(dep);
    processed++;
  }

  if (processed > 0) {
    logger.info({
      module: 'DepositEngine',
      msg: 'Processed deposits',
      count: processed
    });
  }
}

module.exports = { runConfirmationCycle, processDeposit };
