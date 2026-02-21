// app.js
const express = require('express');
const bodyParser = require('body-parser');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');

const app = express();
app.use(bodyParser.json());

// --- In-memory ledger (replace with MongoDB for production) ---
let users = {}; // { walletAddress: { balances: {}, tokens: [] } }
let treasury = {}; // Tracks collected fees

// Initialize treasury pools for all tokens
[...Object.keys(SEAGULLCOIN), ...Object.keys(SEAGULLCASH)].forEach(asset => {
    treasury[asset] = 0;
});

// --- Helper functions ---
function getFee(token) {
    if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
    if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
    return 0.025; // fallback
}

function getNativeAsset(token) {
    for (const [native, layer2s] of Object.entries({ ...SEAGULLCOIN, ...SEAGULLCASH })) {
        if (layer2s.contract || layer2s.issuer) {
            if (token === native) return native;
        }
    }
    return null;
}

// --- Core swap logic ---
function executeSwap(walletAddress, fromToken, toToken, amount) {
    const user = users[walletAddress];
    if (!user) return { success: false, message: 'Wallet not found' };

    if ((user.balances[fromToken] || 0) < amount)
        return { success: false, message: 'Insufficient balance' };

    const feePercent = getFee(fromToken);
    const fee = amount * feePercent;
    const received = amount - fee;

    user.balances[fromToken] -= amount;
    if (!user.balances[toToken]) user.balances[toToken] = 0;
    user.balances[toToken] += received;

    treasury[fromToken] += fee;

    return { success: true, balances: user.balances, fee };
}

// --- Wallet creation/import ---
app.post('/api/wallet', (req, res) => {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).send({ error: 'walletAddress required' });

    if (!users[walletAddress]) {
        users[walletAddress] = { balances: {}, tokens: [] };

        // Pre-mint all Layer 2 tokens
        Object.keys(SEAGULLCOIN).forEach(token => {
            users[walletAddress].balances[token] = 0;
            users[walletAddress].tokens.push(token);
        });
        Object.keys(SEAGULLCASH).forEach(token => {
            users[walletAddress].balances[token] = 0;
            users[walletAddress].tokens.push(token);
        });
    }

    res.send({ success: true, wallet: users[walletAddress] });
});

// --- Add Layer 2 token if native balance requirement met ---
app.post('/api/addToken', (req, res) => {
    const { walletAddress, token } = req.body;
    if (!walletAddress || !token) return res.status(400).send({ error: 'Missing fields' });

    const user = users[walletAddress];
    if (!user) return res.status(400).send({ error: 'Wallet not found' });
    if (user.tokens.includes(token)) return res.status(400).send({ error: 'Token already added' });

    const nativeAsset = getNativeAsset(token);
    const requiredNative = 10; // example minimum
    const nativeBalance = user.balances[nativeAsset] || 0;
    if (nativeBalance < requiredNative)
        return res.status(400).send({ error: 'Insufficient native balance to activate token' });

    user.tokens.push(token);
    if (!user.balances[token]) user.balances[token] = 0;

    res.send({ success: true, wallet: user });
});

// --- Swap endpoint ---
app.post('/api/swap', (req, res) => {
    const { walletAddress, fromToken, toToken, amount } = req.body;
    if (!walletAddress || !fromToken || !toToken || !amount)
        return res.status(400).send({ error: 'Missing fields' });

    const result = executeSwap(walletAddress, fromToken, toToken, amount);
    if (!result.success) return res.status(400).send({ error: result.message });

    res.send(result);
});

// --- Get user balances ---
app.get('/api/balances/:walletAddress', (req, res) => {
    const walletAddress = req.params.walletAddress;
    const user = users[walletAddress];
    if (!user) return res.status(400).send({ error: 'Wallet not found' });
    res.send({ balances: user.balances, tokens: user.tokens });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Layer 2 bridge backend running on port ${PORT}`));

// --- Export core functions for AI orchestration ---
module.exports = { executeSwap, users, treasury };
