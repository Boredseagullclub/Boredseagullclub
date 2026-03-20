// services/confirmationChecker.js
const { ethers } = require('ethers');
const Deposit = require('../models/Deposit');
const logger = require('../utils/logger');

const CONFIRMATIONS = {
  XDC: 12,
  FLR: 12,
  // other chains can stay at 1 or skip
};

async function checkConfirmations() {
  const pending = await Deposit.find({
    status: 'DETECTED',
    chain: { $in: ['XDC', 'FLR'] }
  }).lean();

  for (const dep of pending) {
    const chainConfig = SUPPORTED_CHAINS[dep.chain];
    if (!chainConfig) continue;

    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl); // or reuse from evmListener
      const tx = await provider.getTransaction(dep.txHash);
      if (!tx) continue;

      const receipt = await provider.getTransactionReceipt(dep.txHash);
      if (!receipt) continue;

      const currentBlock = await provider.getBlockNumber();
      const confs = currentBlock - receipt.blockNumber + 1;

      if (confs >= (CONFIRMATIONS[dep.chain] || 1)) {
        await Deposit.updateOne(
          { _id: dep._id },
          { $set: { status: 'CONFIRMED', confirmations: confs } }
        );
        logger.info({
          module: 'ConfirmationChecker',
          event: 'deposit_confirmed',
          txHash: dep.txHash,
          chain: dep.chain,
          confirmations: confs
        });
      }
    } catch (err) {
      logger.error({
        module: 'ConfirmationChecker',
        txHash: dep.txHash,
        error: err.message
      });
    }
  }
}

// Run every 60 seconds
setInterval(checkConfirmations, 60_000);

// Also expose for manual trigger if needed
module.exports = { checkConfirmations };
