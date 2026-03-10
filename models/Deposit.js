const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true
  },
  walletAddress: String,
  chain: String,
  token: String,
  txHash: String,
  amount: mongoose.Schema.Types.Decimal128,
  confirmations: Number,
  status: {
    type: String,
    enum: ['DETECTED', 'CONFIRMED', 'CREDITED'],
    default: 'DETECTED'
  }
}, { timestamps: true });

depositSchema.index({ txHash: 1, chain: 1 }, { unique: true });
depositSchema.index({ status: 1 });

module.exports = mongoose.model('Deposit', depositSchema);
