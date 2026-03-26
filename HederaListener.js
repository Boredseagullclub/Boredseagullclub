const axios = require('axios');
const Decimal = require('decimal.js');
const Bottleneck = require('bottleneck');
const logger = require('logger.js'); // Node looks in node_modules
const config = require('config.s');  // Typo in extension
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Ledger = require('../models/Ledger');

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

  // Track the highest timestamp for checkpointing
  if (tsToFloat(ts) > tsToFloat(highestSeenTimestamp)) {
    highestSeenTimestamp = ts;
  }

  let amount = new Decimal(0);
  let token, fromAddr;

  const memo = tx.memo_base64
    ? Buffer.from(tx.memo_base64, 'base64').toString().trim()
    : null;

  if (!memo) return;

  // 1. Check for HBAR Transfers (Sum all credits to deposit account)
  const hbarCredits = (tx.transfers || []).filter(
    t => t.account === DEPOSIT_ACCOUNT_ID && Number(t.amount) > 0
  );

  if (hbarCredits.length > 0) {
    token = 'HBAR';
    amount = hbarCredits.reduce((sum, t) => sum.plus(new Decimal(t.amount)), new Decimal(0)).div(1e8);
    fromAddr = tx.transfers.find(t => Number(t.amount) < 0)?.account || 'unknown';
  }

  // 2. Check for HTS (Tokens) if no HBAR found
  if (amount.isZero()) {
    const htsCredits = (tx.token_transfers || []).filter(
      t => t.account === DEPOSIT_ACCOUNT_ID && Number(t.amount) > 0 && !t.is_approval
    );

    if (htsCredits.length > 0) {
      // Find matching token in config
      const tokenId = htsCredits[0].token_id;
      const match = Object.entries(config.TOKENS).find(
        ([_, spec]) => spec.networks?.HBAR?.issuer === tokenId
      );

      if (match) {
        token = match[0];
        const decimals = config.TOKENS[token].networks.HBAR.decimals;
        
        // Strict Decimal Check: Don't guess. If config is missing, skip and log.
        if (decimals === undefined) {
          logger.error({ event: 'missing_hbar_decimals', token, tokenId });
          return;
        }

        amount = htsCredits
          .reduce((sum, t) => sum.plus(new Decimal(t.amount)), new Decimal(0))
          .div(new Decimal(10).pow(decimals));

        fromAddr = (tx.token_transfers || []).find(
          t => t.amount.startsWith('-') && t.token_id === tokenId
        )?.account || 'unknown';
      }
    }
  }

  if (!token || amount.isZero()) return;

  const txHash = tx.transaction_id;

  // Lookup user by their unique deposit tag (memo)
  const user = await User.findOne({ depositTag: memo }, { _id: 1 });

  if (!user) {
    logger.info({ event: 'unknown_memo', memo, txHash });
    return;
  }

  // ✅ IDEMPOTENT UPSERT
  await Deposit.updateOne(
    { txHash, chain: 'HBAR' },
    {
      $setOnInsert: {
        userId: user._id,
        walletAddress: fromAddr,
        chain: 'HBAR',
        token,
        txHash,
        amount: amount.toString(),
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
    // Use 'gt' (Greater Than) instead of 'gte' to avoid reprocessing the checkpoint TX
    let url = `${MIRROR_URL}/api/v1/transactions?account.id=${DEPOSIT_ACCOUNT_ID}&limit=100&order=asc&timestamp=gt:${highestSeenTimestamp}`;

    let processed = 0;

    while (url) {
      const resp = await limiter.schedule(() =>
        axios.get(url, { timeout: 10000 })
      );

      const txs = resp.data.transactions || [];

      for (const tx of txs) {
        await processTx(tx);
        processed++;
      }

      url = resp.data.links?.next ? `${MIRROR_URL}${resp.data.links.next}` : null;
    }

    if (processed > 0) {
      logger.info({ module: 'HederaListener', event: 'poll_success', processed, highestSeenTimestamp });
    }

  } catch (err) {
    logger.error({ module: 'HederaListener', event: 'poll_fail', error: err.message });
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
    logger.error({ module: 'HederaListener', event: 'checkpoint_fail', error: err.message });
  }
}

// ────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────
async function startHederaListener() {
  logger.info({ module: 'HederaListener', event: 'start', account: DEPOSIT_ACCOUNT_ID });

  const last = await Ledger.findOne({ chain: 'HBAR' });

  if (last?.timestamp) {
    highestSeenTimestamp = last.timestamp;
    logger.info({ module: 'HederaListener', event: 'resume', timestamp: highestSeenTimestamp });
  }

  setInterval(pollTransactions, 5000); // 5s interval is safer for Mirror Node rate limits
  setInterval(saveCheckpoint, 30000);
}

module.exports = startHederaListener;
