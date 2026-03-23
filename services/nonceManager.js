// services/nonceManager.js
const Nonce = require('../models/Nonce');  // ← now points to the updated models/Nonce.js

async function getAndIncrementNonce(walletAddress, chain) {
  const filter = { 
    walletAddress: walletAddress.toLowerCase().trim(),
    chain: chain.toUpperCase() 
  };

  const update = { $inc: { nextNonce: 1 } };

  const options = { 
    upsert: true, 
    new: true, 
    setDefaultsOnInsert: true 
  };

  const doc = await Nonce.findOneAndUpdate(filter, update, options);
  return doc.nextNonce - 1;  // the nonce to use NOW
}

async function syncNonceWithChain(walletAddress, chain, provider) {
  const onChainNonce = await provider.getTransactionCount(walletAddress, 'pending');

  await Nonce.findOneAndUpdate(
    { walletAddress: walletAddress.toLowerCase().trim(), chain: chain.toUpperCase() },
    { $set: { nextNonce: onChainNonce } },
    { upsert: true }
  );

  return onChainNonce;
}

module.exports = { getAndIncrementNonce, syncNonceWithChain };
