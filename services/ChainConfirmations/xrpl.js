// services/ChainConfirmations/xrpl.js
const { Client } = require('xrpl');
const Decimal = require('decimal.js');

module.exports = async function confirmXrpl(dep, expectedTag) {
  const client = new Client(process.env.XRPL_RPC_URL || 'wss://xrplcluster.com');

  try {
    await client.connect();

    const tx = await client.request({
      command: 'tx',
      transaction: dep.txHash
    });

    const result = tx.result;
    if (!result.validated || result.TransactionType !== 'Payment' || result.meta.TransactionResult !== 'tesSUCCESS') {
      return { confirmed: false };
    }

    if (result.Destination !== process.env.XRPL_DEPOSIT_ADDRESS) {
      return { confirmed: false };
    }

    if (Number(result.DestinationTag) !== Number(expectedTag)) {
      return { confirmed: false, error: 'Destination Tag mismatch' };
    }

    // Normalize delivered_amount (Drops or Issued Currency)
    let deliveredAmount;
    const delivered = result.meta.delivered_amount;

    if (typeof delivered === 'string') {
      // Native XRP in drops
      deliveredAmount = new Decimal(delivered).div(1_000_000);
    } else if (delivered && delivered.value) {
      // Issued currency
      deliveredAmount = new Decimal(delivered.value);
    } else {
      return { confirmed: false };
    }

    return {
      confirmed: true,
      amount: deliveredAmount.toString(),
      ledger: result.ledger_index
    };

  } catch (err) {
    logger.error({ module: 'ConfirmXrpl', txHash: dep.txHash, error: err.message });
    return { confirmed: false };
  } finally {
    await client.disconnect().catch(() => {});
  }
};
