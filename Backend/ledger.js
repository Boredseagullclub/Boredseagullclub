const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');

// In-memory ledger (replace with DB in production)
let users = {};       // { walletAddress: { balances: {}, tokens: [] } }
let treasury = {};    // { TOKEN: collectedFees }
let transactions = []; // [{ walletAddress, fromToken, toToken, amount, received, fee, timestamp }]

const ALL_TOKENS = [
    ...Object.keys(SEAGULLCOIN),
    ...Object.keys(SEAGULLCASH)
];

// Initialize treasury pools
ALL_TOKENS.forEach(token => {
    treasury[token] = 0;
});

// Determine fee by token type
function getFee(token) {
    if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
    if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
    return 0;
}

// Core swap engine
function executeSwap(walletAddress, fromToken, toToken, amount, feeOverride = null) {

    // -------- Basic validation --------
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

    if (!user)
        return { success: false, message: 'Wallet not found' };

    const currentBalance = Number(user.balances[fromToken] || 0);

    if (currentBalance < parsedAmount)
        return { success: false, message: 'Insufficient balance' };

    // -------- Fee calculation --------
    const feePercent = feeOverride !== null ? feeOverride : getFee(fromToken);
    const fee = Number((parsedAmount * feePercent).toFixed(8));
    const received = Number((parsedAmount - fee).toFixed(8));

    if (received <= 0)
        return { success: false, message: 'Amount too small after fee' };

    // -------- Apply swap --------
    user.balances[fromToken] = Number((currentBalance - parsedAmount).toFixed(8));

    user.balances[toToken] = Number(
        ((user.balances[toToken] || 0) + received).toFixed(8)
    );

    treasury[fromToken] = Number(
        (treasury[fromToken] + fee).toFixed(8)
    );

    // -------- Record transaction --------
    transactions.push({
        walletAddress,
        fromToken,
        toToken,
        amount: parsedAmount,
        received,
        fee,
        timestamp: new Date().toISOString()
    });

    return {
        success: true,
        balances: user.balances,
        fee
    };
}

module.exports = {
    executeSwap,
    users,
    treasury,
    ALL_TOKENS,
    getFee,
    transactions
};
