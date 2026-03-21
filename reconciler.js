const mongoose = require('mongoose');
const { Client: XrplClient } = require('xrpl');
const { Server: StellarServer } = require('stellar-sdk');
const { Client: HederaClient, AccountBalanceQuery } = require('@hashgraph/sdk');
const User = require('../models/User');
const logger = require('../utils/logger');
const config = require('../config');

async function runReconciliation() {
  logger.info({ module: 'Audit', event: 'reconciliation_start' });
  
  try {
    // 1. Calculate Total Liabilities (What users have in DB)
    const userTotals = await User.aggregate([
      { $project: { balances: { $objectToArray: "$balances" } } },
      { $unwind: "$balances" },
      { $group: { _id: "$balances.k", total: { $sum: "$balances.v" } } }
    ]);

    const liabilities = userTotals.reduce((acc, curr) => {
      acc[curr._id] = curr.total.toString();
      return acc;
    }, {});

    // 2. Fetch Actual Assets (On-Chain Hot Wallets)
    const assets = await fetchHotWalletBalances();

    // 3. Comparison Logic
    const report = {};
    for (const [token, liabilityAmount] of Object.entries(liabilities)) {
      const assetAmount = assets[token] || "0";
      const diff = parseFloat(assetAmount) - parseFloat(liabilityAmount);
      
      report[token] = {
        db_total: liabilityAmount,
        chain_total: assetAmount,
        status: diff >= 0 ? 'HEALTHY' : 'DEFICIT',
        gap: diff
      };

      if (diff < 0) {
        logger.error({ 
          module: 'Audit', 
          event: 'DEFICIT_DETECTED', 
          token, 
          gap: diff 
        });
      }
    }

    return report;

  } catch (err) {
    logger.error({ module: 'Audit', event: 'reconciliation_fail', error: err.message });
  }
}

async function fetchHotWalletBalances() {
  const balances = {};

  // XRPL Check
  const xrpl = new XrplClient(process.env.XRPL_WS_URL);
  await xrpl.connect();
  const xrpInfo = await xrpl.request({ 
    command: 'account_info', 
    account: process.env.XRP_HOT_WALLET 
  });
  balances['XRP'] = (parseInt(xrpInfo.result.account_data.Balance) / 1000000).toString();
  await xrpl.disconnect();

  // Hedera Check
  const hedera = HederaClient.forMainnet();
  const hbarBalance = await new AccountBalanceQuery()
    .setAccountId(process.env.HEDERA_HOT_WALLET)
    .execute(hedera);
  balances['HBAR'] = hbarBalance.hbars.toString();

  // Add Stellar/EVM logic here...
  
  return balances;
}

module.exports = { runReconciliation };
