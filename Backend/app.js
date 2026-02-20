// app.js
const express = require('express');
const bodyParser = require('body-parser');
const { SEAGULLCOIN, SEAGULLCASH, FEES } = require('./config');

const app = express();
app.use(bodyParser.json());

// --- In-memory ledger (replace with MongoDB for production) ---
let users = {}; // { walletAddress: { balances: {}, tokens: [] } }
let treasury = {}; // Tracks fees collected per native asset

// Initialize treasury pools
[...Object.keys(SEAGULLCOIN), ...Object.keys(SEAGULLCASH)].forEach(asset => {
    treasury[asset] = 0;
});

// --- Helper functions ---
function getNativeAsset(token) {
    // Map Seagull token back to native chain
    for (const [native, layer2s] of Object.entries({ ...SEAGULLCOIN, ...SEAGULLCASH })) {
        if (layer2s.contract || layer2s.issuer) {
            if (token === native) return native; // basic mapping
        }
    }
    return null;
}

function getFee(token) {
    if (SEAGULLCOIN[token]) return FEES.SEAGULLCOIN;
    if (SEAGULLCASH[token]) return FEES.SEAGULLCASH;
    return 0.025; // fallback
}

// --- Create / import wallet ---
app.post('/api/wallet', (req, res) => {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).send({ error: 'walletAddress required' });

    if (!users[walletAddress]) {
        // Initialize new wallet with 0 balances
        users[walletAddress] = {
            balances: {},
            tokens: []
        };
        // Pre-mint Layer 2 tokens for native assets
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

// --- Add token if user meets native balance requirement ---
app.post('/api/addToken', (req, res) => {
    const { walletAddress, token } = req.body;
    if (!walletAddress || !token) return res.status(400).send({ error: 'Missing fields' });

    const user = users[walletAddress];
    if (!user) return res.status(400).send({ error: 'Wallet not found' });
    if (user.tokens.includes(token)) return res.status(400).send({ error: 'Token already added' });

    // Minimal native requirement (example 10 units)
    const nativeAsset = getNativeAsset(token);
    const requiredNative = 10;
    const nativeBalance = user.balances[nativeAsset] || 0;
    if (nativeBalance < requiredNative) return res.status(400).send({ error: 'Insufficient native balance to activate token' });

    // Add token
    user.tokens.push(token);
    if (!user.balances[token]) user.balances[token] = 0;

    res.send({ success: true, wallet: user });
});

// --- Swap endpoint ---
app.post('/api/swap', (req, res) => {
    const { walletAddress, fromToken, toToken, amount } = req.body;
    if (!walletAddress || !fromToken || !toToken || !amount) return res.status(400).send({ error: 'Missing fields' });

    const user = users[walletAddress];
    if (!user) return res.status(400).send({ error: 'Wallet not found' });

    if ((user.balances[fromToken] || 0) < amount) return res.status(400).send({ error: 'Insufficient balance' });

    // Determine fee
    const feePercent = getFee(fromToken);
    const fee = amount * feePercent;
    const received = amount - fee;

    // Update balances
    user.balances[fromToken] -= amount;
    if (!user.balances[toToken]) user.balances[toToken] = 0;
    user.balances[toToken] += received;

    // Update treasury
    if (!treasury[fromToken]) treasury[fromToken] = 0;
    treasury[fromToken] += fee;

    res.send({ success: true, balances: user.balances, fee });
});

// --- Get user balances ---
app.get('/api/balances/:walletAddress', (req, res) => {
    const walletAddress = req.params.walletAddress;
    const user = users[walletAddress];
    if (!user) return res.status(400).send({ error: 'Wallet not found' });
    res.send({ balances: user.balances, tokens: user.tokens });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Layer 2 bridge backend running on port ${PORT}`));        // Execute swap with the correct fee
        const result = await executeSwap(userId, fromPool, toPool, amount, finalFee);

        if (!result.success) return res.status(400).send({ error: result.message });

        res.send(result);
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Internal server error' });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
