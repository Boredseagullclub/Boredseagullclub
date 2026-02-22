// models/Nonce.js
const mongoose = require('mongoose');

const nonceSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  nonce: { type: Number, required: true },
  chain: { type: String, required: true },
}, { timestamps: true });

nonceSchema.index({ walletAddress: 1, nonce: 1, chain: 1 }, { unique: true });
nonceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 }); // auto-delete after 1hr

module.exports = mongoose.model('Nonce', nonceSchema);
