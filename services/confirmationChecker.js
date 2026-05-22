// services/confirmationChecker.js
const { ethers } = require('ethers');
const Deposit = require('../models/Deposit');
const logger = require('../logger');
const config = require('../config');   // or '../config/walletconfig' if needed

const CONFIRMATION_LEVELS = {
  XDC: 12,
  FLR: 12,
};

const CHECK_INTERVAL_MS = 60_000;

async function checkAndConfirmDeposits() {
  const chainsToCheck = Object.keys(CONFIRMATION_LEVELS);

  const pending = await Deposit.find({
    status: 'DETECTED',
    chain: { $in: chainsToCheck },
    txTimestamp: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
  }).limit(50).lean();

  if (!pending.length) return;

  logger.info({ module: 'ConfirmationChecker', event: 'batch_check', count: pending.length });

  const promises = pending.map(async (dep) => {
    try {
      const chainConfig = config.CHAINS?.[dep.chain] || {};
      if (!chainConfig.rpcUrl) {
        logger.warn({ event: 'missing_rpc', chain: dep.chain });
        return;
      }

      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      const receipt = await provider.getTransactionReceipt(dep.txHash);

      if (!receipt) return;

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;
      const required = CONFIRMATION_LEVELS[dep.chain] || 1;

      if (confirmations >= required) {
        await Deposit.updateOne(
          { _id: dep._id },
          {
            status: 'CONFIRMED',
            confirmations,
            confirmedAt: new Date(),
            confirmedBlock: receipt.blockNumber
          }
        );

        logger.info({
          module: 'ConfirmationChecker',
          event: 'deposit_confirmed',
          txHash: dep.txHash,
          chain: dep.chain,
          confirmations
        });
      }
    } catch (err) {
      logger.error({
        module: 'ConfirmationChecker',
        txHash: dep.txHash,
        chain: dep.chain,
        error: err.message
      });
    }
  });

  await Promise.allSettled(promises);
}

// Auto-start checker
setInterval(checkAndConfirmDeposits, CHECK_INTERVAL_MS);

// Export for manual trigger if needed
module.exports = { checkAndConfirmDeposits };
