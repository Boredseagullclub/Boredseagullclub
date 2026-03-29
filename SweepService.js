// SweepService.js
const { settleOnChain } = require('./BridgeService');
const { performFullAudit } = require('./reconciler');
const logger = require('./logger');
const Decimal = require('decimal.js');

// 🛡️ The "Don't Break the Bridge" Buffer
// We leave a small amount of native asset to cover gas for future txs
const SAFETY_BUFFER = {
  XRP: 4,    // 20 XRP for reserves/gas
  XLM: 10,    // 30 XLM
  XDC: 100,   // 100 XDC
  FLR: 100,   // 100 FLR
  HBAR: 50,   // 50 HBAR
  DEFAULT: 10
};

/**
 * 🧹 SWEEP PROFITS
 * Transfers the "Surplus" (Assets - Liabilities) to your cold storage.
 */
async function sweepProfits(tokenSymbol, chain) {
  const symbol = tokenSymbol.toUpperCase();
  const chainUpper = chain.toUpperCase();

  logger.info({ module: 'SweepService', event: 'audit_check_start', token: symbol });

  // 1. FRESH AUDIT: Never sweep based on old data
  const audit = await performFullAudit();
  
  if (audit.overallStatus !== 'SOLVENT' && audit.overallStatus !== 'PARTIAL') {
    throw new Error(`🚫 SWEEP BLOCKED: System is in ${audit.overallStatus} status. Solve deficits first.`);
  }

  // 2. FIND SURPLUS: (Held On-Chain - Owed to Users)
  const entry = audit.discrepancies.find(d => d.token.toUpperCase() === symbol);
  if (!entry) throw new Error(`Token ${symbol} not found in recent audit.`);

  const surplus = new Decimal(entry.difference);

  // 3. APPLY BUFFER: Leave some "dust" for gas
  const buffer = SAFETY_BUFFER[symbol] || SAFETY_BUFFER.DEFAULT;
  const sweepAmount = surplus.minus(buffer);

  if (sweepAmount.lte(0)) {
    const msg = `Surplus (${surplus}) is less than safety buffer (${buffer}). Nothing to sweep.`;
    logger.info({ module: 'SweepService', event: 'insufficient_surplus', msg });
    return { success: false, message: msg };
  }

  // 4. COLD WALLET LOOKUP: Pull from .env
  const coldWallet = process.env[`${chainUpper}_COLD_WALLET`];
  if (!coldWallet) {
    throw new Error(`Missing ${chainUpper}_COLD_WALLET in environment variables.`);
  }

  // 5. EXECUTE: Use the existing automated bridge logic to pay yourself
  logger.warn({ 
    module: 'SweepService', 
    event: 'executing_profit_withdrawal', 
    amount: sweepAmount.toString(), 
    destination: coldWallet 
  });

  try {
    const txHash = await settleOnChain(coldWallet, symbol, sweepAmount.toString(), chainUpper);
    
    logger.info({ 
      module: 'SweepService', 
      event: 'sweep_success', 
      amount: sweepAmount.toString(), 
      hash: txHash 
    });

    return {
      success: true,
      token: symbol,
      amount: sweepAmount.toString(),
      txHash
    };
  } catch (err) {
    logger.error({ module: 'SweepService', event: 'transfer_failed', error: err.message });
    throw err;
  }
}

module.exports = { sweepProfits };
