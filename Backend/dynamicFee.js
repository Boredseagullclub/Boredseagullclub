// dynamicFee.js - FINAL INSTITUTIONAL VERSION
const config = require('./config');

async function getDynamicFee(fromToken, toToken) {
  const from = fromToken.toUpperCase();
  const to = toToken.toUpperCase();

  const isFromL2 = (from === 'SEAGULLCOIN' || from === 'SEAGULLCASH');
  const isToL2   = (to === 'SEAGULLCOIN' || to === 'SEAGULLCASH');

  // 1. L2 to L2 (The Loyalty Tier)
  if (isFromL2 && isToL2) return 0.001; 

  // 2. Any exit to Native (The Exit Toll)
  if (!isToL2) return 0.004;

  // 3. Entry from Native to L2 (Incentivized Entry)
  if (!isFromL2 && isToL2) return 0.001; 

  // 4. Native to Native (Standard Utility Bridge)
  return 0.004;
}

module.exports = { getDynamicFee };
