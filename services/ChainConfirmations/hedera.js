// services/ChainConfirmations/hedera.js

const { Client, TransactionId } = require('@hashgraph/sdk');

module.exports = async function confirmHedera(dep) {
  try {
    const client = Client.forMainnet(); // change to Testnet if needed

    const txId = TransactionId.fromString(dep.txHash);

    const receipt = await txId.getReceipt(client);

    return receipt.status.toString() === 'SUCCESS';

  } catch (err) {
    return false;
  }
};
