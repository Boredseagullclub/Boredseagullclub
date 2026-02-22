const express = require('express');
const bodyParser = require('body-parser');
const { executeSwap } = require('./SwapService');
const mongoose = require('mongoose');
const { getDynamicFee } = require('./DynamicFee');

const app = express();
app.use(bodyParser.json());

// --- Connect to MongoDB ---
mongoose.connect('mongodb://localhost:27017/seagull', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

/*
    Create / Register wallet (NON-CUSTODIAL)
*/
app.post('/api/wallet', (req, res) => {
    const { publicAddress } = req.body;

    if (!publicAddress)
        return res.status(400).send({ error: 'publicAddress required' });

    if (!ledger.users[publicAddress]) {
        ledger.users[publicAddress] = { balances: {}, tokens: [] };
    }

    res.send({ success: true });
});

/*
    Add token manually to wallet
*/
app.post('/api/addToken', (req, res) => {
    const { walletAddress, token } = req.body;

    if (!walletAddress || !token)
        return res.status(400).send({ error: 'Missing fields' });

    const user = ledger.users[walletAddress];
    if (!user)
        return res.status(400).send({ error: 'Wallet not found' });

    if (!ledger.ALL_TOKENS.includes(token))
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
app.post('/api/swap', async (req, res) => {

  const { walletAddress, fromToken, toToken, amount, signature } = req.body;

  if (!walletAddress || !fromToken || !toToken || amount === undefined || !signature)
    return res.status(400).send({ error: 'Missing fields' });

  const result = await executeSwap(
    walletAddress,
    fromToken,
    toToken,
    amount,
    signature
  );

  if (!result.success)
    return res.status(400).send({ error: result.message });

  res.send(result);
});

/*
    Get user balances
*/
app.get('/api/balances/:walletAddress', (req, res) => {
    const user = ledger.users[req.params.walletAddress];

    if (!user)
        return res.status(400).send({ error: 'Wallet not found' });

    res.send(user);
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Seagull Bridge running on port ${PORT}`));

module.exports = { app, ledger };
