const { Client } = require("xrpl");
const Deposit = require("./models/Deposit");
const User = require("./models/User");

async function startXrplListener() {
  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  // ── Reconnection logic ──
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 20;          // High but finite to prevent infinite loops
  const baseDelayMs = 1000;                 // Start at 1s
  const maxDelayMs = 60000;                 // Cap at 60s

  client.on("disconnected", (code) => {
    console.error(`XRPL disconnected (code: ${code || 'unknown'})`);
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`Max reconnect attempts (${maxReconnectAttempts}) reached. Stopping listener.`);
      // Optional: process.exit(1); or send alert (e.g., via your logger)
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

        reconnectAttempts = 0; // Reset on success
      } catch (err) {
        console.error("Reconnect failed:", err.message);
        // 'disconnected' will fire again if connect() fails → next backoff
      }
    }, delay);
  });

  // Catch general errors (e.g., connection refused, auth issues)
  client.on("error", (error) => {
    console.error("XRPL Client error:", error);
  });

  // Optional: Log successful connects (helps debugging)
  client.on("connected", () => {
    console.log("XRPL connection established (or re-established)");
  });

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
    // You could manually trigger a reconnect here, but the 'disconnected' handler will catch it
    return; // Or throw to crash early if critical
  }

  // ── Your existing in-memory cache and transaction handler ──
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
      const currency = meta.delivered_amount.currency;
      const issuer = meta.delivered_amount.issuer;

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

    // Duplicate check
    const exists = await Deposit.findOne({ txHash: tx.hash });
    if (exists) return;

    // User lookup with cache
    let user = userCache.get(tx.DestinationTag);
    if (!user) {
      user = await User.findOne({ destinationTag: tx.DestinationTag });
      if (!user) return;
      userCache.set(tx.DestinationTag, user);
    }

    // Create deposit & credit balance
    await Deposit.create({
      walletAddress: tx.Account,
      chain: "XRPL",
      token,
      txHash: tx.hash,
      amount,
      confirmations: 1,
    });

    await User.updateOne(
      { _id: user._id },
      { $inc: { [`balances.${token}`]: Number(amount) } }
    );
  });
}

module.exports = startXrplListener;
