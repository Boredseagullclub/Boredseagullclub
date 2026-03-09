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

  if (!walletAddress || !token)
    return res.status(400).send({ error: 'Missing fields' });

  const user = await User.findOne({ publicAddress: walletAddress });

  if (!user)
    return res.status(400).send({ error: 'Wallet not found' });

  if (!user.tokens.includes(token)) {

    user.tokens.push(token);

    user.balances.set(token, user.balances.get(token) || 0);

    await user.save();
  }

  res.send({ success: true, wallet: user });

});


/*
    Swap tokens
*/
router.post('/swap', async (req, res) => {

  const { walletAddress, fromToken, toToken, amount, signature, chain } = req.body;

  if (!walletAddress || !fromToken || !toToken || amount === undefined || !signature || !chain)
    return res.status(400).send({ error: 'Missing fields' });

  const user = await User.findOne({ publicAddress: walletAddress });

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

  if (!user)
    return res.status(400).send({ error: 'Wallet not found' });

  const balances = Object.fromEntries(user.balances);

  const l2Tokens = {};

  for (const token of user.tokens) {

    if (
      Object.values(SEAGULLCOIN).some(t => t.contract === token) ||
      Object.values(SEAGULLCASH).some(t => t.contract === token)
    ) {

      l2Tokens[token] = {
        balance: balances[token],
        layer2: true
      };

    }

  }

  res.send({
    balances,
    l2Tokens,
    tokens: user.tokens
  });

});

module.exports = router;
