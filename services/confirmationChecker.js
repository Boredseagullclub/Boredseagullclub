// services/confirmationChecker.js
const { ethers } = require('ethers');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Deposit = require('../models/Deposit');
const config = require('../config'); // assuming this has SUPPORTED_CHAINS

const CONFIRMATION_LEVELS = {
  XDC: 12,     // conservative – XDC Network is quite stable
  FLR: 12,     // Flare has similar finality characteristics
  // XRPL, XLM, HBAR can stay at 1 or be skipped
};

const CHECK_INTERVAL_MS = 60_000;       // every minute
const MAX_CONCURRENT_CHECKS = 5;        // avoid flooding RPCs

async function checkAndConfirmDeposits() {
  const chainsToCheck = Object.keys(CONFIRMATION_LEVELS);

  const pendingDeposits = await Deposit.find({
    status: 'DETECTED',
    chain: { $in: chainsToCheck },
    // Optional: only check deposits older than ~5 minutes to avoid noise
    txTimestamp: { $lt: new Date(Date.now() - 5 * 60 * 1000) }
  })
    .limit(50) // safety limit per run
    .lean();

  if (!pendingDeposits.length) return;

  logger.info({
    module: 'ConfirmationChecker',
    event: 'checking_batch',
    count: pendingDeposits.length
  });

  const promises = pendingDeposits.map(async (dep) => {
    const requiredConfs = CONFIRMATION_LEVELS[dep.chain] || 1;
    const chainConfig = config.CHAINS?.[dep.chain] || config.SUPPORTED_CHAINS?.[dep.chain];

    if (!chainConfig?.rpcUrl) {
      logger.warn({ event: 'missing_rpc_config', chain: dep.chain });
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);

      const receipt = await provider.getTransactionReceipt(dep.txHash);
      if (!receipt) {
        // tx not mined yet or dropped
        return;
      }

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      if (confirmations >= requiredConfs) {
        await Deposit.updateOne(
          { _id: dep._id },
          {
            $set: {
              status: 'CONFIRMED',
              confirmations,
              confirmedAt: new Date(),
              confirmedBlock: receipt.blockNumber
            }
          }
        );

        logger.info({
          module: 'ConfirmationChecker',
          event: 'deposit_confirmed',
          txHash: dep.txHash,
          chain: dep.chain,
          confirmations,
          userId: dep.userId?.toString()
        });
      } else if (confirmations < 0) {
        // possible reorg – tx disappeared
        logger.warn({
          event: 'possible_reorg_detected',
          txHash: dep.txHash,
          chain: dep.chain,
          lastKnownBlock: receipt.blockNumber,
          currentBlock
        });
        // Optional: mark as REORGED or FAILED – your choice
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

  // Limit concurrency to avoid overwhelming RPC providers
  await Promise.allSettled(promises.slice(0, MAX_CONCURRENT_CHECKS));
}

// Start periodic checking
setInterval(checkAndConfirmDeposits, CHECK_INTERVAL_MS);

// For manual testing or startup
checkAndConfirmDeposits().catch(err => {
  logger.error({ module: 'ConfirmationChecker', event: 'startup_error', error: err.message });
});

module.exports = { checkAndConfirmDeposits };        );
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
