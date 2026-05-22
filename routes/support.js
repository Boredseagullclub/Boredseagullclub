const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const ADMIN_WALLET = "0x870f64e73e7d2dc5022b4b74e58c323b3148a984".toLowerCase();

// 🦅 POST: /api/bridge/support/ticket (User Submission Gateway)
router.post('/ticket', async (req, res) => {
  const { userId, memo, issue, email } = req.body;

  if (!userId || !issue) {
    return res.status(400).json({ success: false, message: "Missing tracking address or issue description." });
  }

  try {
    const db = mongoose.connection.db;
    const ticketDocument = {
      userId: String(userId).toLowerCase(),
      memo: memo || "BRIDGE_WIDGET",
      issue: String(issue),
      email: email || 'no-email-provided@ecosystem.com',
      resolved: false,
      adminNote: "",
      createdAt: new Date()
    };

    await db.collection('tickets').insertOne(ticketDocument);
    console.log(`[SUPPORT SYSTEM] New ticket logged for ${userId}`);
    res.json({ success: true, message: "Ticket opened successfully." });
  } catch (err) {
    console.error("[SUPPORT ROUTE CRASH]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 GET: /api/bridge/support/all-tickets (Admin Data Fetch via Wallet Guard)
router.get('/all-tickets', async (req, res) => {
  const { adminAddress } = req.query;

  // 🦅 Strict type guard prevents .toLowerCase() crashes if parameter arrives undefined/blank
  if (!adminAddress || typeof adminAddress !== 'string' || adminAddress.toLowerCase() !== ADMIN_WALLET) {
    return res.status(403).json({ success: false, message: "Unauthorized wallet access connection denied." });
  }

  try {
    const db = mongoose.connection.db;
    const tickets = await db.collection('tickets').find({}).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, tickets });
  } catch (err) {
    console.error("[ADMIN FETCH CRASH]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 POST: /api/bridge/support/reply (Admin Response Gateway via Wallet Guard)
router.post('/reply', async (req, res) => {
  const { ticketId, adminResponse } = req.body;
  
  // 🦅 Hybrid Guard: Checks both request body and network headers
  const adminAddress = req.body.adminAddress || req.headers['x-admin-address'];

  // 🦅 Strict type guard prevents .toLowerCase() crashes if payload arrives undefined/blank
  if (!adminAddress || typeof adminAddress !== 'string' || adminAddress.toLowerCase() !== ADMIN_WALLET) {
    return res.status(403).json({ success: false, message: "Unauthorized administrative signature context." });
  }

  if (!ticketId || !adminResponse) {
    return res.status(400).json({ success: false, message: "Missing ticket ID or response text payload." });
  }

  try {
    const db = mongoose.connection.db;
    const result = await db.collection('tickets').updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { $set: { adminNote: String(adminResponse), resolved: false } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Ticket record could not be found." });
    }

    res.json({ success: true, message: "Admin reply dispatched successfully." });
  } catch (err) {
    console.error("[ADMIN REPLY CRASH]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 POST: /api/bridge/support/resolve (Admin Resolution Gateway via Wallet Guard)
router.post('/resolve', async (req, res) => {
  const { ticketId } = req.body;

  // 🦅 Hybrid Guard: Checks both request body and network headers to prevent 403 loops
  const adminAddress = req.body.adminAddress || req.headers['x-admin-address'];

  if (!adminAddress || typeof adminAddress !== 'string' || adminAddress.toLowerCase() !== ADMIN_WALLET) {
    return res.status(403).json({ success: false, message: "Unauthorized administrative signature context." });
  }

  if (!ticketId) {
    return res.status(400).json({ success: false, message: "Missing ticket ID payload." });
  }

  try {
    const db = mongoose.connection.db;
    const result = await db.collection('tickets').updateOne(
      { _id: new mongoose.Types.ObjectId(ticketId) },
      { $set: { resolved: true } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Ticket record could not be found." });
    }

    res.json({ success: true, message: "Ticket marked as resolved successfully." });
  } catch (err) {
    console.error("[ADMIN RESOLVE CRASH]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🦅 GET: /api/bridge/support/history/:userId (User Pulls Their Personal Thread)
router.get('/history/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: "Missing required user wallet parameter." });
  }

  try {
    const db = mongoose.connection.db;
    const tickets = await db.collection('tickets')
      .find({ userId: String(userId).toLowerCase() })
      .sort({ createdAt: 1 })
      .toArray();

    res.json({ success: true, tickets });
  } catch (err) {
    console.error("[USER HISTORY FETCH CRASH]:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
