// services/reorgMonitor.js
const Deposit = require('../models/Deposit');
const { ethers } = require('ethers');
const logger = require('../utils/logger');

async function watchForReorgs() {
  // Check deposits from the last 2 hours that were already credited
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeDeposits = await Deposit.find({
    status: 'CREDITED',
    createdAt: { $gt: cutoff },
    chain: { $in: ['FLR', 'XDC'] } // Focus on EVM first
  });

  for (const dep of activeDeposits) {
    const rpcUrl = process.env[`${dep.chain}_RPC_URL`];
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    try {
      const tx = await provider.getTransaction(dep.txHash);
      
      // If the TX is missing, it was likely reorged out of existence
      if (!tx) {
        logger.error({
          module: 'ReorgMonitor',
          event: 'POSSIBLE_REORG_DETECTED',
          txHash: dep.txHash,
          userId: dep.userId
        });

        // ACTION: Flag the deposit for manual review 
        // and potentially lock the User's processing flag
        await Deposit.updateOne({ _id: dep._id }, { status: 'REORG_ALARM' });
      }
    } catch (err) {
      logger.warn(`Reorg check failed for ${dep.txHash}: ${err.message}`);
    }
  }
}

setInterval(watchForReorgs, 5 * 60 * 1000); // Run every 5 minutes
