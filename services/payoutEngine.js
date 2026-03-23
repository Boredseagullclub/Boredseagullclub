const { ethers } = require('ethers');
const Withdrawal = require('../models/Withdrawal');
const { performFullAudit } = require('./reconciler');
const logger = require('../utils/logger');
const { getAndIncrementNonce, syncNonceWithChain } = require('../services/nonceManager');  // ← ADD THIS LINE

/**
 * Executes on-chain payout with a pre-flight solvency check 
 * and an iterative gas-bumping strategy.
 */
async function executeOnChainPayout(withdrawalId) {
  const withdrawal = await Withdrawal.findById(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'PENDING') return;

  // ─── 1. THE CIRCUIT BREAKER (PRE-FLIGHT) ────────────────────────
  try {
    const audit = await performFullAudit();
    if (audit.overallStatus !== 'SOLVENT') {
      logger.fatal({ 
        module: 'PayoutEngine', 
        event: 'HALTING_OUTFLOW', 
        status: audit.overallStatus,
        withdrawalId 
      });
      await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'HALTED_AUDIT_FAIL' });
      return;
    }
  } catch (auditErr) {
    logger.error({ module: 'PayoutEngine', event: 'AUDIT_CRASH', error: auditErr.message });
    return; // Safety first: fail-closed
  }

  const chain = withdrawal.chain.toUpperCase();
  const provider = new ethers.JsonRpcProvider(process.env[`${chain}_RPC_URL`]);
  
  // NOTE: In the future, replace this with a Cloud KMS provider for security
  const wallet = new ethers.Wallet(process.env[`${chain}_HOT_WALLET_KEY`], provider);

  let attempt = 0;
  const maxAttempts = 5;

  // ─── 2. THE SIGNING LOOP (GAS BUMPING) ──────────────────────────
  while (attempt < maxAttempts) {
    try {
      // ─── NONCE LOGIC: Only for EVM chains ────────────────────────
      let nonce;
      if (['XDC', 'FLR'].includes(chain)) {
        const depositAddress = process.env[`${chain}_DEPOSIT_ADDRESS`];

        // Optional pre-sync (recommended for production)
        try {
          await syncNonceWithChain(depositAddress, chain, provider);
          logger.info({ module: 'PayoutEngine', event: 'NONCE_SYNCED', chain, withdrawalId });
        } catch (syncErr) {
          logger.warn({ module: 'PayoutEngine', event: 'NONCE_SYNC_FAILED', chain, error: syncErr.message });
          // Continue — we can still try
        }

        nonce = await getAndIncrementNonce(depositAddress, chain);
        logger.info({ module: 'PayoutEngine', event: 'NONCE_ALLOCATED', chain, nonce, withdrawalId });
      } else {
        // For non-EVM chains (XRPL, XLM, HBAR) — no nonce needed
        nonce = undefined;
      }

      const feeData = await provider.getFeeData();
      const multiplier = 115n + (BigInt(attempt) * 20n);
      const gasPrice = (feeData.gasPrice * multiplier) / 100n;

      const txRequest = {
        to: withdrawal.toAddress,
        value: ethers.parseUnits(withdrawal.amount.toString(), 18),
        nonce,                     // ← now safe for EVM!
        gasPrice,
        gasLimit: 21000,
      };

      const txResponse = await wallet.sendTransaction(txRequest);
      
      logger.info({ 
        module: 'PayoutEngine', 
        event: 'TX_BROADCAST', 
        attempt, 
        hash: txResponse.hash 
      });

      // Wait for 1 confirmation with a 60s timeout
      const receipt = await Promise.race([
        txResponse.wait(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 60000))
      ]);

      if (receipt) {
        await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'COMPLETED', txHash: receipt.hash });
        return receipt.hash;
      }

    } catch (err) {
      if (err.message === 'TIMEOUT') {
        attempt++;
        logger.warn({ module: 'PayoutEngine', event: 'REPLACING_TX', attempt, withdrawalId });
        continue; // Loop again with higher gas but SAME nonce
      }

      if (err.message.includes('nonce too low') || err.message.includes('already known')) {
        logger.info({ module: 'PayoutEngine', event: 'TX_ALREADY_MINED', withdrawalId });
        return;
      }

      logger.error({ module: 'PayoutEngine', event: 'PAYOUT_ERROR', error: err.message });
      await Withdrawal.updateOne({ _id: withdrawalId }, { status: 'FAILED', error: err.message });
      throw err;
    }
  }
}

module.exports = { executeOnChainPayout };
