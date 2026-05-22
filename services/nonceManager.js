// services/nonceManager.js
const Nonce = require('../models/Nonce');
const logger = require('../logger');

async function getAndIncrementNonce(walletAddress, chain, session = null) {
  const filter = {
    walletAddress: walletAddress.toLowerCase().trim(),
    chain: chain.toUpperCase(),
  };

  const options = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
    ...(session && { session }),   // Support MongoDB transaction session if provided
  };

  try {
    const doc = await Nonce.findOneAndUpdate(
      filter,
      { $inc: { nextNonce: 1 } },
      options
    );

    const usedNonce = doc.nextNonce - 1;
    logger.debug({
      module: 'NonceManager',
      event: 'nonce_allocated',
      walletAddress: filter.walletAddress,
      chain: filter.chain,
      nonce: usedNonce
    });

    return usedNonce;
  } catch (err) {
    logger.error({
      module: 'NonceManager',
      event: 'GET_INCREMENT_FAILED',
      walletAddress: filter.walletAddress,
      chain: filter.chain,
      error: err.message
    });
    throw err;
  }
}

async function syncNonceWithChain(walletAddress, chain, provider) {
  try {
    // Consider using 'latest' + manual pending check in high-contention scenarios
    const onChainNonce = await provider.getTransactionCount(
      walletAddress,
      'pending'   // Good for most bridge/hot-wallet use cases
    );

    await Nonce.findOneAndUpdate(
      {
        walletAddress: walletAddress.toLowerCase().trim(),
        chain: chain.toUpperCase(),
      },
      { $set: { nextNonce: onChainNonce } },
      { upsert: true }
    );

    logger.info({
      module: 'NonceManager',
      event: 'nonce_synced',
      walletAddress,
      chain,
      syncedNonce: onChainNonce
    });

    return onChainNonce;
  } catch (err) {
    logger.error({
      module: 'NonceManager',
      event: 'SYNC_FAILED',
      walletAddress,
      chain,
      error: err.message
    });
    throw err;
  }
}

/**
 * Use ONLY when you are 100% sure the transaction was never broadcast
 * (e.g., signing failed before sendRawTransaction).
 * Otherwise you risk nonce gaps or "nonce too low" issues.
 */
/**
 * Use ONLY when you are 100% sure the transaction was never broadcast
 * (e.g., signing failed before sendRawTransaction).
 * Otherwise you risk nonce gaps or "nonce too low" issues.
 */
async function decrementNonce(walletAddress, chain, session = null) {
  const filter = {
    walletAddress: walletAddress.toLowerCase().trim(),
    chain: chain.toUpperCase(),
  };

  const options = { 
    upsert: false, 
    ...(session && { session }) 
  };

  const result = await Nonce.findOneAndUpdate(
    filter,
    { $inc: { nextNonce: -1 } },
    options
  );

  if (result.matchedCount === 0) {
    logger.warn({
      module: 'NonceManager',
      event: 'decrement_no_document',
      walletAddress,
      chain
    });
    return null;                    // ← clear signal that nothing was decremented
  }

  return result;   // success - return the result (or you could return result.nextNonce if you want)
}

module.exports = { 
  getAndIncrementNonce, 
  syncNonceWithChain, 
  decrementNonce 
};
