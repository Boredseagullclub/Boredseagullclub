// stellarListener.js

const StellarSdk = require('stellar-sdk');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Ledger = require('../models/Ledger');
const logger = require('../utils/logger');
const axios = require('axios');
const client = require('prom-client');
const { register } = require('./services/metrics');   // or './metrics' depending on exact path

const HORIZON = process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org';
const DEPOSIT_ADDRESS = process.env.STELLAR_DEPOSIT_ADDRESS;
const SEAGULLCASH_ISSUER =
  process.env.STELLAR_SEAGULLCASH_ISSUER ||
  'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

const server = new StellarSdk.Server(HORIZON);

let highestSeenLedger = 0;
let reconnectAttempts = 0;

const depositBuffer = [];
const FLUSH_INTERVAL = 1000;
const MAX_BATCH = 1000;
const BUFFER_WARNING_THRESHOLD = 5000;
const RECONNECT_ALERT_THRESHOLD = 5;

// Prometheus metrics — using the shared register
const depositsBuffered = new client.Counter({
  name: 'stellar_deposits_buffered_total',
  help: 'Total number of Stellar deposits buffered',
  labelNames: ['token'],
  registers: [register]          // ← this is the important part
});

const depositsFlushed = new client.Counter({
  name: 'stellar_deposits_flushed_total',
  help: 'Total number of Stellar deposits flushed to database',
  labelNames: ['status'],
  registers: [register]
});

const reconnectCount = new client.Counter({
  name: 'stellar_reconnect_total',
  help: 'Total reconnection attempts to Stellar Horizon',
  registers: [register]
});

const ledgerLag = new client.Gauge({
  name: 'stellar_ledger_lag',
  help: 'Current lag between highest seen ledger and latest ledger',
  registers: [register]
});

const bufferSize = new client.Gauge({
  name: 'stellar_deposit_buffer_size',
  help: 'Current number of deposits in buffer waiting to be flushed',
  registers: [register]
});

setInterval(flushDeposits, FLUSH_INTERVAL);
setInterval(updateLedgerLag, 60000);
setInterval(saveLedgerCheckpoint, 30000);

async function startStellarListener() {
  logger.info({
    module: 'StellarListener',
    event: 'start',
    depositAddress: DEPOSIT_ADDRESS,
    horizon: HORIZON
  });

  const lastLedger = await Ledger.findOne({ chain: 'XLM' }).sort({ ledger_index: -1 });

  if (lastLedger) {
    highestSeenLedger = lastLedger.ledger_index;
    logger.info({
      module: 'StellarListener',
      event: 'resumed',
      ledger: highestSeenLedger
    });
  }

  await scanGaps();
  startStream();
}

function startStream() {
  reconnectAttempts = 0;

  const cursor = highestSeenLedger ? `ledger:${highestSeenLedger}` : 'now';

  logger.info({
    module: 'StellarListener',
    event: 'stream_started',
    cursor,
    reconnectAttempt: reconnectAttempts
  });

  const es = server
    .payments()
    .forAccount(DEPOSIT_ADDRESS)
    .cursor(cursor)
    .join('transactions')
    .stream({
      onmessage: async (payment) => {
        try {
          await handlePayment(payment);
        } catch (err) {
          logger.error({
            module: 'StellarListener',
            event: 'payment_processing_error',
            error: err.message,
            txHash: payment?.transaction_hash
          });
        }
      },

      onerror: (err) => {
        logger.error({
          module: 'StellarListener',
          event: 'stream_error',
          error: err.message || err
        });

        es.close();

        reconnectAttempts++;
        reconnectCount.inc();

        const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempts), 60000);

        logger.warn({
          module: 'StellarListener',
          event: 'reconnecting',
          attempt: reconnectAttempts,
          delayMs: delay
        });

        if (reconnectAttempts >= RECONNECT_ALERT_THRESHOLD) {
          sendSlackAlert(
            `🚨 Stellar listener repeated reconnects (${reconnectAttempts})!\n` +
            `Horizon: ${HORIZON}\n` +
            `Last known ledger: ${highestSeenLedger}\n` +
            `Check network/Horizon status.`
          );
        }

        setTimeout(startStream, delay);
      }
    });
}

async function handlePayment(payment) {
  if (payment.type !== 'payment') return;

  const ledger = payment.ledger;

  if (ledger > highestSeenLedger) {
    highestSeenLedger = ledger;
  }

  const txHash = payment.transaction_hash;

  const exists = await Deposit.exists({ txHash });
  if (exists) return;

  const tx = payment.transaction_attr;

  let memo = null;
  if (tx.memo_type === 'text') memo = tx.memo;
  if (tx.memo_type === 'id') memo = tx.memo?.toString();

  if (!memo) {
    logger.warn({ module: 'StellarListener', event: 'ignored_no_memo', txHash, ledger });
    return;
  }

  if (!/^\d+$/.test(memo)) {
    logger.warn({ module: 'StellarListener', event: 'ignored_invalid_memo', txHash, memo, ledger });
    return;
  }

  const user = await User.findOne({ depositTag: memo }, { _id: 1 });
  if (!user) {
    logger.info({ module: 'StellarListener', event: 'ignored_unknown_memo', txHash, memo });
    return;
  }

  let token = 'XLM';
  let amount = payment.amount;

  if (payment.asset_type !== 'native') {
    if (
      payment.asset_code === 'SeagullCash' &&
      payment.asset_issuer === SEAGULLCASH_ISSUER
    ) {
      token = 'SeagullCash';
    } else {
      return;
    }
  }

  depositBuffer.push({
    walletAddress: payment.from,
    chain: 'XLM',
    token,
    txHash,
    amount,
    confirmations: 1,
    ledgerIndex: ledger,
    timestamp: new Date(payment.created_at),
    status: 'DETECTED',
    memo
  });

  depositsBuffered.inc({ token });
  bufferSize.set(depositBuffer.length);

  logger.info({
    module: 'StellarListener',
    event: 'buffered_deposit',
    txHash,
    amount,
    token,
    memo,
    from: payment.from,
    ledger
  });

  if (depositBuffer.length >= MAX_BATCH) {
    await flushDeposits();
  }
}

async function flushDeposits() {
  if (depositBuffer.length === 0) return;

  const batch = depositBuffer.splice(0);
  bufferSize.set(depositBuffer.length);

  try {
    await Deposit.insertMany(batch, { ordered: false });
    depositsFlushed.inc({ status: 'success' }, batch.length);

    logger.info({
      module: 'StellarListener',
      event: 'flushed_batch',
      count: batch.length,
      bufferRemaining: depositBuffer.length
    });
  } catch (err) {
    depositsFlushed.inc({ status: 'failed' });
    depositBuffer.unshift(...batch);
    bufferSize.set(depositBuffer.length);

    logger.error({
      module: 'StellarListener',
      event: 'flush_failed',
      error: err.message,
      batchSize: batch.length
    });

    if (depositBuffer.length > BUFFER_WARNING_THRESHOLD) {
      sendSlackAlert(
        `⚠️ Stellar deposit buffer critically high: ${depositBuffer.length} items!\n` +
        `Possible DB bottleneck or overload. Flush failed.`
      );
    }
  }
}

async function saveLedgerCheckpoint() {
  if (!highestSeenLedger) return;

  try {
    await Ledger.findOneAndUpdate(
      { chain: 'XLM' },
      { ledger_index: highestSeenLedger, updatedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    logger.error({
      module: 'StellarListener',
      event: 'checkpoint_failed',
      error: err.message
    });
  }
}

async function updateLedgerLag() {
  try {
    const latest = (await server.ledgers().order('desc').limit(1).call()).records[0].sequence;
    ledgerLag.set(latest - highestSeenLedger);
  } catch (err) {
    logger.debug({ module: 'StellarListener', event: 'lag_update_failed', error: err.message });
  }
}

async function scanGaps() {
  try {
    logger.info({ module: 'StellarListener', event: 'gap_scan_start' });

    const recent = await server
      .payments()
      .forAccount(DEPOSIT_ADDRESS)
      .order('desc')
      .limit(200)
      .join('transactions')
      .call();

    for (const payment of recent.records.reverse()) {
      await handlePayment(payment);
    }

    logger.info({ module: 'StellarListener', event: 'gap_scan_complete' });
  } catch (err) {
    logger.error({
      module: 'StellarListener',
      event: 'gap_scan_failed',
      error: err.message
    });
  }
}

async function sendSlackAlert(message) {
  if (!SLACK_WEBHOOK) return;
  try {
    await axios.post(SLACK_WEBHOOK, { text: message });
  } catch (err) {
    logger.error({
      module: 'SlackAlert',
      event: 'failed',
      error: err.message
    });
  }
}

module.exports = startStellarListener;
