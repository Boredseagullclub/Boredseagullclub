const { Client } = require("xrpl");
const Deposit = require("./models/Deposit");
const User = require("./models/User");

async function startXrplListener() {
  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  // --- Batching setup ---
  const depositBuffer = [];
  const userBalances = new Map(); // { userId: { token: totalAmount } }

  // Flush deposits & balances periodically (1 sec, tweak for high volume)
  const flushDeposits = async () => {
    if (depositBuffer.length === 0) return;

    // Insert all deposits at once
    await Deposit.insertMany(depositBuffer.splice(0));

    // Bulk update user balances
    const bulkOps = [];
    for (const [userId, tokens] of userBalances) {
      const inc = {};
      for (const [token, amt] of Object.entries(tokens)) inc[`balances.${token}`] = amt;
      bulkOps.push({ updateOne: { filter: { _id: userId }, update: { $inc: inc } } });
    }
    if (bulkOps.length) await User.bulkWrite(bulkOps);

    userBalances.clear();
  };

  // Flush every 1 second
  setInterval(flushDeposits, 1000);

  // ── Reconnection logic ──
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 20;
  const baseDelayMs = 1000;
  const maxDelayMs = 60000;

  client.on("disconnected", (code) => {
    console.error(`XRPL disconnected (code: ${code || 'unknown'})`);
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`Max reconnect attempts (${maxReconnectAttempts}) reached. Stopping listener.`);
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(baseDelayMs * Math.pow(1.6, reconnectAttempts - 1), maxDelayMs);

    console.log(`Attempting reconnect in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);

    setTimeout(async () => {
      try {
        await client.connect();
        console.log("Reconnected to XRPL");

        // Re-subscribe to the account
        await client.request({
          command: "subscribe",
          accounts: [depositAddress],
        });
        console.log("Re-subscribed to deposit address");

        reconnectAttempts = 0;
      } catch (err) {
        console.error("Reconnect failed:", err.message);
      }
    }, delay);
  });

  client.on("error", (error) => console.error("XRPL Client error:", error));
  client.on("connected", () => console.log("XRPL connection established (or re-established)"));

  // ── Initial connection & subscribe ──
  try {
    await client.connect();
    console.log("XRPL initial connection successful");

    await client.request({
      command: "subscribe",
      accounts: [depositAddress],
    });
    console.log("XRPL listener running - subscribed to deposit address");
  } catch (err) {
    console.error("Initial XRPL connection/subscribe failed:", err.message);
    return;
  }

  // ── Transaction handler ──
  const userCache = new Map();

  client.on("transaction", async (event) => {
    if (!event.validated) return;

    const tx = event.transaction;
    const meta = event.meta;

    if (tx.TransactionType !== "Payment") return;
    if (meta.TransactionResult !== "tesSUCCESS") return;
    if (tx.Destination !== depositAddress) return;

    let amount;
    let token = "XRP";

    if (typeof meta.delivered_amount === "string") {
      amount = meta.delivered_amount;
    } else {
      const { currency, issuer } = meta.delivered_amount;

      if (currency === "SeagullCoin" && issuer === "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno") {
        token = "SeagullCoin";
        amount = meta.delivered_amount.value;
      } else if (currency === "SeagullCash" && issuer === "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK") {
        token = "SeagullCash";
        amount = meta.delivered_amount.value;
      } else {
        return; // ignore other tokens
      }
    }

    // Duplicate prevention
    const exists = await Deposit.findOne({ txHash: tx.hash });
    if (exists) return;

    // User lookup with cache
    let user = userCache.get(tx.DestinationTag);
    if (!user) {
      user = await User.findOne({ destinationTag: tx.DestinationTag });
      if (!user) return;
      userCache.set(tx.DestinationTag, user);
    }

    // --- Buffer deposit and aggregate balances ---
    depositBuffer.push({
      walletAddress: tx.Account,
      chain: "XRPL",
      token,
      txHash: tx.hash,
      amount,
      confirmations: 1,
    });

    if (!userBalances.has(user._id)) userBalances.set(user._id, {});
    const userTokens = userBalances.get(user._id);
    userTokens[token] = (userTokens[token] || 0) + Number(amount);
  });
}

module.exports = startXrplListener;
