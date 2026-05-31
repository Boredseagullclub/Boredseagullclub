const express = require('express');
const { ethers } = require('ethers');
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
const { passkeySuccessCounter } = require('../services/metrics'); // Moved to dedicated file

const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = 'Seagull Exchange';
const ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';

function signToken(user) {
  return jwt.sign(
    { userId: user._id, publicAddress: user.publicAddress },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// 1. Registration Start
router.post('/passkey/register/start', async (req, res) => {
  const { publicAddress, signature, nonce, timestamp, chain, publicKey } = req.body;

  if (!signature || !nonce || !timestamp || !chain) {
    return res.status(400).json({ error: 'Wallet signature required to register passkey' });
  }

  const isValid = await verifySwapSignature({
    walletAddress: publicAddress,
    publicKey,
    signature,
    fromToken: 'registration',
    toToken: 'passkey',
    amount: '0',
    nonce,
    timestamp,
    chain
  });

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid wallet signature – ownership not verified' });
  }

  // Atomic Find or Create
  let user = await User.findOneAndUpdate(
    { publicAddress },
    { $setOnInsert: { publicAddress, balances: {} } },
    { upsert: true, new: true }
  );

  const options = generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: user._id.toString(),
    userName: publicAddress,
    userDisplayName: `${publicAddress.slice(0, 6)}...${publicAddress.slice(-4)}`,
    attestation: 'none',
    excludeCredentials: user.passkeys.map(cred => ({
      id: cred.credentialID,
      type: 'public-key',
      transports: cred.transports || [],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });

  user.pendingWebauthnChallenge = options.challenge;
  await user.save();

  res.json(options);
});

// 2. Registration Finish
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

    // Prevent duplicate passkey IDs
    const alreadyExists = user.passkeys.some(p => p.credentialID === credential.id);
    if (!alreadyExists) {
        user.passkeys.push({
          credentialID: credential.id,
          credentialPublicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports || [],
          attestationType: 'none',
        });
    }

    user.pendingWebauthnChallenge = undefined;
    await user.save();

    res.json({ success: true, token: signToken(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Login Start
router.post('/passkey/login/start', async (req, res) => {
  const { publicAddress } = req.body;
  const user = await User.findOne({ publicAddress });
  
  if (!user || !user.passkeys?.length) {
    return res.status(404).json({ error: 'No passkeys found for this address' });
  }

  const options = generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: user.passkeys.map(cred => ({
      id: cred.credentialID,
      type: 'public-key',
      transports: cred.transports || [],
    })),
    userVerification: 'preferred',
  });

  user.pendingWebauthnChallenge = options.challenge;
  await user.save();

  res.json(options);
});

// 4. Login Finish
router.post('/passkey/login/finish', async (req, res) => {
  const { publicAddress, response } = req.body;
  const user = await User.findOne({ publicAddress });
  
  if (!user || !user.pendingWebauthnChallenge) {
    return res.status(400).json({ error: 'No pending login' });
  }

  try {
    const credential = user.passkeys.find(c => c.credentialID === response.id);
    if (!credential) return res.status(400).json({ error: 'Credential not recognized' });

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
      return res.status(400).json({ error: 'Biometric verification failed' });
    }

    credential.counter = verification.authenticationInfo.newCounter;
    user.lastLogin = new Date();
    user.pendingWebauthnChallenge = undefined;

    await user.save();
    passkeySuccessCounter.inc();

    res.json({ success: true, token: signToken(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Import Recovery Phrase (The Missing Route)
router.post('/import', async (req, res) => {
  try {
    const { secret } = req.body;
    
    if (!secret) {
      return res.status(400).json({ error: 'Secret phrase is required' });
    }

    // Derive the standard EVM address from the user's 12/24 words
    const wallet = ethers.Wallet.fromPhrase(secret.trim());
    const publicAddress = wallet.address.toLowerCase();

    // Ensure the user exists in the database
    let user = await User.findOneAndUpdate(
      { publicAddress },
      { $setOnInsert: { publicAddress, balances: {} } },
      { upsert: true, new: true }
    );

    // Send the real address back to the frontend so it stops using "sovereign_user"
    res.json({ 
      success: true, 
      address: publicAddress,
      token: signToken(user) 
    });

  } catch (err) {
    console.error("Import Error:", err.message);
    res.status(400).json({ error: 'Invalid recovery phrase format' });
  }
});


module.exports = router;
