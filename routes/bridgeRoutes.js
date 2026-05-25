const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// 🛡️ THE BOUNCER: Protects your "Ordering Desk" from spam
const bridgeIntentLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 Minute window
  max: 10, // Max 10 intents per IP
  message: {
    status: "ERROR",
    message: "Bridge intent limit reached. Please wait 30 minutes or complete your pending swaps."
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// 🗺️ DYNAMIC WALLET MAP: No longer hardcoded to Stellar
const WALLET_MAP = {
  'XLM': process.env.STELLAR_HOT_WALLET,
  'XRPL':    process.env.XRPL_HOT_WALLET,
  'XDC':     process.env.XDC_HOT_WALLET,
  'HBAR':    process.env.HBAR_HOT_WALLET,
  'FLARE':   process.env.FLARE_HOT_WALLET
};

router.post('/intent', bridgeIntentLimiter, async (req, res) => {
  try {
    // 1. Extract data from the body
    const { amount, symbol, fromChain, toChain, destinationAddress, userId } = req.body;

    // 🦅 VALIDATION: No more guessing. The bridge must know the origin.
    if (!fromChain) {
      return res.status(400).json({
        success: false,
        error: "Source chain (fromChain) is required."
      });
    }

    const sourceChainUpper = fromChain.toUpperCase();
    const depositAddress = WALLET_MAP[sourceChainUpper];

    if (!depositAddress) {
      return res.status(400).json({
        success: false,
        error: `The network '${sourceChainUpper}' is not mapped in the Hot Wallet config.`
      });
    }

    // 2. Create the Unique 6-Digit Memo
    const uniqueMemo = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Insert the record into 'deposits'
    await mongoose.connection.db.collection('deposits').insertOne({
      userId: userId || req.body.userId || req.body.address,
      fromChain: fromChain,
      toChain: toChain,
      amount: amount,
      symbol: symbol,
      walletAddress: destinationAddress,
      depositAddress: depositAddress,
      memo: uniqueMemo,
      status: 'AWAITING_DEPOSIT',
      txHash: `INTENT_${uniqueMemo}_${Date.now()}`,
      chain: fromChain,
      createdAt: new Date()
    });

    // 🦅 4. THE SOVEREIGN ADJUSTMENT: Distinguish between intent and payment
    let depositSymbol = symbol;
    let depositAmount = amount;

    // ⚖️ RATIO ENGINE: If they want COIN, they pay 1000x in CASH
    if (symbol === 'SEAGULLCOIN' && sourceChainUpper === 'FLARE') {
        depositSymbol = 'SEAGULLCASH';
        depositAmount = (parseFloat(amount) * 1000).toString();
    }
    // ⚖️ RATIO ENGINE: If they want CASH, they pay 1/1000th in COIN
    else if (symbol === 'SEAGULLCASH' && sourceChainUpper === 'XRPL') {
        depositSymbol = 'SEAGULLCOIN';
        depositAmount = (parseFloat(amount) / 1000).toString();
    }

    // 📢 DYNAMIC INSTRUCTIONS
    let displayInstruction = `Send ${depositAmount} ${depositSymbol} to ${depositAddress} with Memo: ${uniqueMemo}`;

    // 🛡️ EVM OVERRIDE
    const evmChains = ['XDC', 'FLR', 'SGB', 'ETH', 'FLARE'];
    if (evmChains.includes(sourceChainUpper)) {
      displayInstruction = `Send ${depositAmount} ${depositSymbol} to ${depositAddress}. (Auto-matching via wallet address; no memo needed for private wallets)`;
    }

    // 🚀 THE FINAL HANDSHAKE
    res.json({
      success: true,
      memo: uniqueMemo,
      depositAddress: depositAddress,
      depositAmount: depositAmount,
      depositSymbol: depositSymbol,
      fromChain: sourceChainUpper,
      instruction: displayInstruction
    });

  } catch (err) {
    console.error("❌ BRIDGE ERROR:", err);
    res.status(500).json({ success: false, error: "Failed to initialize bridge intent." });
  }
});

router.get('/tickets/:address', async (req, res) => {
  try {
    const { address } = req.params;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const bridgeTickets = await mongoose.connection.db.collection('deposits')
      .find({ userId: address })
      .sort({ createdAt: -1 })
      .toArray();

    const supportTickets = await mongoose.connection.db.collection('support_tickets')
      .find({ userId: address })
      .toArray();

    // ⚓ Returning keys as the frontend expects
    res.json({
      success: true,
      tickets: bridgeTickets,
      supportTickets: supportTickets
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 THE MISSING LINK: Update the Intent with the Real Transaction ID
router.post('/claim', async (req, res) => {
  try {
    const { memo, realTxHash } = req.body;

    if (!memo || !realTxHash) {
      return res.status(400).json({ success: false, error: "Memo and Real TxHash required." });
    }

    const result = await mongoose.connection.db.collection('deposits').updateOne(
      { memo: memo, status: 'AWAITING_DEPOSIT' },
      {
        $set: {
          txHash: realTxHash,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: "Deposit intent not found." });
    }

    res.json({ success: true, message: "Bridge record updated. Scanner is now verifying..." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 THE MISSING LINK: This matches your frontend's "admin/support/create" call
router.post('/support/ticket', async (req, res) => {
  try {
    const { userId, memo, issue, email } = req.body;

    // 1. Save the ticket as usual
    await mongoose.connection.db.collection('support_tickets').insertOne({
      userId: userId || "ANONYMOUS",
      memo: memo || "ADMIN_FORM",
      issue: issue || "No description provided",
      email: email || "NOT_PROVIDED",
      status: 'OPEN',
      createdAt: new Date()
    });

    // 2. 🦅 THE FIX: Upsert the user profile so the checkmark works!
    if (email && email !== "NOT_PROVIDED") {
      await mongoose.connection.db.collection('users').updateOne(
        { address: userId }, 
        { $set: { email: email, lastSeen: new Date() } },
        { upsert: true } // This creates the user if they don't exist yet
      );
    }

    res.json({ success: true, message: "Ticket and Profile updated" });
  } catch (err) {
    res.status(500).json({ success: false, error: "Database write failed." });
  }
});


// 🦅 THE ADMIN GATEWAY: Fetch all tickets
router.get('/admin/support/all', async (req, res) => {
  try {
    // 🔒 Security: Check if the requester is YOU
    const adminWallet = "0x870f64e73e7d2dc5022b4b74e58c323b3148a984";
    const requester = req.headers['x-admin-address'];

    if (requester?.toLowerCase() !== adminWallet.toLowerCase()) {
      return res.status(403).json({ success: false, message: "Restricted Access" });
    }

    const tickets = await mongoose.connection.db
      .collection('support_tickets')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, tickets });
  } catch (err) {
    console.error("❌ ADMIN FETCH ERROR:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// 🦅 ADMIN REPLY: Updates the ticket with a response
router.post('/admin/support/respond', async (req, res) => {
  try {
    const { ticketId, adminNote } = req.body;
    
    await mongoose.connection.db.collection('support_tickets').updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { 
        $set: { 
          adminNote: adminNote,
          status: 'IN_PROGRESS',
          updatedAt: new Date()
        } 
      }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 🦅 THE RESOLVE ENDPOINT (Manual Collection Version)
router.post('/admin/support/resolve', async (req, res) => {
  try {
    const { ticketId } = req.body;

    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Missing Ticket ID" });
    }

    // 🦅 Use the same manual collection method that works for your Respond route
    const result = await mongoose.connection.db.collection('support_tickets').updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { 
        $set: { 
          resolved: true,
          status: 'RESOLVED',
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    res.json({ success: true, message: "Ticket marked as resolved" });
  } catch (err) {
    console.error("🦅 RESOLVE ERROR:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// 🦅 USER REPLY: Appends or updates the issue so Admin sees the new message
router.post('/user/support/reply', async (req, res) => {
  try {
    const { ticketId, message } = req.body;
    
    await mongoose.connection.db.collection('support_tickets').updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { 
        $set: { 
          issue: message, // Or append it to a 'history' array if you want a full transcript
          updatedAt: new Date(),
          status: 'OPEN' // Flip it back to OPEN so it pops up for the Admin again
        } 
      }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// 🦅 This handles the UI checkmark lookup
router.get('/user/profile/:address', async (req, res) => {
  try {
    // 🦅 Look in your 'users' collection for this wallet
    const user = await mongoose.connection.db.collection('users').findOne({
  walletAddress: req.params.address
});

    if (user) {
      res.json({ success: true, user: { email: user.email } });
    } else {
      res.json({ success: false, message: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 MASTER DIRECTORY: See all users & their status
// 🦅 Make sure the path matches what you're typing in the browser!
router.get('/admin/master-view', async (req, res) => {
  try {
    // 🦅 We use 'users' collection to find everyone with an email
    const users = await mongoose.connection.db.collection('users').find({
      email: { $exists: true }
    }).toArray();

    // 🦅 We get the tickets so you can see the chat history
    const tickets = await mongoose.connection.db.collection('support_tickets')
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: users.length,
      users: users.map(u => ({ address: u.publicAddress || u.address, email: u.email })),
      tickets: tickets
    });
  } catch (err) {
    console.error("Master View Error:", err);
    res.json({ success: false, error: err.message });
  }
});



module.exports = router;
