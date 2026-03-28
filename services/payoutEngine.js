// services/payoutEngine.js
const { ethers } = require('ethers');
const Withdrawal = require('../models/Withdrawal');
const logger = require('../utils/logger');
const config = require('../config');
const {
  getAndIncrementNonce,
  syncNonceWithChain,
  decrementNonce,
} = require('./nonceManager');

const MAX_NONCE_RETRIES = 2;

async function executeOnChainPayout(withdrawalId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PENDING') {
    logger.warn({ module: 'PayoutEngine', event: 'SKIP_WITHDRAWAL', withdrawalId });
    return;
  }

  const chain = withdrawal.chain.toUpperCase();
  const token = withdrawal.token.toUpperCase();

  const tokenSpec = config.TOKENS?.[token]?.networks?.[chain] || {};
  const chainSpec = config.CHAINS?.[chain] || {};
  const decimals = tokenSpec.decimals ?? chainSpec.decimals ?? 18;

  const rpcUrl = process.env[`${chain}_RPC_URL`];
  const hotWalletKey = process.env[`${chain}_HOT_WALLET_KEY`];

  if (!rpcUrl || !hotWalletKey) {
    const msg = `Missing RPC or hot wallet key for ${chain}`;
    logger.error({ module: 'PayoutEngine', event: 'CONFIG_ERROR', withdrawalId, chain });
    await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'FAILED', error: msg });
    throw new Error(msg);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(hotWalletKey, provider);
  const walletAddress = wallet.address;

  const amountStr = withdrawal.amount.toString(); // Decimal128 → string
  const amountWei = ethers.parseUnits(amountStr, decimals);

  // Build base transaction
  let txRequest = {};
  if (tokenSpec.contract) {
    const erc20Interface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)',
    ]);
    txRequest = {
      to: tokenSpec.contract,
      data: erc20Interface.encodeFunctionData('transfer', [withdrawal.toAddress, amountWei]),
      value: 0n,
    };
  } else {
    txRequest = {
      to: withdrawal.toAddress,
      value: amountWei,
    };
  }

  // Gas price with 25% bump
  const feeData = await provider.getFeeData();
  txRequest.gasPrice = feeData.gasPrice 
    ? (feeData.gasPrice * 125n) / 100n 
    : undefined;

  // Gas estimate with fallback
  try {
    const estimated = await provider.estimateGas({ ...txRequest, from: walletAddress });
    txRequest.gasLimit = (estimated * 125n) / 100n;
  } catch (estimateErr) {
    txRequest.gasLimit = tokenSpec.contract ? 120_000n : 21_000n;
    logger.warn({
      module: 'PayoutEngine',
      event: 'GAS_ESTIMATE_FALLBACK',
      withdrawalId,
      fallback: txRequest.gasLimit.toString(),
      error: estimateErr.message,
    });
  }

  // Nonce retry loop
  let attempt = 0;
  while (attempt <= MAX_NONCE_RETRIES) {
    const nonce = await getAndIncrementNonce(walletAddress, chain);
    txRequest.nonce = nonce;

    try {
      logger.info({
        module: 'PayoutEngine',
        event: 'TX_BROADCAST_START',
        withdrawalId,
        chain,
        token,
        nonce,
        isTokenTransfer: !!tokenSpec.contract,
      });

      const txResponse = await wallet.sendTransaction(txRequest);

      await Withdrawal.updateOne(
        { _id: withdrawalId },
        { status: 'PROCESSING', txHash: txResponse.hash }
      );

      const receipt = await txResponse.wait(1);

      if (receipt.status === 1) {
        await Withdrawal.updateOne(
          { _id: withdrawalId },
          { status: 'COMPLETED', txHash: receipt.hash }
        );
        logger.info({
          module: 'PayoutEngine',
          event: 'TX_SUCCESS',
          withdrawalId,
          hash: receipt.hash,
        });
        return receipt.hash;
      } else {
        throw new Error('Transaction reverted on-chain');
      }
    } catch (err) {
      const isNonceError = 
        err.message.includes('nonce too low') ||
        err.message.includes('already known') ||
        err.message.includes('replacement transaction underpriced');

      if (isNonceError && attempt < MAX_NONCE_RETRIES) {
        logger.warn({
          module: 'PayoutEngine',
          event: 'NONCE_COLLISION_RESYNC',
          withdrawalId,
          attempt,
          nonce,
          error: err.message,
        });

        await syncNonceWithChain(walletAddress, chain, provider);
        attempt++;
        continue;
      }

      // Non-nonce error → possibly decrement
      const neverBroadcast = 
        err.message.includes('nonce too low') ||
        err.message.includes('insufficient funds') ||
        err.message.includes('gas');

      if (neverBroadcast) {
        await decrementNonce(walletAddress, chain).catch(() => {});
      }

      logger.error({
        module: 'PayoutEngine',
        event: 'PAYOUT_ERROR',
        withdrawalId,
        nonce,
        attempt,
        error: err.message,
      });

      await Withdrawal.updateOne(
        { _id: withdrawalId },
        { status: 'FAILED', error: err.message }
      );

      throw err;
    }
  }
}

module.exports = { executeOnChainPayout };
