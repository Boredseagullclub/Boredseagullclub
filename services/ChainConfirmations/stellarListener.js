// services/stellarListener.js
const StellarSdk = require('stellar-sdk');
const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Ledger = require('../models/Ledger');

const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org');
const depositAddress = process.env.STELLAR_DEPOSIT_ADDRESS;
const SEAGULLCASH_ISSUER = process.env.STELLAR_SEAGULLCASH_ISSUER || 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';

let highestSeenLedger = 0;
const depositBuffer = []; // Batch like XRPL
setInterval(flushDeposits, 500); // Tune

async function startStellarListener() {
  console.log('Stellar listener starting for', depositAddress);

  // Load highest ledger from DB
  const last = await Ledger.findOne({ chain: 'XLM' }).sort({ ledger_index: -1 });
  if (last) highestSeenLedger = last.ledger_index;

  await scanGaps();

  const es = server.payments()
    .forAccount(depositAddress)
    .cursor('now')
    .stream({
      onmessage: async (payment) => {
        if (payment.type !== 'payment') return;

        const txHash = payment.transaction_hash;
        const ledger = payment.ledger_attr;

        if (ledger > highestSeenLedger) highestSeenLedger = ledger;

        if (await Deposit.exists({ txHash })) return;

        const tx = await server.transactions().transaction(txHash).call();
        let memo = null;
        if (tx.memo_type === 'text') memo = tx.memo;
        else if (tx.memo_type === 'id') memo = tx.memo.toString();

        if (!memo) return console.log(`Ignored tx ${txHash}: no memo`);

        const user = await User.findOne({ depositTag: memo });
        if (!user) return console.log(`Ignored tx ${txHash}: unknown memo ${memo}`);

        let amount = payment.amount;
        let token = 'XLM';

        if (payment.asset_type !== 'native') {
          const code = payment.asset_code;
          const issuer = payment.asset_issuer;

          if (code === 'SeagullCash' && issuer === SEAGULLCASH_ISSUER) {
            token = 'SeagullCash';
          } else {
            return; // Ignore unsupported
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

        console.log(`Buffered Stellar deposit: ${amount} ${token} from ${payment.from} memo:${memo} tx:${txHash}`);

        if (depositBuffer.length > 400) await flushDeposits();
      },
      onerror: (err) => {
        console.error('Stellar stream error:', err);
        es.close();
        const delay = Math.min(1000 * Math.pow(1.6, reconnectAttempts++), 60000);
        setTimeout(startStellarListener, delay);
      }
    });

  // Persist ledger every 30s
  setInterval(async () => {
    if (highestSeenLedger > 0) {
      await Ledger.findOneAndUpdate({ chain: 'XLM' }, { ledger_index: highestSeenLedger, updatedAt: new Date() }, { upsert: true });
    }
  }, 30000);
}

async function scanGaps() {
  try {
    let cursor = highestSeenLedger > 0 ? `ledger:${highestSeenLedger + 1}` : 'now'; // Approximate; use time bounds if needed

    const recent = await server.payments()
      .forAccount(depositAddress)
      .order('desc')
      .limit(100)
      .call();

    for (const p of recent.records) {
      // Process like onmessage (extract to shared fn for DRY)
      // ...
    }
  } catch (err) {
    console.error('Stellar gap scan failed:', err);
  }
}

async function flushDeposits() {
  if (depositBuffer.length === 0) return;

  const toInsert = depositBuffer.splice(0);
  try {
    await Deposit.insertMany(toInsert);
    console.log(`Flushed ${toInsert.length} Stellar deposits`);
  } catch (err) {
    console.error('Stellar flush failed:', err);
    depositBuffer.unshift(...toInsert); // Restore on fail
  }
}

module.exports = startStellarListener;
