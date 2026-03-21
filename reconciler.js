// services/reconciler.js (or auditService.js)

const User = require('../models/User');
const { Client: XrplClient } = require('xrpl');
const StellarSdk = require('stellar-sdk');
const { Client: HederaClient, AccountBalanceQuery, HbarUnit } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const Decimal = require('decimal.js');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config'); // your token/chain config

/**
 * Full solvency audit: DB liabilities vs verified on-chain assets
 * Returns report + throws on critical failures
 */
async function performFullAudit() {
  logger.info({ module: 'Reconciler', event: 'audit_started' });

  const report = {
    timestamp: new Date().toISOString(),
    liabilities: {},
    assets: {},
    discrepancies: [],
    overallStatus: 'SOLVENT',
    criticalDeficits: [],
  };

  try {
    // 1. Aggregate liabilities from DB (all tokens)
    const dbAgg = await User.aggregate([
      { $project: { balances: { $objectToArray: '$balances' } } },
      { $unwind: '$balances' },
      {
        $group: {
          _id: '$balances.k',
          totalOwed: { $sum: { $toDouble: '$balances.v' } },
        },
      },
    ]);

    report.liabilities = dbAgg.reduce((acc, { _id, totalOwed }) => {
      acc[_id] = new Decimal(totalOwed || 0);
      return acc;
    }, {});

    // 2. Fetch verified on-chain balances
    report.assets = await getVerifiedOnChainBalances();

    // 3. Compare & build report
    for (const [token, owed] of Object.entries(report.liabilities)) {
      const held = report.assets[token] || new Decimal(0);
      const diff = held.minus(owed);

      const entry = {
        token,
        owed: owed.toString(),
        held: held.toString(),
        difference: diff.toString(),
        status: diff.gte(0) ? 'SOLVENT' : 'DEFICIT',
      };

      report.discrepancies.push(entry);

      if (diff.lt(0)) {
        report.overallStatus = 'DEFICIT';
        const missing = diff.abs();
        report.criticalDeficits.push({ token, missing: missing.toString() });

        logger.error({
          module: 'Reconciler',
          event: 'DEFICIT_DETECTED',
          token,
          owed: owed.toString(),
          held: held.toString(),
          missing: missing.toString(),
        });

        // Real alert
        await sendDeficitAlert({ token, missing: missing.toString(), owed: owed.toString(), held: held.toString() });
      }
    }

    logger.info({
      module: 'Reconciler',
      event: 'audit_completed',
      status: report.overallStatus,
      deficitCount: report.criticalDeficits.length,
    });

    return report;
  } catch (err) {
    logger.error({
      module: 'Reconciler',
      event: 'audit_failed',
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

/**
 * Fetch balances from deposit/hot addresses across all supported chains
 * Only counts trusted tokens from config
 */
async function getVerifiedOnChainBalances() {
  const balances = {};

  // ─── XRPL ───────────────────────────────────────────────────────────────
  const xrpl = new XrplClient(process.env.XRPL_WS_URL);
  try {
    await xrpl.connect();
    const addr = process.env.XRPL_DEPOSIT_ADDRESS;

    // Native XRP
    const info = await xrpl.request({ command: 'account_info', account: addr });
    balances.XRP = new Decimal(info.result.account_data.Balance).div(1_000_000);

    // Issued tokens
    const lines = await xrpl.request({
      command: 'account_lines',
      account: addr,
      ledger_index: 'validated',
    });
    for (const line of lines.result.lines) {
      const tokenEntry = Object.entries(config.TOKENS).find(
        ([_, spec]) => spec.networks?.XRP?.issuer === line.account
      );
      if (tokenEntry) {
        const [token] = tokenEntry;
        balances[token] = new Decimal(line.balance);
      }
    }
  } catch (err) {
    logger.error({ module: 'Reconciler', chain: 'XRPL', error: err.message });
  } finally {
    xrpl.disconnect();
  }

  // ─── Stellar ────────────────────────────────────────────────────────────
  try {
    const stellar = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL);
    const acct = await stellar.loadAccount(process.env.STELLAR_DEPOSIT_ADDRESS);

    for (const bal of acct.balances) {
      if (bal.asset_type === 'native') {
        balances.XLM = new Decimal(bal.balance);
      } else {
        const tokenEntry = Object.entries(config.TOKENS).find(
          ([_, spec]) =>
            spec.networks?.XLM?.issuer === bal.asset_issuer &&
            spec.networks?.XLM?.code === bal.asset_code
        );
        if (tokenEntry) {
          const [token] = tokenEntry;
          balances[token] = new Decimal(bal.balance);
        }
      }
    }
  } catch (err) {
    logger.error({ module: 'Reconciler', chain: 'XLM', error: err.message });
  }

  // ─── EVM (XDC + FLR) ────────────────────────────────────────────────────
  for (const chain of ['XDC', 'FLR']) {
    try {
      const rpcUrl = process.env[`${chain}_RPC_URL`];
      if (!rpcUrl) continue;

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const depositAddr = process.env[`${chain}_DEPOSIT_ADDRESS`]?.toLowerCase();
      if (!depositAddr) continue;

      // Native token
      const nativeBal = await provider.getBalance(depositAddr);
      const nativeSymbol = config.CHAINS?.[chain]?.nativeSymbol || chain;
      const decimals = config.CHAINS?.[chain]?.decimals || 18;
      balances[nativeSymbol] = new Decimal(nativeBal.toString()).div(
        new Decimal(10).pow(decimals)
      );

      // ERC-20 tokens
      const tokenEntries = Object.entries(config.TOKENS).filter(
        ([_, spec]) => spec.networks?.[chain]?.contract
      );

      for (const [token, spec] of tokenEntries) {
        const contractAddr = spec.networks[chain].contract.toLowerCase();
        const abi = ['function balanceOf(address) view returns (uint256)'];
        const contract = new ethers.Contract(contractAddr, abi, provider);
        const bal = await contract.balanceOf(depositAddr);
        const tokenDecimals = spec.networks[chain].decimals || 18;
        balances[token] = new Decimal(bal.toString()).div(
          new Decimal(10).pow(tokenDecimals)
        );
      }
    } catch (err) {
      logger.error({ module: 'Reconciler', chain, error: err.message });
    }
  }

  // ─── Hedera ─────────────────────────────────────────────────────────────
  try {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) throw new Error('Hedera credentials missing');

    const hederaClient = HederaClient.forMainnet().setOperator(operatorId, operatorKey);

    const balance = await new AccountBalanceQuery()
      .setAccountId(process.env.HEDERA_DEPOSIT_ACCOUNT)
      .execute(hederaClient);

    // Native HBAR
    balances.HBAR = new Decimal(balance.hbars.to(HbarUnit.Tinybar).toString()).div(1e8);

    // HTS tokens
    const tokenEntries = Object.entries(config.TOKENS).filter(
      ([_, spec]) => spec.networks?.HBAR?.issuer
    );

    for (const [token, spec] of tokenEntries) {
      const tokenId = spec.networks.HBAR.issuer;
      const tokenBal = balance.tokens.get(tokenId);
      if (tokenBal) {
        const decimals = spec.networks.HBAR.decimals || 8;
        balances[token] = new Decimal(tokenBal.toString()).div(
          new Decimal(10).pow(decimals)
        );
      }
    }
  } catch (err) {
    logger.error({ module: 'Reconciler', chain: 'HBAR', error: err.message });
  }

  return balances;
}

/**
 * Send real-time alert on deficit (Slack example)
 */
async function sendDeficitAlert({ token, missing, owed, held }) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const message = {
    text: `🚨 CRITICAL SOLVENCY DEFICIT DETECTED\n` +
          `Token: ${token}\n` +
          `Missing: ${missing}\n` +
          `Owed: ${owed}\n` +
          `Held: ${held}\n` +
          `Audit time: ${new Date().toISOString()}`,
  };

  try {
    await axios.post(webhook, message);
    logger.info({ module: 'Reconciler', event: 'deficit_alert_sent', token });
  } catch (err) {
    logger.error({ module: 'Reconciler', event: 'alert_failed', error: err.message });
  }
}

module.exports = { performFullAudit };
