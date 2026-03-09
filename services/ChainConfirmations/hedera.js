const { Client, TransactionId } = require('@hashgraph/sdk');

// 1. Singleton Client: Avoid spinning up a new client on every request
const HEDERA_NETWORK = process.env.HEDERA_NETWORK || 'mainnet'; 
const client = HEDERA_NETWORK === 'testnet' ? Client.forTestnet() : Client.forMainnet();

module.exports = async function confirmHedera(dep, expectedMemo) {
  try {
    // 2. Parse the Transaction ID
    // Hedera uses 'accountId@seconds.nanos' format for Transaction IDs
    const txId = TransactionId.fromString(dep.txHash);

    // 3. Get the Record (Higher level than Receipt)
    // Records contain the transfer list and memo, which receipts do not.
    const record = await txId.getRecord(client);

    // 4. Verify Success
    if (record.receipt.status.toString() !== 'SUCCESS') {
      return { confirmed: false };
    }

    // 5. CRITICAL: Verify the Memo (The HBAR version of a Destination Tag)
    if (record.transactionMemo !== expectedMemo) {
      return { confirmed: false, error: 'Memo mismatch' };
    }

    // 6. Verify the Destination Address and Amount
    // We look for a transfer that matches your deposit wallet
    const depositWallet = process.env.HEDERA_DEPOSIT_ADDRESS;
    const transfer = record.transfers.find(t => 
      t.accountId.toString() === depositWallet && t.amount.toTinybars().isPositive()
    );

    if (!transfer) {
      return { confirmed: false, error: 'Deposit not found in transfer list' };
    }

    // Convert tinybars to HBAR (1 HBAR = 100,000,000 tinybars)
    const deliveredAmount = transfer.amount.toTinybars().toString();

    return {
      confirmed: true,
      amount: deliveredAmount,
      consensusTimestamp: record.consensusTimestamp.toString()
    };

  } catch (err) {
    console.error("[HederaEngine] Confirm Error:", err.message);
    // If the record isn't found yet, return false to let the queue retry
    return { confirmed: false };
  }
};
