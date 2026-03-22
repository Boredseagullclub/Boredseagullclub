// services/payoutEngine.js
const { ethers } = require('ethers');
const Withdrawal = require('../models/Withdrawal');
const logger = require('../utils/logger');

async function executeOnChainPayout(withdrawalId, retryCount = 0) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PENDING') return;

  const chain = withdrawal.chain.toUpperCase();
  const provider = new ethers.JsonRpcProvider(process.env[`${chain}_RPC_URL`]);
  const wallet = new ethers.Wallet(process.env[`${chain}_HOT_WALLET_KEY`], provider);

  try {
    // 1. Get Fee Data with a 15% priority buffer
    const feeData = await provider.getFeeData();
    const multiplier = 115n + (BigInt(retryCount) * 20n); // Bump by 20% each retry
    const gasPrice = (feeData.gasPrice * multiplier) / 100n;

    // 2. Prepare Transaction
    const txRequest = {
      to: withdrawal.toAddress,
      value: ethers.parseUnits(withdrawal.amount.toString(), 18), // Adjust decimals per token
      nonce: await wallet.getNonce('pending'), // Get the next available nonce including mempool
      gasPrice: gasPrice,
      gasLimit: 21000, // Standard transfer; use estimateGas for tokens
    };

    const txResponse = await wallet.sendTransaction(txRequest);
    logger.info({ event: 'TX_SUBMITTED', txHash: txResponse.hash, withdrawalId });

    // 3. The Race: Wait 60 seconds or timeout
    const receipt = await Promise.race([
      txResponse.wait(1),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), 60000)
      )
    ]);

    return receipt.hash;

  } catch (err) {
    if (err.message === 'TIMEOUT' && retryCount < 5) {
      logger.warn({ event: 'TX_STUCK_RETRYING', withdrawalId, attempt: retryCount + 1 });
      // Recursive call with increased retryCount to bump gas
      return executeOnChainPayout(withdrawalId, retryCount + 1);
    }

    logger.error({ event: 'PAYOUT_FAILED_PERMANENTLY', withdrawalId, error: err.message });
    throw err;
  }
}

module.exports = { executeOnChainPayout };
