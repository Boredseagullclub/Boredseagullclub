const mongoose = require('mongoose');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Decimal = require('decimal.js');

async function creditDeposits() {
  while (true) {
    const deposit = await Deposit.findOneAndUpdate(
      {
        status: 'DETECTED',
        processing: { $ne: true }
      },
      { $set: { processing: true } },
      { new: true }
    );

    if (!deposit) {
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    try {
      const amount = new Decimal(deposit.amount.toString());

      // 🔥 ATOMIC BALANCE CREDIT
      await User.updateOne(
        { _id: deposit.userId },
        {
          $inc: {
            [`balances.${deposit.token}`]: Number(amount)
          }
        }
      );

      // ✅ mark credited
      await Deposit.updateOne(
        { _id: deposit._id },
        { $set: { status: 'CREDITED', processing: false } }
      );

    } catch (err) {
      await Deposit.updateOne(
        { _id: deposit._id },
        { $set: { processing: false } }
      );
    }
  }
}

module.exports = creditDeposits;
