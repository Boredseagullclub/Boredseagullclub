const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const rateLimit = require('express-rate-limit');

const validateAddress = require('../middleware/validateAddress');
const { solvencyGuard } = require('../middleware/solvencyGuard');   // ← changed

const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { checkAndLockQuota } = require('../services/quotaGuard');
const { executeOnChainPayout } = require('../services/payoutEngine');
const logger = require('../logger');

// Rate limiters (good as-is)
const globalWithdrawLimiter = rateLimit({ validate: { xForwardedForHeader: false }, windowMs: 15 * 60 * 1000, max: 25, message: { error: 'Too many withdrawal requests — slow down' } });
const perUserWithdrawLimiter = rateLimit({ validate: { xForwardedForHeader: false }, windowMs: 60 * 60 * 1000, max: 10, keyGenerator: (req) => req.user?.userId || req.ip, skip: (req) => !req.user?.userId, message: { error: 'You have reached the hourly withdrawal limit' } });
const strictWithdrawLimiter = rateLimit({ validate: { xForwardedForHeader: false }, windowMs: 60 * 60 * 1000, max: 5, keyGenerator: (req) => req.user?.userId || req.ip, message: { error: 'Withdrawal rate limit reached — wait 1 hour' } });

// Create Wallet (public)
router.post('/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) return res.status(400).json({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });
  if (!user) user = await User.create({ publicAddress });

  res.json({ success: true, userId: user._id });
});

// Withdrawal
router.post(
  '/withdraw',
  (req, res, next) => req.app.locals.authenticateJWT(req, res, next),
  globalWithdrawLimiter,
  perUserWithdrawLimiter,
  strictWithdrawLimiter,
  validateAddress,
  solvencyGuard,
  async (req, res) => {
    const { token, amount, destination, chain } = req.body;

    if (!token || !amount || !destination || !chain) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const decAmount = new Decimal(amount);
    if (decAmount.isNaN() || decAmount.lte(0)) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const user = await User.findById(req.user.userId).session(session);
        if (!user) throw new Error('User not found');

        const currentBal = user.balances?.get(token)
          ? new Decimal(user.balances.get(token).toString())
          : new Decimal(0);

        if (currentBal.lt(decAmount)) {
          throw new Error('Insufficient balance');
        }

        await checkAndLockQuota(token, amount, session);

        const newBal = currentBal.minus(decAmount);
        user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal.toFixed(18)));
        await user.save({ session });

        const [withdrawal] = await Withdrawal.create([{
          userId: user._id,
          token,
          amount: mongoose.Types.Decimal128.fromString(decAmount.toString()),
          toAddress: destination,
          chain,
          status: 'PENDING'
        }], { session });

        // Fire and forget payout
        executeOnChainPayout(withdrawal._id)
          .then(txHash => Withdrawal.updateOne({ _id: withdrawal._id }, { status: 'COMPLETED', txHash }).exec())
          .catch(err => {
            logger.error({ module: 'Payout', withdrawalId: withdrawal._id.toString(), error: err.message });
            Withdrawal.updateOne({ _id: withdrawal._id }, { status: 'FAILED', error: err.message }).exec();
          });

        res.json({
          success: true,
          message: 'Withdrawal request accepted — processing',
          withdrawalId: withdrawal._id.toString(),
        });
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// Get balances
router.get('/balances',
  (req, res, next) => req.app.locals.authenticateJWT(req, res, next),
  async (req, res) => {
    const user = await User.findById(req.user.userId);
    res.json({ balances: Object.fromEntries(user.balances || {}) });
  }
);

module.exports = router;
