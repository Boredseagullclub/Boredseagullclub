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

    if (tx.TransactionType !== "Payment") return;

    if (meta.TransactionResult !== "tesSUCCESS") return;

    if (tx.Destination !== depositAddress) return;

    const amount = meta.delivered_amount;
    if (!amount) return;

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
