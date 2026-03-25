const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const rateLimit = require('express-rate-limit');

const validateAddress = require('../middleware/validateAddress');
const solvencyGuard = require('../middleware/solvencyGuard');

const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { checkAndLockQuota } = require('../services/quotaGuard');
const { executeOnChainPayout } = require('../services/payoutEngine');
const logger = require('../utils/logger');

// Rate limiters
const globalWithdrawLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: 'Too many withdrawal requests — slow down' }
});

const perUserWithdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.userId || req.ip,
  skip: (req) => !req.user?.userId,
  message: { error: 'You have reached the hourly withdrawal limit' }
});

const strictWithdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.userId || req.ip,
  message: { error: 'Withdrawal rate limit reached — wait 1 hour' }
});

// Create Wallet (public)
router.post('/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) return res.status(400).json({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });
  if (!user) user = await User.create({ publicAddress });

  res.json({ success: true, wallet: user });
});

// Withdrawal — fully protected
router.post(
  '/withdraw',
  (req, res, next) => req.app.locals.authenticateJWT(req, res, next),   // ← Uses app.locals correctly
  globalWithdrawLimiter,
  perUserWithdrawLimiter,
  strictWithdrawLimiter,
  validateAddress,
  solvencyGuard,                    // ✅ Now active
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

        const bal = user.balances?.get(token);
        if (!bal || new Decimal(bal.toString()).lt(decAmount)) {
          throw new Error('Insufficient balance');
        }

        await checkAndLockQuota(token, amount, session);

        const newBal = new Decimal(bal.toString()).minus(decAmount).toString();
        user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal));
        await user.save({ session });

        const [withdrawal] = await Withdrawal.create([{
          userId: user._id,
          token,
          amount: mongoose.Types.Decimal128.fromString(amount),
          toAddress: destination,
          chain,
          status: 'PENDING'
        }], { session });

        await session.commitTransaction();

        // Fire-and-forget payout
        executeOnChainPayout(withdrawal._id)
          .then(txHash => {
            Withdrawal.updateOne({ _id: withdrawal._id }, { status: 'COMPLETED', txHash }).exec();
          })
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
      await session.abortTransaction();
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
