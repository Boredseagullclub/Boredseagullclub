const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  walletAddress: {
    type: String,
    required: true,
  },
  chain: {
    type: String,
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
  },
  txHash: {
    type: String,
    required: true,
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
  },
  confirmations: {
    type: Number,
    default: 1,
  },
  ledgerIndex: {
    type: Number,
    index: true,
  },
  destinationTag: {
    type: String,
    index: true,
  },
  txTimestamp: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['DETECTED', 'CONFIRMED', 'CREDITED'],
    default: 'DETECTED',
    index: true,
  },
}, { timestamps: true });

// Unique constraint: one deposit per txHash + chain
depositSchema.index({ txHash: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('Deposit', depositSchema);
