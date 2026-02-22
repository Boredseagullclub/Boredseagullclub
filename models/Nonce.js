// models/Nonce.js
const mongoose = require('mongoose');

const NonceSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  nonce: { type: Number, required: true },
  chain: { type: String, required: true },
  usedAt: { type: Date, default: Date.now, expires: 3600 } // TTL 1 hour
});

NonceSchema.index({ walletAddress: 1, nonce: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('Nonce', NonceSchema);
