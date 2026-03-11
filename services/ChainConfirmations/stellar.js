// services/ChainConfirmations/stellar.js
const StellarSdk = require('stellar-sdk');

const server = new StellarSdk.Server(process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org');
const DEPOSIT_ADDRESS = process.env.STELLAR_DEPOSIT_ADDRESS;
const SEAGULLCASH_ISSUER = process.env.STELLAR_SEAGULLCASH_ISSUER || 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';

module.exports = async function confirmStellar(dep) {
  try {
    const tx = await server.transactions().transaction(dep.txHash).call();

    if (!tx.successful) {
      return { confirmed: false, confirmations: 0 };
    }

    // Get current ledger for depth
    const latestLedger = (await server.ledgers().order('desc').limit(1).call()).records[0].sequence;
    const depth = latestLedger - tx.ledger_attr;
    const minDepth = 1; // or 3 for extra caution

    if (depth < minDepth) {
      return { confirmed: false, confirmations: depth };
    }

    // Fetch ops (usually 1 for payment)
    const ops = await server.effects().forTransaction(dep.txHash).call(); // or .operations()
    const paymentOp = ops.records.find(op => op.type === 'payment');
    if (!paymentOp || paymentOp.to !== DEPOSIT_ADDRESS) {
      return { confirmed: false };
    }

    // Memo match (from dep.memo)
    let receivedMemo = null;
    if (tx.memo_type === 'text') receivedMemo = tx.memo;
    else if (tx.memo_type === 'id') receivedMemo = tx.memo.toString();

    if (receivedMemo !== dep.memo) {
      return { confirmed: false };
    }

    // Amount & token
    let confirmedAmount = paymentOp.amount;
    let token = 'XLM';
    if (paymentOp.asset_type !== 'native') {
      if (paymentOp.asset_code === 'SeagullCash' && paymentOp.asset_issuer === SEAGULLCASH_ISSUER) {
        token = 'SeagullCash';
      } else {
        return { confirmed: false };
      }
    }

    if (token !== dep.token || confirmedAmount !== dep.amount) {
      logger.warn({ module: 'ConfirmStellar', event: 'mismatch', txHash: dep.txHash });
      return { confirmed: false };
    }

    return {
      confirmed: true,
      confirmations: depth,
      amount: confirmedAmount,
      ledger: tx.ledger_attr
    };
  } catch (err) {
    if (err instanceof StellarSdk.NotFoundError) {
      return { confirmed: false, confirmations: 0 };
    }
    logger.error({ module: 'ConfirmStellar', error: err.message, txHash: dep.txHash });
    throw err; // Let retry logic handle
  }
};
