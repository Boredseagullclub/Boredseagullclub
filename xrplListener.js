const { Client } = require("xrpl");
const Deposit = require("./models/Deposit");
const User = require("./models/User");
const Ledger = require("./models/Ledger"); // ← Added missing import

let highestSeenLedger = 0; // Module-level, initialized from DB on first scan

async function startXrplListener() {
  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  // --- High-throughput batching setup ---
  const depositBuffer = [];
  const userBalances = new Map(); // { userId: { token: totalAmount } }

  // Flush deposits & balances periodically
  const flushDeposits = async () => {
    if (depositBuffer.length === 0) return;

    const depositsToInsert = depositBuffer.splice(0);
    const bulkOps = [];

    // Aggregate balance increments per user
    for (const [userId, tokens] of userBalances) {
      const inc = {};
      for (const [token, amt] of Object.entries(tokens)) {
        inc[`balances.${token}`] = amt;
      }
      bulkOps.push({ updateOne: { filter: { _id: userId }, update: { $inc: inc } } });
    }

    userBalances.clear();

    try {
      await Promise.all([
        depositsToInsert.length && Deposit.insertMany(depositsToInsert),
        bulkOps.length && User.bulkWrite(bulkOps)
      ]);

      console.log(`Flushed ${depositsToInsert.length} deposits, highest ledger now ${highestSeenLedger}`);

      // Persist highest seen ledger (critical for restart / reconnect recovery)
      if (highestSeenLedger > 0) {
        await Ledger.findOneAndUpdate(
          { chain: "XRPL" },
          { 
            ledger_index: highestSeenLedger,
            updatedAt: new Date()
          },
          { upsert: true }
        ).catch(err => console.error("Failed to persist highest ledger:", err.message));
      }
    } catch (err) {
      console.error("Flush failed:", err.message);
      // Optional: you could add retry logic here in production
    }
  };

  // Flush every 500ms (tune based on actual volume)
  setInterval(flushDeposits, 500);

  // ── Reconnection logic ──
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 20;
  const baseDelayMs = 1000;
  const maxDelayMs = 60000;

  client.on("disconnected", (code) => {
    console.error(`XRPL disconnected (code: ${code || 'unknown'})`);
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error(`Max reconnect attempts reached (${maxReconnectAttempts}). Stopping listener.`);
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(baseDelayMs * Math.pow(1.6, reconnectAttempts - 1), maxDelayMs);

    console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${Math.round(delay / 1000)}s...`);

    setTimeout(async () => {
      try {
        await client.connect();
        console.log("Reconnected to XRPL");
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

  client.on("connected", async () => {
    console.log("XRPL connection established");
    await scanGaps();
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
    return;
  }

  // ── Gap scanning ──
  const scanGaps = async () => {
    console.log("Scanning recent ledgers for misses...");

    const lastEntry = await Ledger.findOne({ chain: "XRPL" })
      .sort({ ledger_index: -1 })
      .select("ledger_index")
      .lean();

    // Sync from DB if higher than current in-memory value
    if (lastEntry?.ledger_index > highestSeenLedger) {
      highestSeenLedger = lastEntry.ledger_index;
    }

    let minLedger = highestSeenLedger > 0 ? highestSeenLedger + 1 : undefined;

    // First run or long downtime → start ~1–2 days back
    if (!minLedger) {
      try {
        const server = await client.request({ command: "server_info" });
        const current = server.result.info.validated_ledger?.seq;
        if (current) {
          minLedger = Math.max(1, current - 5000);
          console.log(`No prior ledger found → starting scan from ledger ${minLedger}`);
        }
      } catch (err) {
        console.error("Could not fetch server_info for fallback:", err.message);
      }
    }

    try {
      const response = await client.request({
        command: "account_tx",
        account: depositAddress,
        ledger_index_min: minLedger,
        ledger_index_max: "validated",
        forward: true,
        limit: 100
      });

      for (const item of response.result.transactions) {
        client.emit("transaction", {
          validated: true,
          transaction: item.tx,
          meta: item.meta
        });
      }
    } catch (e) {
      console.error("Gap scan failed:", e.message);
    }
  };

  // ── Transaction handler ──
  const userCache = new Map();

  client.on("transaction", async (event) => {
    if (!event.validated) return;

    const tx = event.transaction;
    const meta = event.meta;

    if (tx.TransactionType !== "Payment") return;
    if (meta.TransactionResult !== "tesSUCCESS") return;
    if (tx.Destination !== depositAddress) return;

    // Update highest ledger early (applies to all valid payments)
    if (tx.ledger_index && tx.ledger_index > highestSeenLedger) {
      highestSeenLedger = tx.ledger_index;
    }

    let amount;
    let token = "XRP";

    if (typeof meta.delivered_amount === "string") {
      amount = meta.delivered_amount;
    } else if (meta.delivered_amount && typeof meta.delivered_amount === "object") {
      const { currency, issuer, value } = meta.delivered_amount;
      if (currency === "SeagullCoin" && issuer === "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno") {
        token = "SeagullCoin";
        amount = value;
      } else if (currency === "SeagullCash" && issuer === "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK") {
        token = "SeagullCash";
        amount = value;
      } else {
        return; // ignore unsupported tokens
      }
    } else {
      return; // no delivered_amount
    }

    if (!amount) return;

    // Quick duplicate check
    if (await Deposit.exists({ txHash: tx.hash })) return;

    const tag = String(tx.DestinationTag ?? "");
    if (!tag) return;

    let user = userCache.get(tag);
    if (!user) {
      user = await User.findOne({ depositTag: tag });
      if (!user) return;
      userCache.set(tag, user);
    }

    // Buffer the deposit
    depositBuffer.push({
      walletAddress: tx.Account,
      chain: "XRPL",
      token,
      txHash: tx.hash,
      amount,
      confirmations: 1,
      ledgerIndex: tx.ledger_index || null,
      timestamp: tx.date ? new Date((tx.date + 946684800) * 1000) : new Date(),
    });

    console.log(`Buffered: ${tx.hash} | ${token} ${amount} | tag:${tag} | ledger:${tx.ledger_index}`);

    // Update user balance in memory
    const userId = user._id.toString();
    if (!userBalances.has(userId)) userBalances.set(userId, {});
    const userTokens = userBalances.get(userId);
    userTokens[token] = (userTokens[token] || 0) + Number(amount);
    userBalances.set(userId, userTokens);

    // Force flush on high volume
    if (depositBuffer.length > 400) {
      await flushDeposits();
    }
  });
}

module.exports = startXrplListener;  // --- Reconnection logic ---
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 20;
  const BASE_DELAY = 1000;
  const MAX_DELAY = 60000;

  client.on("disconnected", (code) => {
    console.error(`XRPL disconnected (code: ${code || 'unknown'})`);
    if (reconnectAttempts >= MAX_RECONNECT) return;

    reconnectAttempts++;
    const delay = Math.min(BASE_DELAY * Math.pow(1.6, reconnectAttempts - 1), MAX_DELAY);
    console.log(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT} in ${Math.round(delay/1000)}s`);

    setTimeout(async () => {
      try {
        await client.connect();
        console.log("Reconnected to XRPL");
        await client.request({ command: "subscribe", accounts: [depositAddress] });
        reconnectAttempts = 0;
      } catch (err) {
        console.error("Reconnect failed:", err.message);
      }
    }, delay);
  });

  client.on("error", (err) => console.error("XRPL Client error:", err));
  client.on("connected", async () => {
    console.log("XRPL connected");
    await scanGaps();
  });

  // --- Initial connection & subscribe ---
  try {
    await client.connect();
    await client.request({ command: "subscribe", accounts: [depositAddress] });
    console.log("XRPL listener running");
  } catch (err) {
    console.error("Initial connection failed:", err.message);
    return;
  }

  // --- Gap scanning with pagination ---
  const scanGaps = async () => {
    console.log("Scanning missing ledgers...");

    const lastEntry = await Ledger.findOne({ chain: "XRPL" }).sort({ ledger_index: -1 }).select("ledger_index").lean();
    if (lastEntry?.ledger_index > highestSeenLedger) highestSeenLedger = lastEntry.ledger_index;

    let minLedger = highestSeenLedger > 0 ? highestSeenLedger + 1 : undefined;
    if (!minLedger) {
      try {
        const server = await client.request({ command: "server_info" });
        const current = server.result.info.validated_ledger?.seq;
        if (current) minLedger = Math.max(1, current - 5000);
      } catch {}
    }

    let marker = null;
    do {
      try {
        const response = await client.request({
          command: "account_tx",
          account: depositAddress,
          ledger_index_min: minLedger,
          ledger_index_max: "validated",
          forward: true,
          limit: 100,
          marker
        });

        for (const tx of response.result.transactions) {
          client.emit("transaction", { validated: true, transaction: tx.tx, meta: tx.meta });
        }

        marker = response.result.marker;
      } catch (err) {
        console.error("Gap scan failed:", err.message);
        break;
      }
    } while (marker);
  };

  // --- Transaction handler ---
  const userCache = new Map();

  client.on("transaction", async (event) => {
    if (!event.validated) return;
    const tx = event.transaction;
    const meta = event.meta;

    if (tx.TransactionType !== "Payment" || meta.TransactionResult !== "tesSUCCESS" || tx.Destination !== depositAddress) return;

    if (tx.ledger_index && tx.ledger_index > highestSeenLedger) highestSeenLedger = tx.ledger_index;

    let amount, token = "XRP";
    if (typeof meta.delivered_amount === "string") {
      amount = meta.delivered_amount;
    } else if (meta.delivered_amount && typeof meta.delivered_amount === "object") {
      const { currency, issuer, value } = meta.delivered_amount;
      if ((currency === "SeagullCoin" && issuer === "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno") ||
          (currency === "SeagullCash" && issuer === "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK")) {
        token = currency;
        amount = value;
      } else return;
    } else return;

    if (!amount) return;

    // Duplicate check via unique index & fallback
    try {
      if (await Deposit.exists({ txHash: tx.hash })) return;
    } catch (err) {
      console.error("Deposit check failed:", err.message);
      return;
    }

    const tag = String(tx.DestinationTag ?? "");
    if (!tag) return;

    let user = userCache.get(tag);
    if (!user) {
      user = await User.findOne({ depositTag: tag });
      if (!user) return;
      userCache.set(tag, user);
    }

    // --- Buffer deposit and update in-memory balances ---
    if (depositBuffer.length >= MAX_BUFFER) {
      console.warn(`Deposit buffer full (${MAX_BUFFER}), forcing flush`);
      await flushDeposits();
    }

    depositBuffer.push({
      walletAddress: tx.Account,
      chain: "XRPL",
      token,
      txHash: tx.hash,
      amount,
      confirmations: 1,
      ledgerIndex: tx.ledger_index || null,
      timestamp: tx.date ? new Date((tx.date + 946684800) * 1000) : new Date()
    });

    const userId = user._id.toString();
    if (!userBalances.has(userId)) userBalances.set(userId, {});
    const userTokens = userBalances.get(userId);
    userTokens[token] = (userTokens[token] || 0) + Number(amount);
    userBalances.set(userId, userTokens);
  });
}

const flushDeposits = async () => {
  if (depositBuffer.length === 0) return;

  const depositsToInsert = depositBuffer.splice(0);
  const bulkOps = [];

  // Aggregate balance increments per user
  for (const [userId, tokens] of userBalances) {
    const inc = {};
    for (const [token, amt] of Object.entries(tokens)) {
      inc[`balances.${token}`] = amt;
    }
    bulkOps.push({ updateOne: { filter: { _id: userId }, update: { $inc: inc } } });
  }

  // ⚠️ Take snapshot before clearing
  const balanceSnapshot = new Map(userBalances);
  userBalances.clear();

  try {
    await Promise.all([
      depositsToInsert.length && Deposit.insertMany(depositsToInsert, { ordered: false }),
      bulkOps.length && User.bulkWrite(bulkOps)
    ]);

    console.log(`Flushed ${depositsToInsert.length} deposits, highest ledger now ${highestSeenLedger}`);

    if (highestSeenLedger > 0) {
      await Ledger.findOneAndUpdate(
        { chain: "XRPL" },
        { ledger_index: highestSeenLedger, updatedAt: new Date() },
        { upsert: true }
      ).catch(err => console.error("Failed to persist highest ledger:", err.message));
    }
  } catch (err) {
    console.error("Flush failed:", err.message);

    // Restore deposits
    depositBuffer.unshift(...depositsToInsert);

    // Restore balances safely
    for (const [userId, tokens] of balanceSnapshot) {
      userBalances.set(userId, tokens);
    }
  }
};

module.exports = startXrplListener;
