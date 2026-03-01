const mongoose = require('mongoose');
const User = require('./models/User');
const Pool = require('./models/Pool');
const Transaction = require('./models/Transaction');
const { getFee } = require('./FeeService');
const { updateTreasury } = require('./TreasuryService');
const { settleOnChain } = require('./BridgeService');
const { validateNonce } = require('./NonceService');
const { DAILY_BRIDGE_CAPS, ALL_TOKENS } = require('./config');

async function executeSwap(walletAddress, fromToken, toToken, amount, nonce, chain) {
  const parsedAmount = Number(amount);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findOne({ publicAddress: walletAddress }).session(session);
    if (!user) throw new Error('Wallet not found');

    await validateNonce(walletAddress, nonce, chain, session);

    const currentBalance = Number(user.balances.get(fromToken) || 0);
    if (currentBalance < parsedAmount) throw new Error('Insufficient balance');

    const feePercent = getFee(fromToken);
    const fee = parsedAmount * feePercent;
    const amountAfterFee = parsedAmount - fee;

    let finalAmount;
    const pool = await Pool.findOne({
      $or: [
        { tokenA: fromToken, tokenB: toToken },
        { tokenA: toToken, tokenB: fromToken }
      ]
    }).session(session);

    if (!pool) {
      // Bridge swap
      const today = new Date().toISOString().split('T')[0];
      const usage = user.dailyBridgeUsage.get(fromToken) || { date: today, total: 0 };
      if ((usage.total + parsedAmount) > (DAILY_BRIDGE_CAPS[fromToken] || Infinity)) {
        throw new Error(`Daily bridge cap reached for ${fromToken}`);
      }

      user.dailyBridgeUsage.set(fromToken, { date: today, total: usage.total + parsedAmount });
      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(toToken, (user.balances.get(toToken) || 0) + amountAfterFee);
      finalAmount = amountAfterFee;
    } else {
      // AMM swap
      const reserveIn = pool.tokenA === fromToken ? pool.reserveA : pool.reserveB;
      const reserveOut = pool.tokenA === fromToken ? pool.reserveB : pool.reserveA;
      const amountInWithFee = parsedAmount * (1 - feePercent);
      const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);
      if (amountOut <= 0) throw new Error('AMM output too small');

      if (pool.tokenA === fromToken) {
        pool.reserveA += parsedAmount;
        pool.reserveB -= amountOut;
      } else {
        pool.reserveB += parsedAmount;
        pool.reserveA -= amountOut;
      }
      await pool.save({ session });

      user.balances.set(fromToken, currentBalance - parsedAmount);
      user.balances.set(toToken, (user.balances.get(toToken) || 0) + amountOut);
      finalAmount = amountOut;
    }

    // On-chain settlement moved to BridgeService
    await settleOnChain(walletAddress, toToken, finalAmount, chain);

    await updateTreasury(fromToken, fee, session);
    await user.save({ session });

    await Transaction.create([{
      walletAddress,
      fromToken,
      toToken,
      amount: parsedAmount,
      received: finalAmount,
      fee,
      type: pool ? 'AMM' : 'BRIDGE',
      chain
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return { success: true, balances: Object.fromEntries(user.balances), fee };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return { success: false, message: err.message };
  }
}

module.exports = { executeSwap };
