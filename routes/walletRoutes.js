const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Decimal = require('decimal.js');

const User = require('../models/User');
const Ledger = require('../models/Ledger');
const Withdrawal = require('../models/Withdrawal'); // You'll create this model next
const { checkAndLockQuota } = require('../services/quotaGuard');
const WalletService = require('../services/walletService');

/* --- Create Wallet --- */
router.post('/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) return res.status(400).send({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });
  if (!user) user = await User.create({ publicAddress });

  res.send({ success: true, wallet: user });
});

/* --- Withdrawal (With Daily Limits) --- */
router.post('/withdraw', async (req, res) => {
  const { walletAddress, token, amount, destination, chain } = req.body;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // 1. Check User & Balance
    const user = await User.findOne({ publicAddress: walletAddress }).session(session);
    if (!user) throw new Error('Wallet not found');

    const bal = user.balances.get(token);
    if (!bal || new Decimal(bal.toString()).lt(amount)) {
      throw new Error('Insufficient balance');
    }

    // 2. 🛡️ QUOTA CHECK (25M SeagullCash / 100k SeagullCoin)
    // If this fails, the whole transaction rolls back.
    await checkAndLockQuota(token, amount, session);

    // 3. Subtract Balance
    const newBal = new Decimal(bal.toString()).minus(amount).toString();
    user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal));
    await user.save({ session });

    // 4. Log the intent
    const withdrawal = await Withdrawal.create([{
      userId: user._id,
      token,
      amount: mongoose.Types.Decimal128.fromString(amount.toString()),
      toAddress: destination,
      chain,
      status: 'PROCESSING'
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // 5. 🚀 Trigger actual Blockchain Send (Asynchronous)
    WalletService.send(chain, destination, amount)
      .then(txHash => {
        Withdrawal.updateOne({ _id: withdrawal[0]._id }, { status: 'COMPLETED', txHash }).exec();
      })
      .catch(err => {
        Withdrawal.updateOne({ _id: withdrawal[0]._id }, { status: 'FAILED', error: err.message }).exec();
      });

    res.send({ success: true, message: 'Withdrawal processing', id: withdrawal[0]._id });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).send({ error: err.message });
  }
});

/* --- Balances --- */
router.get('/balances/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(404).json({ error: 'Wallet not found' });

  const formattedBalances = {};
  user.balances.forEach((val, key) => {
    formattedBalances[key] = val ? val.toString() : '0';
  });

  res.json({ balances: formattedBalances, tokens: user.tokens });
});

/* --- History --- */
router.get('/history/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  const history = await Ledger.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50);
  res.send(history);
});

module.exports = router;
