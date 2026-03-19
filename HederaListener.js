const axios = require('axios');
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const LRU = require('lru-cache');
const logger = require('../utils/logger'); // assume same as Stellar
const client = require('prom-client');
const axiosSlack = require('axios'); // for alerts

const config = require('./config'); // your config.js
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Ledger = require('../models/Ledger');

const MIRROR_URL = process.env.HEDERA_MIRROR_URL || 'https://mainnet.mirrornode.hedera.com';
const DEPOSIT_ACCOUNT_ID = process.env.HEDERA_DEPOSIT_ACCOUNT; // e.g. '0.0.123456'
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

let highestSeenTimestamp = '0.0'; // 'seconds.nanoseconds'
let depositBuffer = [];
let userBalances = new Map();
const userCache = new LRU({ max: 5000, ttl: 1000 * 60 * 60 });

const POLL_INTERVAL_MS = 3000; // 3s
const FLUSH_THRESHOLD = 400;
const MAX_BUFFER_SIZE = 10000;
const BUFFER_WARNING_THRESHOLD = 5000;
const BUFFER_HARD_LIMIT = 7500;
const BUFFER_DROP_THRESHOLD = 12000;
const POLL_BACKOFF_STEP = 1500;
const POLL_BACKOFF_MAX = 30000;
let pollBackoffMs = 0;

// Prometheus metrics (like Stellar)
const depositsBuffered = new client.Counter({
  name: 'hedera_deposits_buffered_total',
  help: 'Total Hedera deposits buffered',
  labelNames: ['token']
});

const depositsFlushed = new client.Counter({
  name: 'hedera_deposits_flushed_total',
  help: 'Total Hedera deposits flushed',
  labelNames: ['status']
});

const pollFailures = new client.Counter({
  name: 'hedera_poll_failures_total',
  help: 'Hedera poll failures'
});

const ledgerLag = new client.Gauge({
  name: 'hedera_timestamp_lag',
  help: 'Lag in seconds from latest seen to now'
});

const bufferSizeGauge = new client.Gauge({
  name: 'hedera_deposit_buffer_size',
  help: 'Current buffer size'
});

const register = new client.Registry();
client.collectDefaultMetrics({ register });
register.registerMetric(depositsBuffered);
register.registerMetric(depositsFlushed);
register.registerMetric(pollFailures);
register.registerMetric(ledgerLag);
register.registerMetric(bufferSizeGauge);

module.exports.promRegister = register;

setInterval(flushDeposits, 10000); // periodic flush like Stellar (safer)
setInterval(updateLag, 60000);
setInterval(saveCheckpoint, 30000);

async function startHederaListener() {
  logger.info({
    module: 'HederaListener',
    event: 'start',
    depositAccount: DEPOSIT_ACCOUNT_ID,
    mirror: MIRROR_URL
  });

  const last = await Ledger.findOne({ chain: 'HBAR' }).sort({ timestamp: -1 });
  if (last?.timestamp) {
    highestSeenTimestamp = last.timestamp;
    logger.info({ module: 'HederaListener', event: 'resumed', timestamp: highestSeenTimestamp });
  }

  await scanGaps();
  setInterval(pollTransactions, POLL_INTERVAL_MS);
}

async function pollTransactions() {
  if (pollBackoffMs > 0) {
    setTimeout(pollTransactions, pollBackoffMs);
    return;
  }

  try {
    const url = `${MIRROR_URL}/api/v1/transactions?account.id=${DEPOSIT_ACCOUNT_ID}&limit=100&order=asc&timestamp=gte:${highestSeenTimestamp}`;
    const resp = await axios.get(url, { timeout: 10000 });
    const txs = resp.data.transactions || [];

    let processed = 0;
    for (const tx of txs) {
      if (tx.result !== 'SUCCESS') continue;

      const ts = tx.consensus_timestamp;
      if (ts > highestSeenTimestamp) highestSeenTimestamp = ts;

      let amount = null;
      let token = null;
      let fromAddr = null;
      let memo = tx.memo_base64 ? Buffer.from(tx.memo_base64, 'base64').toString().trim() : null;

      // HBAR native
      const hbarXfer = tx.transfers?.find(t => t.account === DEPOSIT_ACCOUNT_ID && Number(t.amount) > 0);
      if (hbarXfer) {
        token = 'HBAR';
        amount = new Decimal(hbarXfer.amount).div(1e8).toString();
        fromAddr = tx.transfers.find(t => Number(t.amount) < 0)?.account || 'unknown';
      }

      // HTS tokens (e.g. SEAGULLCASH)
      if (!token) {
        const tokenXfers = tx.token_transfers || [];
        const htsXfer = tokenXfers.find(t =>
          t.account === DEPOSIT_ACCOUNT_ID &&
          t.amount !== '0' &&
          !t.is_approval
        );

        if (htsXfer) {
          const match = Object.entries(config.TOKENS).find(([key, spec]) =>
            spec.networks?.HBAR?.issuer === htsXfer.token_id
          );
          if (match) {
            token = match[0];
            const decimals = config.TOKENS[token].networks.HBAR.decimals || 8;
            amount = new Decimal(htsXfer.amount).div(10 ** decimals).toString();
            fromAddr = tokenXfers.find(t => t.amount.startsWith('-') && t.token_id === htsXfer.token_id)?.account || 'unknown';
          }
        }
      }

      if (!token || !amount || new Decimal(amount).isZero() || !memo || !/^[1-9]\d{0,18}$/.test(memo)) continue;

      const txHash = tx.transaction_id; // unique
      if (await Deposit.exists({ txHash, chain: 'HBAR' })) continue;

      let user = userCache.get(memo);
      if (!user) {
        user = await User.findOne({ depositTag: memo }, { _id: 1 });
        if (!user) {
          logger.info({ module: 'HederaListener', event: 'ignored_unknown_memo', txHash, memo });
          continue;
        }
        userCache.set(memo, user);
      }

      depositBuffer.push({
        userId: user._id,
        walletAddress: fromAddr,
        chain: 'HBAR',
        token,
        txHash,
        amount: mongoose.Types.Decimal128.fromString(amount),
        confirmations: 1,
        ledgerIndex: null, // no ledger seq; use timestamp if needed
        timestamp: new Date(parseFloat(tx.valid_start_timestamp || ts) * 1000),
        status: 'DETECTED',
        memo
      });

      depositsBuffered.inc({ token });
      bufferSizeGauge.set(depositBuffer.length);

      const userIdStr = user._id.toString();
      if (!userBalances.has(userIdStr)) userBalances.set(userIdStr, {});
      const bals = userBalances.get(userIdStr);
      bals[token] = new Decimal(bals[token] || '0').plus(new Decimal(amount)).toString();

      processed++;

      if (depositBuffer.length >= FLUSH_THRESHOLD || depositBuffer.length > MAX_BUFFER_SIZE - 100) {
        await flushDeposits();
      }
    }

    logger.info({
      module: 'HederaListener',
      event: 'polled_batch',
      count: processed,
      newHighestTs: highestSeenTimestamp
    });

    pollBackoffMs = 0;
  } catch (err) {
    pollFailures.inc();
    pollBackoffMs = Math.min(pollBackoffMs + POLL_BACKOFF_STEP, POLL_BACKOFF_MAX);
    logger.error({
      module: 'HederaListener',
      event: 'poll_failed',
      error: err.message,
      backoffMs: pollBackoffMs
    });

    if (pollBackoffMs > 10000) {
      sendSlackAlert(`⚠️ Hedera poll failing repeatedly (backoff ${pollBackoffMs}ms) — check Mirror Node`);
    }
  }
}

async function flushDeposits() {
  if (!depositBuffer.length) return;

  const depositsToInsert = depositBuffer.splice(0);
  const balanceSnapshot = new Map(userBalances);
  userBalances.clear();
  bufferSizeGauge.set(depositBuffer.length);

  const bulkOps = [];
  for (const [userId, tokens] of balanceSnapshot) {
    const inc = {};
    for (const [tok, amtStr] of Object.entries(tokens)) {
      inc[`balances.${tok}`] = mongoose.Types.Decimal128.fromString(amtStr);
    }
    bulkOps.push({
      updateOne: {
        filter: { _id: userId },
        update: { $inc: inc }
      }
    });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (depositsToInsert.length) {
        await Deposit.insertMany(depositsToInsert, { ordered: false, session });
      }
      if (bulkOps.length) {
        await User.bulkWrite(bulkOps, { session });
      }
      if (highestSeenTimestamp !== '0.0') {
        await Ledger.findOneAndUpdate(
          { chain: 'HBAR' },
          { timestamp: highestSeenTimestamp, updatedAt: new Date() },
          { upsert: true, session }
        );
      }
    });

    depositsFlushed.inc({ status: 'success' }, depositsToInsert.length);
    logger.info({ module: 'HederaListener', event: 'flushed', count: depositsToInsert.length });
  } catch (err) {
    depositsFlushed.inc({ status: 'failed' }, depositsToInsert.length);
    depositBuffer.unshift(...depositsToInsert);
    for (const [k, v] of balanceSnapshot) userBalances.set(k, v);
    bufferSizeGauge.set(depositBuffer.length);

    logger.error({ module: 'HederaListener', event: 'flush_failed', error: err.message });

    if (err.code !== 11000) { // not duplicate
      if (depositBuffer.length > BUFFER_WARNING_THRESHOLD) {
        sendSlackAlert(`⚠️ Hedera buffer high & flush failed: ${depositBuffer.length} items`);
      }
    }

    // Overflow drop (emergency)
    if (depositBuffer.length >= BUFFER_HARD_LIMIT) {
      let toDrop = depositBuffer.length - BUFFER_HARD_LIMIT + 1000;
      if (depositBuffer.length >= BUFFER_DROP_THRESHOLD) {
        const dropped = depositBuffer.splice(0, toDrop);
        logger.error({ module: 'HederaListener', event: 'CRITICAL_DROP', dropped: dropped.length });
        sendSlackAlert(`‼️ CRITICAL Hedera buffer overflow — dropped ${dropped.length} oldest`);
      } else {
        sendSlackAlert(`⚠️ Hedera buffer critically high: ${depositBuffer.length}`);
      }
    }
  } finally {
    session.endSession();
  }
}

async function scanGaps() {
  try {
    logger.info({ module: 'HederaListener', event: 'gap_scan_start', fromTs: highestSeenTimestamp || 'beginning' });

    // Scan last ~1 hour or wider if needed (adjust timestamp back)
    const backTs = highestSeenTimestamp !== '0.0' ? subtractSeconds(highestSeenTimestamp, 3600) : undefined;
    const url = `${MIRROR_URL}/api/v1/transactions?account.id=${DEPOSIT_ACCOUNT_ID}&limit=500&order=desc${backTs ? `&timestamp=gte:${backTs}` : ''}`;
    const resp = await axios.get(url);
    const txs = resp.data.transactions || [];

    const txHashes = txs.map(t => t.transaction_id);
    const existing = new Set((await Deposit.find({ txHash: { $in: txHashes }, chain: 'HBAR' }).select('txHash').lean()).map(d => d.txHash));

    let processed = 0;
    for (const tx of txs.reverse()) { // oldest first
      if (existing.has(tx.transaction_id)) continue;
      // Reuse poll logic: extract amount/token/memo/from, buffer if valid
      // (implement a shared processTx(tx) function for reuse)
      await processTx(tx); // define below
      processed++;
    }

    logger.info({ module: 'HederaListener', event: 'gap_scan_complete', scanned: txs.length, newlyProcessed: processed });
  } catch (err) {
    logger.error({ module: 'HederaListener', event: 'gap_scan_failed', error: err.message });
  }
}

async function processTx(tx) {
  // Extract logic from pollTransactions (amount, token, memo, fromAddr, etc.)
  // Then dedup, user lookup, buffer push, balance agg
  // (extracted to reuse in poll + gap scan)
  // Implement similar to the for-loop body in pollTransactions
  // ...
}

function subtractSeconds(ts, secs) {
  const [s, ns] = ts.split('.').map(Number);
  const newS = s - secs;
  return `${newS}.${ns.toString().padStart(9, '0')}`;
}

async function saveCheckpoint() {
  if (highestSeenTimestamp === '0.0') return;
  try {
    await Ledger.findOneAndUpdate(
      { chain: 'HBAR' },
      { timestamp: highestSeenTimestamp, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    logger.error({ module: 'HederaListener', event: 'checkpoint_failed', error: err.message });
  }
}

async function updateLag() {
  try {
    // Approximate lag: fetch latest tx or use server time proxy
    const resp = await axios.get(`${MIRROR_URL}/api/v1/network/supply`);
    const now = Date.now() / 1000;
    const lag = now - parseFloat(highestSeenTimestamp.split('.')[0] || now);
    ledgerLag.set(lag);
  } catch {}
}

async function sendSlackAlert(message) {
  if (!SLACK_WEBHOOK) return;
  try {
    await axiosSlack.post(SLACK_WEBHOOK, { text: message });
  } catch (err) {
    logger.error({ module: 'SlackAlert', event: 'failed', error: err.message });
  }
}

module.exports = startHederaListener;
