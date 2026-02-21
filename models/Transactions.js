const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },
  fromToken: { type: String, required: true },
  toToken: { type: String, required: true },
  amount: { type: Number, required: true },
  received: { type: Number, required: true },
  fee: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
