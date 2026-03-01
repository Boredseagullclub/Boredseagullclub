const Deposit = require('../models/Deposit');
const User = require('../models/User');
const mongoose = require('mongoose');

const confirmEvm = require('./ChainConfirmations/evm');
const confirmXrpl = require('./ChainConfirmations/xrpl');
const confirmStellar = require('./ChainConfirmations/stellar');
const confirmHedera = require('./ChainConfirmations/hedera');

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

    let confirmed = false;

    switch (dep.chain) {
      case 'FLR':
      case 'XDC':
        confirmed = await confirmEvm(dep);
        break;

      case 'XRPL':
        confirmed = await confirmXrpl(dep);
        break;

      case 'XLM':
        confirmed = await confirmStellar(dep);
        break;

      case 'HBAR':
        confirmed = await confirmHedera(dep);
        break;

      default:
        throw new Error('Unsupported chain');
    }

    if (!confirmed) {
      await Deposit.updateOne(
        { _id: dep._id },
        { status: 'DETECTED' },
        { session }
      );
      await session.commitTransaction();
      session.endSession();
      return;
    }

    // Credit user (idempotent)
    const user = await User.findOne({ publicAddress: dep.walletAddress }).session(session);
    if (!user) throw new Error('User not found');

    user.balances.set(
      dep.token,
      Number(user.balances.get(dep.token) || 0) + dep.amount
    );

    await user.save({ session });

    await Deposit.updateOne(
      { _id: dep._id },
      { status: 'CREDITED' },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    await Deposit.updateOne(
      { _id: dep._id },
      { status: 'FAILED' }
    );
  }
}

async function runConfirmationCycle() {
  const deposits = await Deposit.find({ status: 'DETECTED' }).limit(50);

  for (const dep of deposits) {
    await processDeposit(dep);
  }
}

module.exports = { runConfirmationCycle };
