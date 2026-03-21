const User = require('../models/User');
const { Client: XrplClient } = require('xrpl');
const StellarSdk = require('stellar-sdk');
const { Client: HederaClient, AccountBalanceQuery } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const Decimal = require('decimal.js');
const logger = require('../utils/logger');
const config = require('../config'); // your token/chain config

/**
 * Full solvency audit: DB liabilities vs verified on-chain assets
 * Returns report + throws on critical issues
 */
async function performFullAudit() {
  logger.info({ module: 'Audit', event: 'reconciliation_started' });

  const report = {
    timestamp: new Date().toISOString(),
    liabilities: {},
    assets: {},
    discrepancies: [],
    status: 'OK',
  };

  try {
    // 1. Liabilities from DB (all tokens)
    const dbLiabilities = await User.aggregate([
      { $project: { balances: { $objectToArray: '$balances' } } },
      { $unwind: '$balances' },
      {
        $group: {
          _id: '$balances.k',
          totalOwed: { $sum: { $toDouble: '$balances.v' } },
        },
      },
    ]);

    report.liabilities = dbLiabilities.reduce((acc, { _id, totalOwed }) => {
      acc[_id] = new Decimal(totalOwed);
      return acc;
    }, {});

    // 2. Fetch verified on-chain assets (hot + cold wallets if applicable)
    report.assets = await getVerifiedOnChainAssets();

    // 3. Compare
    for (const [token, owed] of Object.entries(report.liabilities)) {
      const held = report.assets[token] || new Decimal(0);
      const diff = held.minus(owed);

      report.discrepancies.push({
        token,
        owed: owed.toString(),
        held: held.toString(),
        difference: diff.toString(),
        status: diff.gte(0) ? 'SOLVENT' : 'DEFICIT',
      });

      if (diff.lt(0)) {
        report.status = 'DEFICIT';
        logger.error({
          module: 'Audit',
          event: 'CRITICAL_DEFICIT',
          token,
          owed: owed.toString(),
          held: held.toString(),
          missing: diff.abs().toString(),
        });
        // TODO: trigger alert (Slack/PagerDuty)
      }
    }

    return report;
  } catch (err) {
    logger.error({ module: 'Audit', event: 'audit_failed', error: err.message, stack: err.stack });
    throw err;
  }
}

/**
 * Fetch balances from all relevant deposit/hot/cold addresses with validation
 */
async function getVerifiedOnChainAssets() {
  const assets = {};

  // ─── XRPL ───────────────────────────────────────────────────────────────
  const xrplClient = new XrplClient(process.env.XRPL_WS_URL);
  try {
    await xrplClient.connect();
    const account = process.env.XRPL_DEPOSIT_ADDRESS;
    const info = await xrplClient.request({
      command: 'account_lines',
      account,
      ledger_index: 'validated',
    });

    // Native XRP
    const accountInfo = await xrplClient.request({
      command: 'account_info',
      account,
    });
    assets.XRP = new Decimal(accountInfo.result.account_data.Balance).div(1_000_000);

    // Issued tokens (only trusted issuers)
    for (const line of info.result.lines) {
      const token = Object.keys(config.TOKENS).find(
        t => config.TOKENS[t].networks?.XRP?.issuer === line.account
      );
      if (token) {
        assets[token] = new Decimal(line.balance);
      }
    }
  } finally {
    xrplClient.disconnect();
  }

  // ─── Stellar ────────────────────────────────────────────────────────────
  const stellarServer = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
  const stellarAcct = await stellarServer.loadAccount(process.env.STELLAR_DEPOSIT_ADDRESS);
  for (const bal of stellarAcct.balances) {
    if (bal.asset_type === 'native') {
      assets.XLM = new Decimal(bal.balance);
    } else {
      const token = Object.keys(config.TOKENS).find(
        t => config.TOKENS[t].networks?.XLM?.issuer === bal.asset_issuer &&
             config.TOKENS[t].networks?.XLM?.code === bal.asset_code
      );
      if (token) {
        assets[token] = new Decimal(bal.balance);
      }
    }
  }

  // ─── Hedera (example - add EVM similarly) ───────────────────────────────
  // const hederaClient = HederaClient.forMainnet().setOperator(...);
  // const balance = await new AccountBalanceQuery()
  //   .setAccountId(process.env.HEDERA_DEPOSIT_ACCOUNT)
  //   .execute(hederaClient);
  // assets.HBAR = new Decimal(balance.hbars.toTinybars()).div(1e8);
  // ... HTS tokens ...

  return assets;
}

module.exports = { performFullAudit };
