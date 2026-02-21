const express = require('express');
const bodyParser = require('body-parser');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');

const app = express();
app.use(bodyParser.json());

/*
    In-memory state
    Replace with MongoDB in production
*/

let users = {}; 
// { walletAddress: { balances: { TOKEN: amount }, tokens: [] } }

let treasury = {};
// { TOKEN: collectedFees }

/*
    Initialize treasury for all supported tokens
*/
const ALL_TOKENS = [
    ...Object.keys(SEAGULLCOIN),
    ...Object.keys(SEAGULLCASH)
];

ALL_TOKENS.forEach(token => {
    treasury[token] = 0;
});

/*
    Fee resolver
*/
function getFee(token) {
    if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
    if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
    return 0;
}

/*
    Core swap engine
*/
function executeSwap(walletAddress, fromToken, toToken, amount) {

    // 1️⃣ Basic validation first
    if (!walletAddress || !fromToken || !toToken)
        return { success: false, message: 'Missing parameters' };

    const user = users[walletAddress];
    if (!user)
        return { success: false, message: 'Wallet not found' };

    if (fromToken === toToken)
        return { success: false, message: 'Cannot swap same token' };

    if (!ALL_TOKENS.includes(fromToken) || !ALL_TOKENS.includes(toToken))
        return { success: false, message: 'Unsupported token' };

    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
        return { success: false, message: 'Invalid amount' };

    const currentBalance = Number(user.balances[fromToken] || 0);

    if (currentBalance < parsedAmount)
        return { success: false, message: 'Insufficient balance' };

    // 2️⃣ Calculate fee safely
    const feePercent = getFee(fromToken);
    const fee = Number((parsedAmount * feePercent).toFixed(8));
    const received = Number((parsedAmount - fee).toFixed(8));

    if (received <= 0)
        return { success: false, message: 'Amount too small after fee' };

    // 3️⃣ Apply mutation only AFTER all checks pass
    user.balances[fromToken] = Number((currentBalance - parsedAmount).toFixed(8));

    if (!user.balances[toToken])
        user.balances[toToken] = 0;

    user.balances[toToken] = Number(
        (user.balances[toToken] + received).toFixed(8)
    );

    treasury[fromToken] = Number(
        (treasury[fromToken] + fee).toFixed(8)
    );

    return {
        success: true,
        balances: user.balances,
        fee
    };
}

/*
    Create / Register wallet (NON-CUSTODIAL)
    Frontend must generate wallet.
    Backend only stores public address.
*/
app.post('/api/wallet', (req, res) => {
    const { publicAddress } = req.body;

    if (!publicAddress)
        return res.status(400).send({ error: 'publicAddress required' });

    if (!users[publicAddress]) {
        users[publicAddress] = {
            balances: {},
            tokens: []
        };
    }

    res.send({ success: true });
});

/*
    Add Seagull token manually
*/
app.post('/api/addToken', (req, res) => {
    const { walletAddress, token } = req.body;

    if (!walletAddress || !token)
        return res.status(400).send({ error: 'Missing fields' });

    const user = users[walletAddress];
    if (!user)
        return res.status(400).send({ error: 'Wallet not found' });

    if (!ALL_TOKENS.includes(token))
        return res.status(400).send({ error: 'Unsupported token' });

    if (!user.tokens.includes(token)) {
        user.tokens.push(token);
        user.balances[token] = user.balances[token] || 0;
    }

    res.send({ success: true, wallet: user });
});

/*
    Swap endpoint
*/
app.post('/api/swap', (req, res) => {
    const { walletAddress, fromToken, toToken, amount } = req.body;

    if (!walletAddress || !fromToken || !toToken || amount === undefined)
        return res.status(400).send({ error: 'Missing fields' });

    const parsedAmount = Number(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0)
        return res.status(400).send({ error: 'Invalid amount' });

    const result = executeSwap(walletAddress, fromToken, toToken, parsedAmount);

    if (!result.success)
        return res.status(400).send({ error: result.message });

    res.send(result);
});

/*
    Get balances
*/
app.get('/api/balances/:walletAddress', (req, res) => {
    const user = users[req.params.walletAddress];

    if (!user)
        return res.status(400).send({ error: 'Wallet not found' });

    res.send(user);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Seagull Bridge running on port ${PORT}`));

module.exports = { executeSwap, users, treasury };
