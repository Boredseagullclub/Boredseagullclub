// models/UsedSignature.js
const mongoose = require('mongoose');

const usedSignatureSchema = new mongoose.Schema({
  signature: { type: String, required: true, unique: true }, // The unique "fingerprint"
  walletAddress: { type: String, required: true, lowercase: true },
  createdAt: { type: Date, default: Date.now, expires: '24h' } // Auto-delete after 24h
});

usedSignatureSchema.index({ signature: 1 }, { unique: true });

module.exports = mongoose.model('UsedSignature', usedSignatureSchema);
