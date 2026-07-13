const { Client } = require('xrpl');
const mongoose = require('mongoose');
const Decimal = require('decimal.js');

const Deposit = require('./models/Deposit');
const User = require('./models/User');
const Ledger = require('./models/Ledger');
const { LRUCache } = require('lru-cache');
const config = require('./config');

// ────────────────────────────────────────────────
// Shared state (module scope)
// ────────────────────────────────────────────────
let highestSeenLedger = 0;
let lastNetworkLedger = 0;
let depositBuffer = [];
let userBalances = new Map();

const userCache = new LRUCache({ max: 5000, ttl: 1000 * 60 * 60 }); // shared across restarts

const MAX_BUFFER_SIZE = 10000;
const FLUSH_THRESHOLD = 400;

// ────────────────────────────────────────────────
// Flush — transactional
// ────────────────────────────────────────────────
const flushDeposits = async () => {
  if (!depositBuffer.length) return;

  const depositsToInsert = depositBuffer.splice(0);
  const balanceSnapshot = new Map(userBalances);
  userBalances.clear();

  const bulkOps = [];
  for (const [userId, tokens] of balanceSnapshot) {
    const inc = {};
    for (const [token, amtStr] of Object.entries(tokens)) {
      inc[`balances.${token}`] = mongoose.Types.Decimal128.fromString(amtStr);
    }
    bulkOps.push({
      updateOne: {
        filter: { _id: userId },
        update: { $inc: inc },
      },
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
      if (highestSeenLedger > 0) {
        await Ledger.findOneAndUpdate(
          { chain: 'XRPL' },
          { ledger_index: highestSeenLedger, updatedAt: new Date() },
          { upsert: true, session }
        );
      }
    });

    console.log(`[FLUSH] Success: ${depositsToInsert.length} txs`);
  } catch (err) {
    console.error('[FLUSH] Transaction failed:', err.message);

    // Only restore if NOT duplicate key error (already in DB)
    if (err.code !== 11000) {
      depositBuffer.unshift(...depositsToInsert);
      for (const [k, v] of balanceSnapshot) userBalances.set(k, v);
    }
  } finally {
    session.endSession();
  }
};

// ────────────────────────────────────────────────
// Status endpoint helper
// ────────────────────────────────────────────────
const getSyncStatus = () => ({
  processedLedger: highestSeenLedger,
  networkLedger: lastNetworkLedger,
  gap: lastNetworkLedger - highestSeenLedger,
  isSynced: lastNetworkLedger > 0 && lastNetworkLedger - highestSeenLedger < 10,
  bufferSize: depositBuffer.length,
});

// ────────────────────────────────────────────────
// Main listener function
// ────────────────────────────────────────────────
async function startXrplListener() {
  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  // Update network ledger height
  const updateNetworkStatus = async () => {
    try {
      const info = await client.request({ command: 'server_info' });
      lastNetworkLedger = info.result.info.validated_ledger?.seq || 0;
    } catch {} // silent
  };

  // ────────────────────────────────────────────────
  // Reconnection + subscription
  // ────────────────────────────────────────────────
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 20;
  const BASE_DELAY = 1000;
  const MAX_DELAY = 60000;
  let isConnecting = false;

  const connectAndSubscribe = async () => {
    if (isConnecting || client.isConnected()) return;
    isConnecting = true;

    try {
      await client.connect();
      await client.request({ command: 'subscribe', accounts: [depositAddress] });
      console.log('Connected & subscribed to deposit address');
      reconnectAttempts = 0;
      await updateNetworkStatus(); // immediate fetch after connect
    } catch (err) {
      reconnectAttempts++;
      const delay = Math.min(BASE_DELAY * (1.6 ** (reconnectAttempts - 1)), MAX_DELAY);
      console.error(`Connection attempt ${reconnectAttempts} failed:`, err.message);

      if (reconnectAttempts < MAX_RECONNECT) {
        setTimeout(connectAndSubscribe, delay);
      } else {
        console.error('Max reconnect attempts reached, listener stopped.');
      }
    } finally {
      isConnecting = false;
    }
  };

  client.on('disconnected', (code) => {
    console.error(`Disconnected (code: ${code || 'unknown'})`);
    connectAndSubscribe();
  });

  client.on('error', (err) => console.error('Client error:', err));

  // ────────────────────────────────────────────────
  // Gap scanning
  // ────────────────────────────────────────────────
  const scanGaps = async () => {
    const last = await Ledger.findOne({ chain: 'XRPL' })
      .sort({ ledger_index: -1 })
      .select('ledger_index')
      .lean();

    if (last?.ledger_index > highestSeenLedger) highestSeenLedger = last.ledger_index;

    let minLedger = highestSeenLedger > 0 ? highestSeenLedger + 1 : undefined;
    if (!minLedger) {
      try {
        const { result } = await client.request({ command: 'server_info' });
        const seq = result.info.validated_ledger?.seq;
        if (seq) minLedger = Math.max(1, seq - 5000);
      } catch (err) {
        console.error('Failed to get server_info for gap scan:', err.message);
        return;
      }
    }

    let marker = null;
    do {
      try {
        const req = {
          command: 'account_tx',
          account: depositAddress,
          ledger_index_min: minLedger,
          ledger_index_max: 'validated',
          forward: true,
          limit: 100,
          marker,
        };
        const resp = await client.request(req);
        for (const item of resp.result.transactions || []) {
          client.emit('transaction', { validated: true, transaction: item.tx, meta: item.meta, isHistorical: true });
        }
        marker = resp.result.marker;
      } catch (err) {
        console.error('Gap scan failed:', err.message);
        break;
      }
    } while (marker);
  };

  // ────────────────────────────────────────────────
  // Transaction handler
  // ────────────────────────────────────────────────
  client.on('transaction', async (ev) => {
    // FIX 1: Guard clause drops empty ledger noise so it doesn't crash the container
    if (!ev || !ev.validated || !ev.transaction || !ev.meta) return;

    const { transaction: tx, meta, isHistorical } = ev;

    if (tx.TransactionType !== 'Payment' || meta.TransactionResult !== 'tesSUCCESS' || tx.Destination !== depositAddress) return;
    if (tx.ledger_index > highestSeenLedger) highestSeenLedger = tx.ledger_index;

    let amount = null;
    let token = null;
    const da = meta.delivered_amount;

    if (da === 'unavailable') {
      console.warn(`Skipping tx ${tx.hash.slice(0, 12)}... - delivered_amount unavailable`);
      return;
    }

    if (typeof da === 'string') {
      token = 'XRP';
      amount = new Decimal(da).div(1000000).toString();
    } else if (da?.currency && da?.issuer) {
      const match = Object.entries(config.TOKENS).find(([key, spec]) => {
        const xrpl = spec.networks?.XRP;
        return xrpl?.issuer === da.issuer && spec.currency === da.currency;
      });
      if (match) {
        token = match[0];
        amount = da.value;
      }
    }

    if (!token || !amount || new Decimal(amount).isZero()) return;
    if (await Deposit.exists({ txHash: tx.hash, chain: 'XRPL' })) return;

    const tag = String(tx.DestinationTag ?? '');
    if (!tag) return;

    console.log(
      `[XRPL-DEPOSIT] ${amount} ${token} | tag:${tag} | ` +
      `tx:${tx.hash.slice(0, 12)}... | ledger:${tx.ledger_index} | ` +
      `from:${tx.Account.slice(0, 8)}...`
    );

    let user = userCache.get(tag);
    if (!user) {
      user = await User.findOne({ depositTag: tag });
      if (!user) return;
      userCache.set(tag, user);
    }

    const decAmount = new Decimal(amount);
    depositBuffer.push({
      userId: user._id,
      walletAddress: tx.Account,
      chain: 'XRPL',
      token,
      txHash: tx.hash,
      amount: mongoose.Types.Decimal128.fromString(amount),
      confirmations: 1,
      ledgerIndex: tx.ledger_index || null,
      timestamp: tx.date ? new Date((tx.date + 946684800) * 1000) : new Date(),
      status: 'DETECTED',
    });

    const userIdStr = user._id.toString();
    if (!userBalances.has(userIdStr)) userBalances.set(userIdStr, {});
    const tokens = userBalances.get(userIdStr);
    tokens[token] = new Decimal(tokens[token] || '0').plus(decAmount).toString();

    // Still flush immediately if we hit the high-volume threshold
    if (!isHistorical && (depositBuffer.length > FLUSH_THRESHOLD || depositBuffer.length > MAX_BUFFER_SIZE - 100)) {
      await flushDeposits();
    }
  });

  // ────────────────────────────────────────────────
  // Start everything
  // ────────────────────────────────────────────────
  await connectAndSubscribe();
  await updateNetworkStatus();
  setInterval(updateNetworkStatus, 10000);

  // FIX 2: Time-based flush ensures small amounts of deposits don't get stuck forever
  setInterval(async () => {
    if (depositBuffer.length > 0) {
      await flushDeposits();
    }
  }, 3000);

  scanGaps().catch(err => console.error('Initial gap scan failed:', err.message));
  
  setInterval(() => {
    if (client.isConnected()) {
      scanGaps().catch(err => console.error('Periodic gap scan failed:', err.message));
    }
  }, 15 * 60 * 1000);

  console.log(`XRPL listener started | watching ${depositAddress} | highest ledger: ${highestSeenLedger}`);
}

module.exports = { startXrplListener, getSyncStatus };
