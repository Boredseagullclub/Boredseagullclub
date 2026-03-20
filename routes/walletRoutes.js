const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const { authenticateJWT } = require('../middleware/auth'); // assuming you have this from earlier

const User = require('../models/User');
const Ledger = require('../models/Ledger');
const Withdrawal = require('../models/Withdrawal');
const { checkAndLockQuota } = require('../services/quotaGuard');
const { executeOnChainPayout } = require('../services/payoutEngine'); // your payout file

/* --- Create Wallet --- */
router.post('/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) return res.status(400).json({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });
  if (!user) user = await User.create({ publicAddress });

  res.json({ success: true, wallet: user });
});

/* --- Withdrawal (With Daily Limits) --- */
router.post('/withdraw', authenticateJWT, async (req, res) => {
  const { token, amount, destination, chain } = req.body;

  // Basic input validation
  if (!token || !amount || !destination || !chain) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Load user
      const user = await User.findById(req.user.userId).session(session);
      if (!user) throw new Error('User not found');

      // 2. Balance check
      const bal = user.balances.get(token);
      if (!bal || new Decimal(bal.toString()).lt(amount)) {
        throw new Error('Insufficient balance');
      }

      // 3. Treasury quota check (atomic)
      await checkAndLockQuota(token, amount, session);

      // 4. Subtract balance
      const newBal = new Decimal(bal.toString()).minus(amount).toString();
      user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal));
      await user.save({ session });

      // 5. Create pending withdrawal
      const withdrawal = await Withdrawal.create([{
        userId: user._id,
        token,
        amount: mongoose.Types.Decimal128.fromString(amount.toString()),
        toAddress: destination,
        chain,
        status: 'PENDING',
        requestedAt: new Date()
      }], { session });

      await session.commitTransaction();

      // 6. Trigger payout asynchronously
      executeOnChainPayout(withdrawal[0]._id)
        .then(txHash => {
          Withdrawal.updateOne(
            { _id: withdrawal[0]._id },
            { status: 'COMPLETED', txHash }
          ).exec();
        })
        .catch(err => {
          Withdrawal.updateOne(
            { _id: withdrawal[0]._id },
            { status: 'FAILED', error: err.message }
          ).exec();
          logger.error({ event: 'payout_failed', withdrawalId: withdrawal[0]._id, error: err.message });
        });

      res.json({
        success: true,
        message: 'Withdrawal processing started',
        withdrawalId: withdrawal[0]._id
      });
    });
  } catch (err) {
    await session.abortTransaction();
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/* --- Balances --- */
router.get('/balances/:walletAddress', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(404).json({ error: 'Wallet not found' });

  const formattedBalances = {};
  user.balances.forEach((val, key) => {
    formattedBalances[key] = val ? val.toString() : '0';
  });

  res.json({ balances: formattedBalances, tokens: user.tokens });
});

/* --- History --- */
router.get('/history/:walletAddress', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(404).json({ error: 'Wallet not found' });

  const history = await Ledger
    .find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(history);
});

module.exports = router;
