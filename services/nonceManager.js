// services/nonceManager.js  (improved)

const Nonce = require('../models/Nonce');

async function getAndIncrementNonce(walletAddress, chain) {
  const filter = {
    walletAddress: walletAddress.toLowerCase().trim(),
    chain: chain.toUpperCase(),
  };

  const doc = await Nonce.findOneAndUpdate(
    filter,
    { $inc: { nextNonce: 1 } },
    { 
      upsert: true, 
      new: true, 
      setDefaultsOnInsert: true,
      // Optional: add a small timeout or retry if you want extra safety
    }
  );

  return doc.nextNonce - 1; // nonce to use for this tx
}

async function syncNonceWithChain(walletAddress, chain, provider) {
  try {
    const onChainNonce = await provider.getTransactionCount(
      walletAddress, 
      'pending'   // Important: use 'pending'
    );

    await Nonce.findOneAndUpdate(
      {
        walletAddress: walletAddress.toLowerCase().trim(),
        chain: chain.toUpperCase(),
      },
      { $set: { nextNonce: onChainNonce } },
      { upsert: true }
    );

    return onChainNonce;
  } catch (err) {
    logger.error({ module: 'NonceManager', event: 'SYNC_FAILED', walletAddress, chain, error: err.message });
    throw err;
  }
}

/**
 * Roll back nonce when tx definitely never reached the network.
 * Use cautiously — only when you're 100% sure the tx was never sent.
 */
async function decrementNonce(walletAddress, chain) {
  await Nonce.findOneAndUpdate(
    {
      walletAddress: walletAddress.toLowerCase().trim(),
      chain: chain.toUpperCase(),
    },
    { $inc: { nextNonce: -1 } },
    { upsert: false }   // Do NOT upsert on decrement
  );
}

module.exports = { 
  getAndIncrementNonce, 
  syncNonceWithChain, 
  decrementNonce 
};
