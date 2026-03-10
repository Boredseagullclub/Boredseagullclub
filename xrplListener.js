const { Client } = require("xrpl");
const Deposit = require("./models/Deposit");
const User = require("./models/User");

async function startXrplListener() {

  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  await client.connect();

  await client.request({
    command: "subscribe",
    accounts: [depositAddress]
  });

  console.log("XRPL listener running");

  client.on("transaction", async (event) => {
  if (!event.validated) return;

  const tx = event.transaction;
  const meta = event.meta;

  // Only handle payments to your deposit address
  if (tx.TransactionType !== "Payment") return;
  if (meta.TransactionResult !== "tesSUCCESS") return;
  if (tx.Destination !== depositAddress) return;

  // --- ADD THIS CHECK HERE ---
  if (
    typeof meta.delivered_amount === 'string' || // XRP
    meta.delivered_amount.currency !== 'SeagullCoin' ||
    meta.delivered_amount.issuer !== 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno'
  ) {
    return; // Ignore non-SeagullCoin payments
  }

  // Optional: duplicate deposit prevention
  const exists = await Deposit.findOne({ txHash: tx.hash });
  if (exists) return;

  // Credit the deposit
  const amount = meta.delivered_amount.value || meta.delivered_amount; // XRP is string, others have value
  const tag = tx.DestinationTag;

  const user = await User.findOne({ destinationTag: tag });
  if (!user) return;

  await Deposit.create({
    walletAddress: tx.Account,
    chain: "XRPL",
    token: "SeagullCoin",
    txHash: tx.hash,
    amount,
    confirmations: 1
  });

  });

}

module.exports = startXrplListener;
