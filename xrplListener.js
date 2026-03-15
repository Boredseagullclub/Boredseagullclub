const { Client } = require("xrpl");
const mongoose = require("mongoose");
const Decimal = require("decimal.js");

const Deposit = require("./models/Deposit");
const User = require("./models/User");
const Ledger = require("./models/Ledger");

let highestSeenLedger = 0;

async function startXrplListener() {
  const client = new Client(process.env.XRPL_WS_URL);
  const depositAddress = process.env.XRPL_DEPOSIT_ADDRESS;

  const depositBuffer = [];
  const userBalances = new Map(); // userId → { token: string amount }

  const MAX_BUFFER_SIZE = 10000;
  const FLUSH_THRESHOLD = 400;

  // --- Flush deposits safely ---
  const flushDeposits = async () => {
    if (!depositBuffer.length) return;

    const depositsToInsert = depositBuffer.splice(0);
    const bulkOps = [];

    for (const [userId, tokens] of userBalances) {
      const inc = {};
      for (const [token, amtStr] of Object.entries(tokens)) {
        inc[`balances.${token}`] = amtStr;
      }
      bulkOps.push({ updateOne: { filter: { _id: userId }, update: { $inc: inc } } });
    }

    const balanceSnapshot = new Map(userBalances);
    userBalances.clear();

    try {
      await Promise.all([
        depositsToInsert.length && Deposit.insertMany(depositsToInsert, { ordered: false }),
        bulkOps.length && User.bulkWrite(bulkOps)
      ]);

      console.log(`Flushed ${depositsToInsert.length} deposits, ledger ${highestSeenLedger}`);

      if (highestSeenLedger > 0) {
        await Ledger.findOneAndUpdate(
          { chain: "XRPL" },
          { ledger_index: highestSeenLedger, updatedAt: new Date() },
          { upsert: true }
        );
      }
    } catch (err) {
      console.error("Flush failed:", err.message);
      // Restore buffer & balances
      depositBuffer.unshift(...depositsToInsert);
      for (const [k, v] of balanceSnapshot) userBalances.set(k, v);
    }
  };

  setInterval(flushDeposits, 500);

  // --- Reconnection logic ---
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 20;
  const BASE_DELAY = 1000;
  const MAX_DELAY = 60000;
  let isConnecting = false;

  const connectAndSubscribe = async () => {
    if (isConnecting || client.isConnected()) return;
    isConnecting = true;

    try {
      await client.connect();
      await client.request({ command: "subscribe", accounts: [depositAddress] });
      console.log("Connected & subscribed to deposit address");
      reconnectAttempts = 0;
    } catch (err) {
      reconnectAttempts++;
      const delay = Math.min(BASE_DELAY * (1.6 ** (reconnectAttempts - 1)), MAX_DELAY);
      console.error(`Connection attempt ${reconnectAttempts} failed:`, err.message);
      if (reconnectAttempts < MAX_RECONNECT) {
        console.log(`Retrying in ${Math.round(delay / 1000)}s...`);
        setTimeout(connectAndSubscribe, delay);
      } else {
        console.error("Max reconnect attempts reached, listener stopped.");
      }
    } finally {
      isConnecting = false;
    }
  };

  client.on("disconnected", (code) => {
    console.error(`Disconnected (code: ${code || 'unknown'})`);
    connectAndSubscribe();
  });

  client.on("error", (err) => console.error("Client error:", err));

  // --- Gap scanning ---
  const scanGaps = async () => {
    const last = await Ledger.findOne({ chain: "XRPL" })
      .sort({ ledger_index: -1 })
      .select("ledger_index")
      .lean();

    if (last?.ledger_index > highestSeenLedger) highestSeenLedger = last.ledger_index;

    let minLedger = highestSeenLedger > 0 ? highestSeenLedger + 1 : undefined;

    if (!minLedger) {
      try {
        const { result } = await client.request({ command: "server_info" });
        const seq = result.info.validated_ledger?.seq;
        if (seq) minLedger = Math.max(1, seq - 5000);
      } catch (err) {
        console.error("Failed to get server_info for gap scan:", err.message);
        return;
      }
    }

    let marker = null;
    do {
      try {
        const req = {
          command: "account_tx",
          account: depositAddress,
          ledger_index_min: minLedger,
          ledger_index_max: "validated",
          forward: true,
          limit: 100,
          marker
        };
        const resp = await client.request(req);

        for (const item of resp.result.transactions || []) {
          client.emit("transaction", { validated: true, transaction: item.tx, meta: item.meta });
        }

        marker = resp.result.marker;
      } catch (err) {
        console.error("Gap scan failed:", err.message);
        break;
      }
    } while (marker);
  };

  // --- Transaction handler ---
  const userCache = new Map();

  client.on("transaction", async (ev) => {
    if (!ev.validated) return;
    const { transaction: tx, meta } = ev;

    if (tx.TransactionType !== "Payment" || meta.TransactionResult !== "tesSUCCESS" || tx.Destination !== depositAddress) return;

    if (tx.ledger_index > highestSeenLedger) highestSeenLedger = tx.ledger_index;

    let amount = null;
let token = null;

if (meta.delivered_amount === "unavailable") {
  // Rare partial-payment edge case — usually skip or handle specially
  return;
}

if (typeof meta.delivered_amount === "string") {
  // XRP → convert drops → XRP decimal string
  token = "XRP";
  amount = new Decimal(meta.delivered_amount).div(1000000).toString();
} else if (meta.delivered_amount && typeof meta.delivered_amount === "object") {
  const da = meta.delivered_amount;
  if (da.currency === "SeagullCoin" && da.issuer === "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno") {
    token = "SeagullCoin";
    amount = da.value;
  } else if (da.currency === "SeagullCash" && da.issuer === "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK") {
    token = "SeagullCash";
    amount = da.value;
  }
}

if (!token || !amount || amount === "0") return;
    if (await Deposit.exists({ txHash: tx.hash, chain: "XRPL" })) return;

    const tag = String(tx.DestinationTag ?? "");
    if (!tag) return;

    let user = userCache.get(tag);
    if (!user) {
      user = await User.findOne({ depositTag: tag });
      if (!user) return;
      userCache.set(tag, user);
    }

    const decAmount = new Decimal(amount);

    depositBuffer.push({
      userId: user._id,
      walletAddress: tx.Account,
      chain: "XRPL",
      token,
      txHash: tx.hash,
      amount: mongoose.Types.Decimal128.fromString(amount),
      confirmations: 1,
      ledgerIndex: tx.ledger_index || null,
      timestamp: tx.date ? new Date((tx.date + 946684800) * 1000) : new Date(),
      status: "DETECTED"
    });

    const userIdStr = user._id.toString();
    if (!userBalances.has(userIdStr)) userBalances.set(userIdStr, {});
    const tokens = userBalances.get(userIdStr);
    tokens[token] = new Decimal(tokens[token] || "0").plus(decAmount).toString();

    if (depositBuffer.length > FLUSH_THRESHOLD || depositBuffer.length > MAX_BUFFER_SIZE - 100) {
      await flushDeposits();
    }
  });

  // --- Start connection ---
  await connectAndSubscribe();
}

module.exports = startXrplListener;
