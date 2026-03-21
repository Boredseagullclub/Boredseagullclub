const express = require('express');
const router = express.Router();
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifySwapSignature } = require('../services/SignatureService');
const { passkeySuccessCounter } = require('../app'); // Import from app.js (or use shared metrics file)

const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = 'Seagull Exchange';
const ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';

// Helper to generate JWT
function signToken(user) {
  return jwt.sign(
    { userId: user._id, publicAddress: user.publicAddress },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// 1. Registration Start – requires wallet signature proof
router.post('/passkey/register/start', async (req, res) => {
  const { publicAddress, signature, nonce, timestamp, chain, publicKey } = req.body;

  // Require proof of wallet ownership
  if (!signature || !nonce || !timestamp || !chain) {
    return res.status(400).json({ error: 'Wallet signature required to register passkey' });
  }

  const isValid = await verifySwapSignature({
    walletAddress: publicAddress,
    publicKey, // Required for XRPL/HBAR, optional for EVM
    signature,
    fromToken: 'any', // dummy values
    toToken: 'any',
    amount: '0',
    nonce,
    timestamp,
    chain
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid wallet signature – ownership not verified' });
  }

  let user = await User.findOne({ publicAddress });
  if (!user) {
    user = await User.create({ publicAddress });
  }

  const options = generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: user._id.toString(),
    userName: publicAddress,
    userDisplayName: publicAddress.slice(0, 12) + '...',
    attestation: 'none',
    excludeCredentials: user.passkeys.map(cred => ({
      id: cred.credentialID,
      type: 'public-key',
      transports: cred.transports || [],
    })),
  });

  user.pendingWebauthnChallenge = options.challenge;
  await user.save();

  res.json(options);
});

// 2. Registration Finish (signature already verified in /start)
router.post('/passkey/register/finish', async (req, res) => {
  const { publicAddress, response } = req.body;
  const user = await User.findOne({ publicAddress });
  if (!user || !user.pendingWebauthnChallenge) {
    return res.status(400).json({ error: 'No pending registration' });
  }

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: user.pendingWebauthnChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    const { credential } = verification.registrationInfo;

    user.passkeys.push({
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey, 'base64'),
      counter: credential.counter,
      transports: credential.transports || [],
      attestationType: 'none',
      authenticatorAttachment: credential.authenticatorAttachment,
    });

    user.pendingWebauthnChallenge = undefined;
    await user.save();

    const token = signToken(user);
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Login Start (unchanged)
router.post('/passkey/login/start', async (req, res) => {
  const { publicAddress } = req.body;
  const user = await User.findOne({ publicAddress });
  if (!user || user.passkeys.length === 0) {
    return res.status(404).json({ error: 'No passkeys registered' });
  }

  const options = generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: user.passkeys.map(cred => ({
      id: cred.credentialID,
      type: 'public-key',
      transports: cred.transports || [],
    })),
  });

  user.pendingWebauthnChallenge = options.challenge;
  await user.save();

  res.json(options);
});

// 4. Login Finish – increments success counter on success
router.post('/passkey/login/finish', async (req, res) => {
  const { publicAddress, response } = req.body;
  const user = await User.findOne({ publicAddress });
  if (!user || !user.pendingWebauthnChallenge) {
    return res.status(400).json({ error: 'No pending login' });
  }

  try {
    const credential = user.passkeys.find(c => c.credentialID === response.id);
    if (!credential) return res.status(400).json({ error: 'Credential not found' });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: user.pendingWebauthnChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.credentialID,
        publicKey: credential.credentialPublicKey,
        counter: credential.counter,
        transports: credential.transports,
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verification failed' });
    }

    // Update counter & login stats
    credential.counter = verification.authenticationInfo.newCounter;
    user.lastLogin = new Date();
    user.loginCount += 1;
    user.pendingWebauthnChallenge = undefined;

    await user.save();

    // SUCCESS: Track successful passkey login
    passkeySuccessCounter.inc();

    const token = signToken(user);
    res.json({ success: true, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
