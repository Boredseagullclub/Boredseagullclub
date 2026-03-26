// services/payoutEngine.js
const { ethers } = require('ethers');
const Withdrawal = require('../models/Withdrawal');
const logger = require('../utils/logger');
const config = require('../config');

async function executeOnChainPayout(withdrawalId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PENDING') {
    logger.warn({ module: 'PayoutEngine', event: 'SKIP_WITHDRAWAL', withdrawalId });
    return;
  }

  const chain = withdrawal.chain.toUpperCase();
  const token = withdrawal.token.toUpperCase();
  const tokenSpec = config.TOKENS[token]?.networks?.[chain] || {};

  const decimals = tokenSpec.decimals || config.CHAINS[chain]?.decimals || 18;

  try {
    const rpcUrl = process.env[`${chain}_RPC_URL`];
    const hotWalletKey = process.env[`${chain}_HOT_WALLET_KEY`];

    if (!rpcUrl || !hotWalletKey) {
      throw new Error(`Missing RPC or hot wallet key for ${chain}`);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(hotWalletKey, provider);

    const amountWei = ethers.parseUnits(withdrawal.amount.toString(), decimals);

    const feeData = await provider.getFeeData();
    const gasPrice = (feeData.gasPrice * 125n) / 100n;

    let txRequest = {
      gasPrice,
      nonce: undefined, // ethers can manage or plug in nonceManager later
    };

    if (tokenSpec.contract) {
      // ERC-20 transfer
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount) returns (bool)'
      ]);
      txRequest.to = tokenSpec.contract;
      txRequest.data = erc20Interface.encodeFunctionData('transfer', [
        withdrawal.toAddress,
        amountWei
      ]);
      txRequest.value = 0n;
    } else {
      // Native transfer
      txRequest.to = withdrawal.toAddress;
      txRequest.value = amountWei;
    }

    // Dynamic gas estimation with safety buffer
    try {
      const estimated = await provider.estimateGas(txRequest);
      txRequest.gasLimit = (estimated * 125n) / 100n; // 25% buffer
    } catch (estimateErr) {
      txRequest.gasLimit = tokenSpec.contract ? 120000n : 21000n;
      logger.warn({
        module: 'PayoutEngine',
        event: 'GAS_ESTIMATE_FALLBACK',
        withdrawalId,
        fallback: txRequest.gasLimit.toString(),
        error: estimateErr.message
      });
    }

    logger.info({
      module: 'PayoutEngine',
      event: 'TX_BROADCAST_START',
      withdrawalId,
      chain,
      token,
      isTokenTransfer: !!tokenSpec.contract
    });

    const txResponse = await wallet.sendTransaction(txRequest);

    // Mark as processing immediately after broadcast
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
      logger.info({ module: 'PayoutEngine', event: 'TX_SUCCESS', withdrawalId, hash: receipt.hash });
    } else {
      throw new Error('Transaction reverted on-chain');
    }

    return receipt.hash;

  } catch (err) {
    logger.error({
      module: 'PayoutEngine',
      event: 'PAYOUT_ERROR',
      withdrawalId,
      error: err.message
    });

    if (err.message.includes('nonce too low') || err.message.includes('already known')) {
      logger.info({ module: 'PayoutEngine', event: 'TX_ALREADY_KNOWN', withdrawalId });
      return;
    }

    await Withdrawal.updateOne(
      { _id: withdrawalId },
      { status: 'FAILED', error: err.message }
    );

    throw err;
  }
}

module.exports = { executeOnChainPayout };
