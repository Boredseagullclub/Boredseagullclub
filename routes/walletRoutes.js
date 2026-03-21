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
// Rate limiting (global + per-user)
// ────────────────────────────────────────────────
const globalWithdrawLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,                   // max 25 attempts per IP per 15 min
  message: { error: 'Too many withdrawal requests — slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const perUserWithdrawLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,                   // max 10 withdrawals per user per hour
  keyGenerator: (req) => req.user?.userId || req.ip, // fallback to IP if no user
  skip: (req) => !req.user?.userId,
  message: { error: 'You have reached the hourly withdrawal limit' },
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
// Withdrawal (protected + validated + rate-limited)
// ────────────────────────────────────────────────
router.post(
  '/withdraw',
  authenticateJWT,                    // 1. Must be logged in
  globalWithdrawLimiter,              // 2. IP-based global limit
  perUserWithdrawLimiter,             // 3. Per-user limit
  validateAddress,                    // 4. Address format + checksum check
  async (req, res) => {
    const { token, amount, destination, chain } = req.body;

    // Basic input validation (amount should be positive number)
    if (!token || !amount || !destination || !chain) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Quick early check: amount > 0
    const decAmount = new Decimal(amount);
    if (decAmount.isNaN() || decAmount.lte(0)) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Load user
        const user = await User.findById(req.user.userId).session(session);
        if (!user) {
          throw new Error('User not found');
        }

        // 2. Balance check
        const bal = user.balances?.get(token);
        if (!bal || new Decimal(bal.toString()).lt(decAmount)) {
          throw new Error('Insufficient balance');
        }

        // 3. Treasury quota check (atomic)
        await checkAndLockQuota(token, amount, session);

        // 4. Subtract balance
        const newBal = new Decimal(bal.toString()).minus(decAmount).toString();
        user.balances.set(token, mongoose.Types.Decimal128.fromString(newBal));
        await user.save({ session });

        // 5. Create pending withdrawal
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

        // Commit transaction
        await session.commitTransaction();

        // 6. Trigger payout asynchronously (fire-and-forget)
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

        // Response to client
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

module.exports = router;
