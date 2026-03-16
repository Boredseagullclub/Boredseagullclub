const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Ledger = require('../models/Ledger');

const { executeSwap } = require('../SwapService');
const { verifySwapSignature } = require('../SignatureService');

const { SEAGULLCOIN, SEAGULLCASH } = require('../config');

/*
    Create / Register wallet
*/
router.post('/wallet', async (req, res) => {

  const { publicAddress } = req.body;

  if (!publicAddress)
    return res.status(400).send({ error: 'publicAddress required' });

  let user = await User.findOne({ publicAddress });

  if (!user)
    user = await User.create({ publicAddress });

  res.send({ success: true, wallet: user });

});


/*
    Add token
*/
router.post('/addToken', async (req, res) => {
  const { walletAddress, token } = req.body;

  if (!walletAddress || !token) {
    return res.status(400).json({ error: 'Missing walletAddress or token' });
  }

  const allowed = new Set([
    ...Object.keys(SEAGULLCOIN || {}),
    ...Object.keys(SEAGULLCASH || {}),
    'XRP' // add others if needed
  ]);

  if (!allowed.has(token)) {
    return res.status(400).json({ error: 'Unsupported token' });
  }

  const user = await User.findOne({ publicAddress: walletAddress });
  if (!user) return res.status(404).json({ error: 'Wallet not found' });

  const updated = await User.updateOne(
    { _id: user._id },
    {
      $addToSet: { tokens: token },
      $setOnInsert: { [`balances.${token}`]: mongoose.Types.Decimal128.fromString('0') }
    }
  );

  if (updated.modifiedCount === 0 && updated.matchedCount === 1) {
    return res.json({ success: true, message: 'Token already added', wallet: user });
  }

  const freshUser = await User.findById(user._id);
  res.json({ success: true, wallet: freshUser });
});


/*
    Swap tokens
*/
router.post('/swap', async (req, res) => {

  const { walletAddress, fromToken, toToken, amount, signature, chain } = req.body;

  if (!walletAddress || !fromToken || !toToken || amount === undefined || !signature || !chain)
    return res.status(400).send({ error: 'Missing fields' });

  const user = await User.findOne({ publicAddress: walletAddress });
    const balance = user.balances.get(fromToken);
  if (!balance || new Decimal(balance.toString()).lessThan(amount)) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
    
  if (!user)
    return res.status(400).send({ error: 'Wallet not found' });

  const isValidSignature = await verifySwapSignature({
    walletAddress,
    fromToken,
    toToken,
    amount,
    nonce: user.nonce,
    signature,
    chain
  });

  if (!isValidSignature)
    return res.status(400).send({ error: 'Invalid signature' });

  const result = await executeSwap(walletAddress, fromToken, toToken, amount, user.nonce, chain);

  if (!result.success)
    return res.status(400).send({ error: result.message });

  user.nonce += 1;
  await user.save();

  res.send(result);

});


/*
    Deposit information
*/
router.get('/deposit/:walletAddress/:chain', async (req, res) => {

  const { walletAddress, chain } = req.params;

  const user = await User.findOne({ publicAddress: walletAddress });

  if (!user)
    return res.status(400).send({ error: 'Wallet not found' });

  const depositData = {};

  if (['XRP','XLM','HBAR','ALGO'].includes(chain.toUpperCase())) {

    depositData.address = walletAddress;
    depositData.memo = user.depositTag || null;

  } else {

    depositData.address = user.evmDeposits[chain] || null;

  }

  res.send(depositData);

});


/*
    Transaction history
*/
router.get('/history/:walletAddress', async (req, res) => {

  const user = await User.findOne({ publicAddress: req.params.walletAddress });

  if (!user)
    return res.status(400).send({ error: 'Wallet not found' });

  const history = await Ledger
    .find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(50);

  res.send(history);

});


/*
    Balances
*/
router.get('/balances/:walletAddress', async (req, res) => {
  const user = await User.findOne({ publicAddress: req.params.walletAddress });
  if (!user) return res.status(404).json({ error: 'Wallet not found' });

  const formattedBalances = {};
  for (const [token, val] of user.balances.entries()) {
    formattedBalances[token] = val ? val.toString() : '0';
  }

  // Optional: filter L2 tokens if you still want that
  const l2Tokens = {};
  for (const token of user.tokens) {
    if (formattedBalances[token] !== undefined) {
      l2Tokens[token] = {
        balance: formattedBalances[token],
        layer2: true // or derive from config
      };
    }
  }

  res.json({
    balances: formattedBalances,
    l2Tokens,
    tokens: user.tokens
  });
});

module.exports = router;
