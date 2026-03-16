const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true,
    required: true
  },

  walletAddress: {
    type: String,
    required: true
  },

  chain: {
    type: String,
    required: true,
    index: true
  },

  token: {
    type: String,
    required: true
  },

  txHash: {
    type: String,
    required: true
  },

  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true
  },

  confirmations: {
    type: Number,
    default: 1
  },

  ledgerIndex: {
    type: Number,
    index: true
  },

  destinationTag: {
    type: String,
    index: true
  },

  txTimestamp: {
    type: Date
  },

  status: {
    type: String,
    enum: ['DETECTED', 'CONFIRMED', 'CREDITED'],
    default: 'DETECTED',
    index: true
  }

}, { timestamps: true });

depositSchema.index({ txHash: 1, chain: 1 }, { unique: true });

module.exports = mongoose.model('Deposit', depositSchema);    default: 'DETECTED'
  }
}, { timestamps: true });

// Unique index per chain + txHash
depositSchema.index({ txHash: 1, chain: 1 }, { unique: true });

// Index for status queries
depositSchema.index({ status: 1 });

module.exports = mongoose.model('Deposit', depositSchema);
