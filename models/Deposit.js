const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  walletAddress: String,        // user's public address
  chain: String,
  token: String,
  txHash: String,
  amount: Number,
  confirmations: Number,
  status: {
    type: String,
    enum: ['DETECTED', 'CONFIRMED', 'CREDITED'],
    default: 'DETECTED'
  }
}, { timestamps: true });

depositSchema.index({ txHash: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('Deposit', depositSchema);
