// services/reconciler.js

const User = require('../models/User');
const { Client: XrplClient } = require('xrpl');
const StellarSdk = require('stellar-sdk');
const { Client: HederaClient, AccountBalanceQuery, HbarUnit } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const Decimal = require('decimal.js');
const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config');

async function performFullAudit() {
  logger.info({ module: 'Reconciler', event: 'audit_started' });

  const report = {
    timestamp: new Date().toISOString(),
    liabilities: {},
    assets: {},
    errors: [],               // ← new: per-chain failures
    discrepancies: [],
    overallStatus: 'SOLVENT',
    criticalDeficits: [],
  };

  try {
    // 1. DB liabilities
    const dbAgg = await User.aggregate([
      { $project: { balances: { $objectToArray: '$balances' } } },
      { $unwind: '$balances' },
      { $group: { _id: '$balances.k', totalOwed: { $sum: { $toDouble: '$balances.v' } } } },
    ]);

    report.liabilities = dbAgg.reduce((acc, { _id, totalOwed }) => {
      acc[_id] = new Decimal(totalOwed || 0);
      return acc;
    }, {});

    // 2. On-chain assets + collect errors
    const fetchResult = await getVerifiedOnChainBalances();
    report.assets = fetchResult.balances;
    report.errors = fetchResult.errors;  // ← attached

    // 3. Compare over UNION of all known tokens (DB + chain)
    const allTokens = new Set([
      ...Object.keys(report.liabilities),
      ...Object.keys(report.assets),
    ]);

    for (const token of allTokens) {
      const owed = report.liabilities[token] || new Decimal(0);
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

        await sendDeficitAlert({
          token,
          missing: missing.toString(),
          owed: owed.toString(),
          held: held.toString(),
        });
      }
    }

    // 4. If any chain failed → downgrade status & alert
    if (report.errors.length > 0) {
      report.overallStatus = report.overallStatus === 'SOLVENT' ? 'PARTIAL' : report.overallStatus;
      logger.warn({
        module: 'Reconciler',
        event: 'audit_partial_failure',
        failedChains: report.errors.map(e => e.chain).join(', '),
        errorCount: report.errors.length,
      });
      // Optional: alert on partial failure too
    }

    logger.info({
      module: 'Reconciler',
      event: 'audit_completed',
      status: report.overallStatus,
      tokenCount: allTokens.size,
      deficitCount: report.criticalDeficits.length,
      errorCount: report.errors.length,
    });

    return report;
  } catch (err) {
    logger.error({
      module: 'Reconciler',
      event: 'audit_critical_failure',
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

/**
 * @returns {Promise<{ balances: Object, errors: Array }>}
 */
async function getVerifiedOnChainBalances() {
  const balances = {};
  const errors = [];

    // ─── XRPL ───────────────────────────────────────────────────────────────
  const xrpl = new XrplClient(process.env.XRPL_WS_URL);
  try {
    await xrpl.connect();
    // ... logic ...
  } catch (err) {
    errors.push({ chain: 'XRPL', error: err.message });
    logger.error({ module: 'Reconciler', chain: 'XRPL', error: err.message });
  } finally {
    // This ensures the socket closes even if the request fails
    if (xrpl.isConnected()) xrpl.disconnect();
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
    errors.push({ chain: 'XLM', error: err.message });
    logger.error({ module: 'Reconciler', chain: 'XLM', error: err.message });
  }

  // ─── EVM (XDC + FLR) ────────────────────────────────────────────────────
  for (const chain of ['XDC', 'FLR']) {
    try {
      const rpcUrl = process.env[`${chain}_RPC_URL`];
      const depositAddr = process.env[`${chain}_DEPOSIT_ADDRESS`]?.toLowerCase();
      if (!rpcUrl || !depositAddr) throw new Error(`Missing config for ${chain}`);

      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // 1. Native Balance (Still sequential, but just one call)
      const nativeBal = await provider.getBalance(depositAddr);
      const nativeSymbol = config.CHAINS?.[chain]?.nativeSymbol || chain;
      const nativeDec = config.CHAINS?.[chain]?.decimals || 18;
      balances[nativeSymbol] = new Decimal(nativeBal.toString()).div(new Decimal(10).pow(nativeDec));

      // 2. Token Balances (Parallel Execution)
      const tokenEntries = Object.entries(config.TOKENS).filter(([_, spec]) => spec.networks?.[chain]?.contract);
      const abi = ['function balanceOf(address) view returns (uint256)'];

      const tokenBalances = await Promise.all(tokenEntries.map(async ([token, spec]) => {
        try {
          const contract = new ethers.Contract(spec.networks[chain].contract, abi, provider);
          const bal = await contract.balanceOf(depositAddr);
          return { token, bal, dec: spec.networks[chain].decimals || 18 };
        } catch (e) {
          logger.warn({ module: 'Reconciler', chain, token, error: 'Token fetch failed' });
          return { token, bal: 0, dec: 18, failed: true };
        }
      }));

      // 3. Update Balances (Summing for multi-chain assets)
      tokenBalances.forEach(({ token, bal, dec, failed }) => {
        if (failed) return;
        const current = balances[token] || new Decimal(0);
        balances[token] = current.plus(new Decimal(bal.toString()).div(new Decimal(10).pow(dec)));
      });

    } catch (err) {
      errors.push({ chain, error: err.message });
      logger.error({ module: 'Reconciler', chain, error: err.message });
    }
  }

  // ─── Hedera ─────────────────────────────────────────────────────────────
  try {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) {
      throw new Error('Hedera operator credentials missing');
    }

    const hederaClient = HederaClient.forMainnet().setOperator(operatorId, operatorKey);

    const balance = await new AccountBalanceQuery()
      .setAccountId(process.env.HEDERA_DEPOSIT_ACCOUNT)
      .execute(hederaClient);

    balances.HBAR = new Decimal(balance.hbars.to(HbarUnit.Tinybar).toString()).div(1e8);

    // HTS tokens
    const tokenEntries = Object.entries(config.TOKENS).filter(
      ([_, spec]) => spec.networks?.HBAR?.issuer
    );

    for (const [token, spec] of tokenEntries) {
      const tokenId = spec.networks.HBAR.issuer;
      const tokenBal = balance.tokens.get(tokenId);
      if (!tokenBal) continue;

      const decimals = spec.networks.HBAR.decimals;
      if (decimals === undefined) {
        const errMsg = `Missing decimals for token ${token} on Hedera in config`;
        logger.critical({ module: 'Reconciler', event: 'CONFIG_ERROR', token, error: errMsg });
        throw new Error(errMsg); // ← fail fast
      }

      balances[token] = new Decimal(tokenBal.toString()).div(
        new Decimal(10).pow(decimals)
      );
    }
  } catch (err) {
    errors.push({ chain: 'HBAR', error: err.message });
    logger.error({ module: 'Reconciler', chain: 'HBAR', error: err.message });
  }

  return { balances, errors };
}

async function sendDeficitAlert({ token, missing, owed, held }) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;

  const text = `🚨 SOLVENCY DEFICIT\nToken: ${token}\nMissing: ${missing}\nOwed: ${owed}\nHeld: ${held}\nTime: ${new Date().toISOString()}`;

  try {
    await axios.post(webhook, { text });
    logger.info({ module: 'Reconciler', event: 'deficit_alert_sent', token });
  } catch (err) {
    logger.error({ module: 'Reconciler', event: 'alert_failed', error: err.message });
  }
}

module.exports = { performFullAudit };
