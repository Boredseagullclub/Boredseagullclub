// dynamicFee.js
const config = require('./config');

/**
 * Calculates the tier-based fee for a bridge or swap operation.
 * @param {string} tokenSymbol - The asset being moved (e.g., 'XRP', 'SEAGULLCASH')
 * @returns {number} The decimal fee rate (e.g., 0.004 for 0.4%)
 */
async function getDynamicFee(tokenSymbol) {
  if (!tokenSymbol) return config.FEES.DEFAULT;

  const symbol = tokenSymbol.toUpperCase();

  // 1. Check for Seagull Loyalty Tier (0.1%)
  if (config.FEES[symbol]) {
    return config.FEES[symbol];
  }

  // 2. Check if it's a Native Bridge Asset (0.4%)
  const isNative = Object.values(config.CHAINS).some(
    (chain) => chain.nativeSymbol === symbol
  );

  if (isNative) {
    return config.FEES.NATIVE_ASSET;
  }

  // 3. Fallback to default
  return config.FEES.DEFAULT;
}

module.exports = { getDynamicFee };
