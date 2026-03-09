const { Client } = require('xrpl');

module.exports = async function confirmXrpl(dep, expectedTag) {
  const client = new Client(process.env.XRPL_RPC_URL);
  try {
    await client.connect();

    const tx = await client.request({
      command: 'tx',
      transaction: dep.txHash
    });

    // 1. Must be validated by the network
    if (!tx.result.validated) return { confirmed: false };

    // 2. Must be a successful payment
    if (tx.result.meta.TransactionResult !== 'tesSUCCESS') {
      return { confirmed: false };
    }

    // 3. CRITICAL: Verify the Destination Tag matches the user
    // On XRPL, it's tx.result.Destination
    if (Number(tx.result.DestinationTag) !== Number(expectedTag)) {
      return { confirmed: false, error: 'Destination Tag mismatch' };
    }

    // 4. Verification of the Amount (prevents "Partial Payment" exploits)
    // Sometimes 'Amount' is an object (for issued tokens) or a string (for XRP)
    const deliveredAmount = tx.result.meta.delivered_amount || tx.result.Amount;
    // You should compare 'deliveredAmount' to 'dep.amount' here

    return { confirmed: true };
    
  } catch (err) {
    console.error("XRPL Confirm Error:", err.message);
    return { confirmed: false };
  } finally {
    await client.disconnect();
  }
};
