const mongoose = require('mongoose');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');
const { verifySwapSignature } = require('./SignatureService');
const User = require('./models/User');
const Treasury = require('./models/Treasury');
const Pool = require('./models/Pool');
const Transaction = require('./models/Transaction');

const DAILY_BRIDGE_CAPS = {
  SeagullCoin: 100_000,
  SeagullCash: 250_000_000
};

const ALL_TOKENS = [
  ...Object.keys(SEAGULLCOIN),
  ...Object.keys(SEAGULLCASH)
];

function getFee(token) {
  if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
  if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
  return 0;
}

async function executeSwap(walletAddress, fromToken, toToken, amount, signature) {

  const parsedAmount = Number(amount);

  if (!walletAddress || !fromToken || !toToken)
    return { success: false, message: 'Missing parameters' };

  if (fromToken === toToken)
    return { success: false, message: 'Cannot swap same token' };

  if (!ALL_TOKENS.includes(fromToken) || !ALL_TOKENS.includes(toToken))
    return { success: false, message: 'Unsupported token' };

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { success: false, message: 'Invalid amount' };

  const session = await mongoose.startSession();
  session.startTransaction();

  try {

    const user = await User.findOne({ publicAddress: walletAddress }).session(session);
    if (!user) throw new Error('Wallet not found');

    const currentBalance = Number(user.balances.get(fromToken) || 0);
    if (currentBalance < parsedAmount)
      throw new Error('Insufficient balance');

    const feePercent = getFee(fromToken);
    const fee = Number((parsedAmount * feePercent).toFixed(8));
    const amountAfterFee = Number((parsedAmount - fee).toFixed(8));

    if (amountAfterFee <= 0)
      throw new Error('Amount too small after fee');

    const today = new Date().toISOString().split('T')[0];
    const usage = user.dailyBridgeUsage.get(fromToken);

    // Detect if AMM pool exists
    let pool = await Pool.findOne({
      $or: [
        { tokenA: fromToken, tokenB: toToken },
        { tokenA: toToken, tokenB: fromToken }
      ]
    }).session(session);

    const isBridgeSwap = !pool;

    if (isBridgeSwap) {

      const usedToday = usage && usage.date === today ? usage.total : 0;

      if ((usedToday + parsedAmount) > (DAILY_BRIDGE_CAPS[fromToken] || Infinity))
        throw new Error(`Daily bridge cap reached for ${fromToken}`);

      user.dailyBridgeUsage.set(fromToken, {
        date: today,
        total: usedToday + parsedAmount
      });

      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(
        toToken,
        Number((user.balances.get(toToken) || 0) + amountAfterFee)
      );

    } else {

      // AMM swap x*y=k
      const reserveIn =
        pool.tokenA === fromToken ? pool.reserveA : pool.reserveB;

      const reserveOut =
        pool.tokenA === fromToken ? pool.reserveB : pool.reserveA;

      const amountInWithFee = parsedAmount * (1 - feePercent);
      const amountOut =
        (amountInWithFee * reserveOut) /
        (reserveIn + amountInWithFee);

      if (amountOut <= 0)
        throw new Error('AMM output too small');

      // Update pool reserves
      if (pool.tokenA === fromToken) {
        pool.reserveA += parsedAmount;
        pool.reserveB -= amountOut;
      } else {
        pool.reserveB += parsedAmount;
        pool.reserveA -= amountOut;
      }

      if (pool.reserveA <= 0 || pool.reserveB <= 0)
        throw new Error('Pool liquidity exhausted');

      await pool.save({ session });

      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(
        toToken,
        Number((user.balances.get(toToken) || 0) + amountOut)
      );
    }

    // Treasury update
    await Treasury.findOneAndUpdate(
      { token: fromToken },
      { $inc: { collectedFees: fee } },
      { upsert: true, session }
    );

    await user.save({ session });

    await Transaction.create([{
      walletAddress,
      fromToken,
      toToken,
      amount: parsedAmount,
      received: isBridgeSwap ? amountAfterFee : undefined,
      fee,
      type: isBridgeSwap ? 'BRIDGE' : 'AMM'
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      balances: Object.fromEntries(user.balances),
      fee
    };

  } catch (err) {

    await session.abortTransaction();
    session.endSession();

    return {
      success: false,
      message: err.message
    };
  }
}

module.exports = { executeSwap };
