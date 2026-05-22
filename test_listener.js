const { Client } = require('xrpl');
require('dotenv').config();

async function startListener() {
  const client = new Client('wss://xrplcluster.com');
  await client.connect();
  
  const myAddress = process.env.BRIDGE_XRPL_ADDRESS;
  console.log(`📡 LISTENING FOR DEPOSITS ON: ${myAddress}`);

  // Subscribe to account transactions
  client.request({
    command: 'subscribe',
    accounts: [myAddress]
  });

  client.on('transaction', (tx) => {
    if (tx.transaction.TransactionType === 'Payment' && tx.transaction.Destination === myAddress) {
      console.log("💰 DEPOSIT DETECTED!");
      console.log(`From: ${tx.transaction.Account}`);
      console.log(`Amount: ${tx.transaction.Amount / 1000000} XRP`);
      console.log("🚀 ACTION: Minting L2 SeagullCoin for User...");
    }
  });
}

startListener();
