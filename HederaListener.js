// HederaListener.js
const { Client: MirrorClient } = require('@hashgraph/sdk'); // or axios for pure REST
const axios = require('axios');
const mongoose = require('mongoose');
const Decimal = require('decimal.js');
const LRU = require('lru-cache');
// ... models, config, logger, prom-client like Stellar

const MIRROR_URL = process.env.HEDERA_MIRROR_URL || 'https://mainnet.mirrornode.hedera.com';
const DEPOSIT_ACCOUNT_ID = process.env.HEDERA_DEPOSIT_ACCOUNT; // e.g. '0.0.123456'
const TOKEN_CONFIG = config.TOKENS; // map token IDs to symbols

let highestSeenTimestamp = '0.0'; // consensus timestamp like '1234567890.000000000'
let depositBuffer = [];
let userBalances = new Map();
const userCache = new LRU({ max: 5000, ttl: 3600000 });

const POLL_INTERVAL_MS = 3000; // ~every 3s
const FLUSH_THRESHOLD = 400;
// ... buffer limits, alerts like Stellar

async function pollTransactions() {
  try {
    const url = `${MIRROR_URL}/api/v1/transactions?account.id=${DEPOSIT_ACCOUNT_ID}&limit=100&order=asc&timestamp=gte:${highestSeenTimestamp}`;
    const resp = await axios.get(url);
    const txs = resp.data.transactions || [];

    for (const tx of txs) {
      if (tx.result !== 'SUCCESS') continue;

      const ts = tx.consensus_timestamp;
      if (ts > highestSeenTimestamp) highestSeenTimestamp = ts;

      // Parse transfers
      let amount = null;
      let token = 'HBAR';
      let fromAddr = null;
      let memo = tx.memo_base64 ? Buffer.from(tx.memo_base64, 'base64').toString().trim() : null;

      // HBAR transfers
      const hbarXfer = tx.transfers?.find(t => t.account === DEPOSIT_ACCOUNT_ID && t.amount > 0);
      if (hbarXfer) {
        amount = new Decimal(hbarXfer.amount).div(1e8).toString();
        fromAddr = tx.transfers.find(t => t.amount < 0)?.account;
      }

      // HTS transfers (token.transfers list)
      const tokenXfer = tx.token_transfers?.find(t => t.account === DEPOSIT_ACCOUNT_ID && t.amount > '0');
      if (tokenXfer) {
        const match = Object.entries(TOKEN_CONFIG).find(([key, spec]) => spec.hedera?.tokenId === tokenXfer.token_id);
        if (match) {
          token = match[0];
          amount = tokenXfer.amount; // string, handle decimals via config
          fromAddr = tx.token_transfers.find(t => t.amount < 0)?.account;
        }
      }

      if (!amount || new Decimal(amount).isZero() || !memo) continue;

      // Dedup, user lookup (cache), buffer push, balance agg — like your other listeners
      // ...

      // If buffer high → flushDeposits()
    }
  } catch (err) {
    // exponential backoff retry, alert if repeated
  }
}

// Start: load last timestamp from Ledger model, setInterval(pollTransactions, POLL_INTERVAL_MS)
// Gap scan: on start/reconnect, query wider timestamp range or last N txs
// flushDeposits: insertMany + bulk $inc + checkpoint timestamp upsert
