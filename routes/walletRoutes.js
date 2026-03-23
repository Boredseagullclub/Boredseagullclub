const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const rateLimit = require('express-rate-limit');

const { authenticateJWT } = require('../middleware/auth');
const validateAddress = require('../middleware/validateAddress');

const User = require('../models/User');
const Ledger = require('../models/Ledger');
const Withdrawal = require('../models/Withdrawal');
const { checkAndLockQuota } = require('../services/quotaGuard');
const { executeOnChainPayout } = require('../services/payoutEngine');

// ────────────────────────────────────────────────
// Rate limiting (global + per-user + strict withdrawal)
// ────────────────────────────────────────────────
const globalWithdrawLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,
  message: { error: 'Too many withdrawal requests — slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const perUserWithdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req) => req.user?.userId || req.ip,
  skip: (req) => !req.user?.userId,
  message: { error: 'You have reached the hourly withdrawal limit' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter: only 5 withdrawals per hour per user/IP
const strictWithdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: (req) => req.user?.userId || req.ip,
  message: { error: 'Withdrawal rate limit reached — wait 1 hour' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ────────────────────────────────────────────────
// Create Wallet (public endpoint)
// ────────────────────────────────────────────────
router.post('/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) {
    return res.status(400).json({ error: 'publicAddress required' });
  }

  let user = await User.findOne({ publicAddress });
  if (!user) {
    user = await User.create({ publicAddress });
  }

  res.json({ success: true, wallet: user });
});

// ────────────────────────────────────────────────
// Withdrawal (protected + validated + triple rate-limited)
// ────────────────────────────────────────────────
router.post(
  '/withdraw',
  authenticateJWT,                    // 1. Must be logged in
  globalWithdrawLimiter,              // 2. IP-based global
  perUserWithdrawLimiter,             // 3. Per-user hourly
  strictWithdrawLimiter,              // 4. Strictest: 5/hour
  validateAddress,                    // 5. Address validation
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
        if (!user) {
          throw new Error('User not found');
        }

        // Balance check
        const bal = user.balances?.get(token);
        if (!bal || new Decimal(bal.toString()).lt(decAmount)) {
          throw new Error('Insufficient balance');
        }

        await checkAndLockQuota(token, amount, session);

        const newBal = new Decimal(bal.toString()).minus(decAmount).toString();
        user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal));
        await user.save({ session });

        const [withdrawal] = await Withdrawal.create(
          [{
            userId: user._id,
            token,
            amount: mongoose.Types.Decimal128.fromString(amount),
            toAddress: destination,
            chain,
            status: 'PENDING',
            requestedAt: new Date()
          }],
          { session }
        );

        await session.commitTransaction();

        executeOnChainPayout(withdrawal._id)
          .then((txHash) => {
            Withdrawal.updateOne(
              { _id: withdrawal._id },
              { status: 'COMPLETED', txHash }
            ).exec();
          })
          .catch((err) => {
            Withdrawal.updateOne(
              { _id: withdrawal._id },
              { status: 'FAILED', error: err.message }
            ).exec();
            console.error('Payout failed:', err);
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

// routes/walletRoutes.js
router.get('/balances', authenticateJWT, async (req, res) => {
  const user = await User.findById(req.user.userId);
  res.json({ balances: Object.fromEntries(user.balances || {}) });
});

module.exports = router;
