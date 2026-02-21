const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');
const DAILY_BRIDGE_CAPS = {
  SeagullCoin: 100_000,
  SeagullCash: 250_000_000
};

// In-memory ledger
let users = {};
let treasury = {};
let transactions = [];
let dailyBridgeUsage = {};
let pools = {};

const ALL_TOKENS = [
  ...Object.keys(SEAGULLCOIN),
  ...Object.keys(SEAGULLCASH)
];

ALL_TOKENS.forEach(token => treasury[token] = 0);

function getFee(token) {
  if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
  if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
  return 0;
}

// Core swap engine
function executeSwap(walletAddress, fromToken, toToken, amount, feeOverride = null) {

  if (!walletAddress || !fromToken || !toToken)
    return { success: false, message: 'Missing parameters' };

  if (fromToken === toToken)
    return { success: false, message: 'Cannot swap same token' };

  if (!ALL_TOKENS.includes(fromToken) || !ALL_TOKENS.includes(toToken))
    return { success: false, message: 'Unsupported token' };

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return { success: false, message: 'Invalid amount' };

  const user = users[walletAddress];
  if (!user) return { success: false, message: 'Wallet not found' };

  const currentBalance = Number(user.balances[fromToken] || 0);
  if (currentBalance < parsedAmount)
    return { success: false, message: 'Insufficient balance' };

  const feePercent = feeOverride !== null ? feeOverride : getFee(fromToken);
  const fee = Number((parsedAmount * feePercent).toFixed(8));
  const received = Number((parsedAmount - fee).toFixed(8));
  if (received <= 0)
    return { success: false, message: 'Amount too small after fee' };

  const today = new Date().toISOString().split('T')[0];
  if (!dailyBridgeUsage[fromToken] || dailyBridgeUsage[fromToken].date !== today) {
    dailyBridgeUsage[fromToken] = { date: today, total: 0 };
  }

  // Enforce daily bridge cap
  if (!pools[`${fromToken}_${toToken}`] && !pools[`${toToken}_${fromToken}`]) {
    if ((dailyBridgeUsage[fromToken].total + parsedAmount) > (DAILY_BRIDGE_CAPS[fromToken] || Infinity)) {
      return { success: false, message: `Daily bridge cap reached for ${fromToken}` };
    }
    dailyBridgeUsage[fromToken].total += parsedAmount;
  }

  // Check if AMM pool exists
  const poolKey = `${fromToken}_${toToken}`;
  const reverseKey = `${toToken}_${fromToken}`;
  const pool = pools[poolKey] || pools[reverseKey];

  if (!pool) {
    // Bridge-style swap
    user.balances[fromToken] -= parsedAmount;
    user.balances[toToken] = (user.balances[toToken] || 0) + received;
    treasury[fromToken] += fee;

    transactions.push({
      walletAddress,
      fromToken,
      toToken,
      amount: parsedAmount,
      received,
      fee,
      timestamp: new Date().toISOString()
    });

    return { success: true, balances: user.balances, fee };
  }

  // AMM swap (x * y = k)
  const reserveIn = pool[fromToken];
  const reserveOut = pool[toToken];
  const amountInWithFee = parsedAmount * (1 - feePercent);
  const amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);

  user.balances[fromToken] = Number((currentBalance - parsedAmount).toFixed(8));
  user.balances[toToken] = Number(((user.balances[toToken] || 0) + amountOut).toFixed(8));
  treasury[fromToken] = Number((treasury[fromToken] + fee).toFixed(8));

  pool[fromToken] += parsedAmount;
  pool[toToken] -= amountOut;

  transactions.push({
    walletAddress,
    fromToken,
    toToken,
    amount: parsedAmount,
    received: amountOut,
    fee,
    timestamp: new Date().toISOString()
  });

  return { success: true, balances: user.balances, fee };
}

module.exports = {
  executeSwap,
  users,
  treasury,
  ALL_TOKENS,
  getFee,
  transactions,
  pools,
  dailyBridgeUsage
};
