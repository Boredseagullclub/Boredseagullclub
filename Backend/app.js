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
const User = require('./models/User');

app.post('/api/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress)
    return res.status(400).send({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });
  if (!user) {
    user = await User.create({ publicAddress });
  }

  res.send({ success: true, wallet: user });
});

/*
    Add token manually to wallet
*/
app.post('/api/addToken', async (req, res) => {
  const { walletAddress, token } = req.body;
  if (!walletAddress || !token)
    return res.status(400).send({ error: 'Missing fields' });

  const user = await User.findOne({ publicAddress: walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  if (!user.tokens.includes(token)) {
    user.tokens.push(token);
    user.balances.set(token, user.balances.get(token) || 0);
    await user.save();
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
app.get('/api/balances/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  res.send({ 
    balances: Object.fromEntries(user.balances), 
    tokens: user.tokens 
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Seagull Bridge running on port ${PORT}`));

module.exports = { app };
