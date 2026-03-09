const { Client } = require('xrpl');

module.exports = async function confirmXrpl(dep, expectedTag) {
  const client = new Client(process.env.XRPL_RPC_URL);

  try {
    await client.connect();

    const tx = await client.request({
      command: 'tx',
      transaction: dep.txHash
    });

    const result = tx.result;

    // Must be validated
    if (!result.validated) return { confirmed: false };

    // Must be payment transaction
    if (result.TransactionType !== 'Payment')
      return { confirmed: false };

    // Must succeed
    if (result.meta.TransactionResult !== 'tesSUCCESS')
      return { confirmed: false };

    // Must go to deposit wallet
    if (result.Destination !== process.env.XRPL_DEPOSIT_ADDRESS)
      return { confirmed: false };

    // Destination tag must match user
    if (Number(result.DestinationTag) !== Number(expectedTag))
      return { confirmed: false, error: 'Destination Tag mismatch' };

    // Partial payment protection
    const deliveredAmount = result.meta.delivered_amount;

    if (!deliveredAmount)
      return { confirmed: false };

    return {
      confirmed: true,
      amount: deliveredAmount,
      ledger: result.ledger_index
    };

  } catch (err) {
    console.error("XRPL Confirm Error:", err.message);
    return { confirmed: false };
  } finally {
    await client.disconnect();
  }
};
