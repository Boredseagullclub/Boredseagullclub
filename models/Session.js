// 🦅 THE ORDER TICKET (The Schema)
// File: models/Session.js

const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  session_id: { type: Number, required: true, unique: true }, // The Memo/Tag
  status: { 
    type: String, 
    enum: ['PENDING', 'PROCESSING', 'SETTLED', 'FAILED'], 
    default: 'PENDING' 
  },
  inbound: {
    chain: String,
    asset: String,
    tx_hash: String
  },
  outbound: {
    chain: String,
    asset: String,
    destination: String,
    amount: String,
    final_tx_hash: String
  },
  metadata: {
    iso_hash: String,
    service_level: { type: String, default: 'GRAND_SLAM' }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Session', sessionSchema);

