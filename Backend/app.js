const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const { executeSwap } = require('./SwapService');
const { verifySwapSignature } = require('./SignatureService');
const User = require('./models/User');
const logger = require('./utils/logger');
const { runConfirmationCycle } = require('./services/ConfirmationEngine');
const { SEAGULLCOIN, SEAGULLCASH } = require('./config');


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
app.post('/api/wallet', async (req, res) => {
  const { publicAddress } = req.body;
  if (!publicAddress) return res.status(400).send({ error: 'publicAddress required' });

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
  if (!walletAddress || !token) return res.status(400).send({ error: 'Missing fields' });

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
    Swap endpoint with multi-chain signature verification
*/
app.post('/api/swap', async (req, res) => {
  const { walletAddress, fromToken, toToken, amount, signature, chain } = req.body;

  if (!walletAddress || !fromToken || !toToken || amount === undefined || !signature || !chain) {
    return res.status(400).send({ error: 'Missing fields' });
  }

  const user = await User.findOne({ publicAddress: walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  // Verify signature before swap
  const isValidSignature = await verifySwapSignature({
    walletAddress,
    fromToken,
    toToken,
    amount,
    nonce: user.nonce,
    signature,
    chain
  });

  if (!isValidSignature) return res.status(400).send({ error: 'Invalid signature' });

  // Increment nonce to prevent replay attacks
  user.nonce += 1;
  await user.save();

  // Execute swap
  const result = await executeSwap(walletAddress, fromToken, toToken, amount, user.nonce, chain);

  if (!result.success) return res.status(400).send({ error: result.message });

  res.send(result);
});

// Manually trigger deposit confirmation cycle
app.post('/api/confirmDeposits', async (req, res) => {
  try {
    await runConfirmationCycle();
    res.send({ success: true, message: 'Deposit confirmation...' });
  } catch (err) {
    logger.error({ module: 'API', error: err.message });
    res.status(500).send({ success: false, error: err.message });
  }
});

// Get deposit info
app.get('/api/deposit/:walletAddress/:chain', async (req, res) => {
  const { walletAddress, chain } = req.params;
  const user = await User.findOne({ publicAddress: walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  const depositData = {};
  if (['XRP','XLM','HBAR','ALGO'].includes(chain.toUpperCase())) {
    depositData.address = walletAddress;
    depositData.memo = user.depositTag || null;
  } else {
    depositData.address = user.evmDeposits[chain] || null;
  }

  res.send(depositData);
});

// Transaction history
app.get('/api/history/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  const history = await Ledger.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50);
  res.send(history);
});

/*
    Get user balances
*/
app.get('/api/balances/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(400).send({ error: 'Wallet not found' });

  // Include L2 tokens
  const balances = Object.fromEntries(user.balances);

  // Optionally, mark Layer 2 explicitly
  const l2Tokens = {};
  for (const token of user.tokens) {
    if (
      Object.values(SEAGULLCOIN).some(t => t.contract && t.contract === token) ||
      Object.values(SEAGULLCASH).some(t => t.contract && t.contract === token)
    ) {
      l2Tokens[token] = { ...balances[token], layer2: true };
    }
  }

  res.send({
    balances,
    l2Tokens,
    tokens: user.tokens
  });
});

// Auto-run deposit confirmation every 30s
setInterval(() => {
  runConfirmationCycle().catch(err => logger.error({ module: 'DepositEngine', error: err.message }));
}, 30000);

const PORT = 3000;
app.listen(PORT, () => console.log(`Seagull Bridge running on port ${PORT}`));

module.exports = { app };
