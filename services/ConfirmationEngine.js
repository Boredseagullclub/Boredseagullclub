const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');

// Per-chain confirmation modules
const chainConfirmations = {
  FLR: require('./ChainConfirmations/evm'),
  XDC: require('./ChainConfirmations/evm'),
  XRPL: require('./ChainConfirmations/xrpl'),
  XLM: require('./ChainConfirmations/stellar'),
  HBAR: require('./ChainConfirmations/hedera'),
};

// Helper to credit user balances
async function creditUser(user, token, amount, session) {
  user.balances.set(token, Number(user.balances.get(token) || 0) + amount);
  await user.save({ session });
}

async function processDeposit(dep) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Lock deposit
    const locked = await Deposit.findOneAndUpdate(
      { _id: dep._id, status: 'DETECTED' },
      { status: 'PROCESSING' },
      { session, new: true }
    );

    if (!locked) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    console.log(`[DepositEngine] Processing ${dep._id} on ${dep.chain}`);

    // Get the confirmation function from map
    const confirmFn = chainConfirmations[dep.chain];
    if (!confirmFn) throw new Error('Unsupported chain');

    const confirmed = await confirmFn(dep);

    if (!confirmed) {
      await Deposit.updateOne({ _id: dep._id }, { status: 'DETECTED' }, { session });
      await session.commitTransaction();
      session.endSession();
      return;
    }

    // Credit user (idempotent)
    const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
    if (!user) throw new Error('User not found');

    await creditUser(user, dep.token, dep.amount, session);

    await Deposit.updateOne({ _id: dep._id }, { status: 'CREDITED' }, { session });

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    console.error(`[DepositEngine] Failed to process ${dep._id}:`, err.message);
    await Deposit.updateOne({ _id: dep._id }, { status: 'FAILED' });
  }
}

async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(50);

  for (const dep of deposits) {
    await processDeposit(dep);
  }
}

module.exports = { runConfirmationCycle };
