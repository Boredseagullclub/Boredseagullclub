const axios = require('axios');
const Decimal = require('decimal.js');
const Bottleneck = require('bottleneck');
const logger = require('../utils/logger');

const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const config = require('./config');

const limiter = new Bottleneck({ minTime: 200 });

const MIRROR_URL = process.env.HEDERA_MIRROR_URL || 'https://mainnet.mirrornode.hedera.com';
const DEPOSIT_ACCOUNT_ID = process.env.HEDERA_DEPOSIT_ACCOUNT;

let highestSeenTimestamp = '0.0';
let isPolling = false;

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
function tsToFloat(ts) {
  const [s, ns] = ts.split('.');
  return Number(s) + Number(ns) / 1e9;
}

// ────────────────────────────────────────────────
// TX INGESTION (IDEMPOTENT)
// ────────────────────────────────────────────────
async function processTx(tx) {
  if (tx.result !== 'SUCCESS') return;

  const ts = tx.consensus_timestamp;

  if (tsToFloat(ts) > tsToFloat(highestSeenTimestamp)) {
    highestSeenTimestamp = ts;
  }

  let amount, token, fromAddr;

  const memo = tx.memo_base64
    ? Buffer.from(tx.memo_base64, 'base64').toString().trim()
    : null;

  if (!memo) return;

  // HBAR
  const hbarXfer = tx.transfers?.find(
    t => t.account === DEPOSIT_ACCOUNT_ID && Number(t.amount) > 0
  );

  if (hbarXfer) {
    token = 'HBAR';
    amount = new Decimal(hbarXfer.amount).div(1e8).toString();
    fromAddr =
      tx.transfers.find(t => Number(t.amount) < 0)?.account || 'unknown';
  }

  // HTS
  if (!token) {
    const htsXfer = (tx.token_transfers || []).find(
      t =>
        t.account === DEPOSIT_ACCOUNT_ID &&
        t.amount !== '0' &&
        !t.is_approval
    );

    if (htsXfer) {
      const match = Object.entries(config.TOKENS).find(
        ([_, spec]) =>
          spec.networks?.HBAR?.issuer === htsXfer.token_id
      );

      if (match) {
        token = match[0];
        const decimals =
          config.TOKENS[token].networks.HBAR.decimals || 8;

        amount = new Decimal(htsXfer.amount)
          .div(10 ** decimals)
          .toString();

        fromAddr =
          (tx.token_transfers || []).find(
            t =>
              t.amount.startsWith('-') &&
              t.token_id === htsXfer.token_id
          )?.account || 'unknown';
      }
    }
  }

  if (!token || !amount || new Decimal(amount).isZero()) return;

  const txHash = tx.transaction_id;

  const user = await User.findOne(
    { depositTag: memo },
    { _id: 1 }
  );

  if (!user) {
    logger.info({
      event: 'unknown_memo',
      memo,
      txHash
    });
    return;
  }

  // ✅ IDEMPOTENT UPSERT (NO DUPES EVER)
  await Deposit.updateOne(
    { txHash, chain: 'HBAR' },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: fromAddr,
        chain: 'HBAR',
        token,
        txHash,
        amount,
        txTimestamp: new Date(parseFloat(ts) * 1000),
        status: 'DETECTED'
      }
    },
    { upsert: true }
  );
}

// ────────────────────────────────────────────────
// POLLING WITH PAGINATION
// ────────────────────────────────────────────────
async function pollTransactions() {
  if (isPolling) return;
  isPolling = true;

  try {
    let url = `${MIRROR_URL}/api/v1/transactions?account.id=${DEPOSIT_ACCOUNT_ID}&limit=100&order=asc&timestamp=gte:${highestSeenTimestamp}`;

    let processed = 0;

    while (url) {
      const resp = await limiter.schedule(() =>
        axios.get(url, { timeout: 10000 })
      );

      const txs = resp.data.transactions || [];

      await Promise.all(
        txs.map(async tx => {
          await processTx(tx);
          processed++;
        })
      );

      url = resp.data.links?.next
        ? `${MIRROR_URL}${resp.data.links.next}`
        : null;
    }

    logger.info({
      module: 'HederaListener',
      event: 'poll_success',
      processed,
      highestSeenTimestamp
    });

  } catch (err) {
    logger.error({
      module: 'HederaListener',
      event: 'poll_fail',
      error: err.message
    });
  } finally {
    isPolling = false;
  }
}

// ────────────────────────────────────────────────
// CHECKPOINT
// ────────────────────────────────────────────────
async function saveCheckpoint() {
  if (highestSeenTimestamp === '0.0') return;

  try {
    await Ledger.findOneAndUpdate(
      { chain: 'HBAR' },
      { timestamp: highestSeenTimestamp },
      { upsert: true }
    );
  } catch (err) {
    logger.error({
      module: 'HederaListener',
      event: 'checkpoint_fail',
      error: err.message
    });
  }
}

// ────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────
async function startHederaListener() {
  logger.info({
    module: 'HederaListener',
    event: 'start',
    account: DEPOSIT_ACCOUNT_ID
  });

  const last = await Ledger.findOne({ chain: 'HBAR' }).sort({ timestamp: -1 });

  if (last?.timestamp) {
    highestSeenTimestamp = last.timestamp;

    logger.info({
      module: 'HederaListener',
      event: 'resume',
      timestamp: highestSeenTimestamp
    });
  }

  setInterval(pollTransactions, 3000);
  setInterval(saveCheckpoint, 30000);
}

module.exports = startHederaListener;
