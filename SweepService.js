// SweepService.js
const { settleOnChain } = require('./BridgeService');
const { performFullAudit } = require('./reconciler');
const logger = require('./logger');
const Decimal = require('decimal.js');

const SAFETY_BUFFER = 10; // Leave 10 units of the token for gas/dust

async function sweepProfits(tokenSymbol, chain) {
  logger.info({ module: 'SweepService', event: 'start', token: tokenSymbol });

  // 1. Run a fresh audit to ensure we have the latest profit numbers
  const audit = await performFullAudit();
  
  if (audit.overallStatus !== 'SOLVENT') {
    throw new Error("Cannot sweep: System is not currently solvent or audit failed.");
  }

  // 2. Find the surplus for this specific token
  const entry = audit.discrepancies.find(d => d.token.toUpperCase() === tokenSymbol.toUpperCase());
  if (!entry) throw new Error("Token not found in audit report.");

  const surplus = new Decimal(entry.difference); // (Held - Owed)

  // 3. Subtract Safety Buffer
  const sweepAmount = surplus.minus(SAFETY_BUFFER);

  if (sweepAmount.lte(0)) {
    logger.info({ module: 'SweepService', event: 'skip', msg: 'Surplus below safety buffer' });
    return { success: false, msg: 'Nothing to sweep after buffer' };
  }

  // 4. Send to Cold Wallet
  const destination = process.env[`${chain.toUpperCase()}_COLD_WALLET`];
  if (!destination) throw new Error(`Cold wallet not configured for ${chain}`);

  logger.warn({ 
    module: 'SweepService', 
    event: 'executing_transfer', 
    amount: sweepAmount.toString(), 
    to: destination 
  });

  const txHash = await settleOnChain(destination, tokenSymbol, sweepAmount.toString(), chain);

  return {
    success: true,
    txHash,
    amount: sweepAmount.toString(),
    token: tokenSymbol
  };
}

module.exports = { sweepProfits };
