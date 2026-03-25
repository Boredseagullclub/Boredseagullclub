// services/payoutEngine.js
const { ethers } = require('ethers');
const Withdrawal = require('../models/Withdrawal');
const logger = require('../utils/logger');
const { getAndIncrementNonce, syncNonceWithChain } = require('./nonceManager'); // remove this line if nonceManager doesn't exist yet

async function executeOnChainPayout(withdrawalId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PENDING') return;

  const chain = withdrawal.chain.toUpperCase();

  try {
    const provider = new ethers.JsonRpcProvider(process.env[`${chain}_RPC_URL`]);
    const wallet = new ethers.Wallet(process.env[`${chain}_HOT_WALLET_KEY`], provider);

    let nonce;
    if (['XDC', 'FLR'].includes(chain)) {
      const depositAddr = process.env[`${chain}_DEPOSIT_ADDRESS`];
      try {
        await syncNonceWithChain(depositAddr, chain, provider);
      } catch (e) {
        logger.warn({ module: 'PayoutEngine', event: 'NONCE_SYNC_FAILED', chain, error: e.message });
      }
      nonce = await getAndIncrementNonce(depositAddr, chain);
    }

    const feeData = await provider.getFeeData();
    const gasPrice = (feeData.gasPrice * 120n) / 100n; // 20% bump

    const txRequest = {
      to: withdrawal.toAddress,
      value: ethers.parseUnits(withdrawal.amount.toString(), 18),
      nonce,
      gasPrice,
      gasLimit: 21000,
    };

    const txResponse = await wallet.sendTransaction(txRequest);
    logger.info({ module: 'PayoutEngine', event: 'TX_BROADCAST', hash: txResponse.hash, withdrawalId });

    const receipt = await txResponse.wait(1);
    await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'COMPLETED', txHash: receipt.hash });

    return receipt.hash;

  } catch (err) {
    logger.error({ module: 'PayoutEngine', withdrawalId, error: err.message });

    if (err.message.includes('nonce too low') || err.message.includes('already known')) {
      logger.info({ module: 'PayoutEngine', event: 'TX_ALREADY_MINED_OR_NONCE_ISSUE', withdrawalId });
      return;
    }

    await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'FAILED', error: err.message });
    throw err;
  }
}

module.exports = { executeOnChainPayout };
