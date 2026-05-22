// services/ChainConfirmations/stellar.js
const StellarSdk = require('stellar-sdk');
const Decimal = require('decimal.js');
const logger = require('../../logger');

const server = new StellarSdk.Horizon.Server(process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org');
const DEPOSIT_ADDRESS = process.env.STELLAR_DEPOSIT_ADDRESS;

module.exports = async function confirmStellar(dep) {
  try {
    const tx = await server.transactions().transaction(dep.txHash).call();
    if (!tx.successful) {
      return { confirmed: false, confirmations: 0 };
    }

    const latestLedger = (await server.ledgers().order('desc').limit(1).call()).records[0].sequence;
    const depth = latestLedger - tx.ledger_attr;

    if (depth < 1) {
      return { confirmed: false, confirmations: depth };
    }

    const ops = await server.effects().forTransaction(dep.txHash).call();
    const paymentOp = ops.records.find(op => op.type === 'payment');

    if (!paymentOp || paymentOp.to !== DEPOSIT_ADDRESS) {
      return { confirmed: false };
    }

    // Memo match
    let receivedMemo = tx.memo_type === 'text' ? tx.memo : (tx.memo_type === 'id' ? tx.memo.toString() : null);
    if (receivedMemo !== dep.memo) {
      return { confirmed: false };
    }

    // Amount & token with Decimal safety
    let confirmedAmount = new Decimal(paymentOp.amount);
    let token = 'XLM';

    if (paymentOp.asset_type !== 'native') {
      if (paymentOp.asset_code === 'SeagullCash' && paymentOp.asset_issuer === (process.env.STELLAR_SEAGULLCASH_ISSUER || 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7')) {
        token = 'SeagullCash';
      } else {
        return { confirmed: false };
      }
    }

    if (token !== dep.token || !confirmedAmount.equals(new Decimal(dep.amount))) {
      logger.warn({ module: 'ConfirmStellar', event: 'amount_mismatch', txHash: dep.txHash });
      return { confirmed: false };
    }

    return {
      confirmed: true,
      confirmations: depth,
      amount: confirmedAmount.toString(),
      ledger: tx.ledger_attr
    };

  } catch (err) {
    if (err instanceof StellarSdk.NotFoundError) {
      return { confirmed: false, confirmations: 0 };
    }
    logger.error({ module: 'ConfirmStellar', txHash: dep.txHash, error: err.message });
    throw err; // Let retry handle
  }
};
