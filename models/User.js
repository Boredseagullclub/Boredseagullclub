const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  publicAddress: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Memo routing (XRP/XLM/HBAR/ALGO)
  depositTag: {
  type: String,
  unique: true,
  sparse: true,
  index: true
},

  // EVM deposit addresses
  evmDeposits: {
    XDC: { type: String },
    FLR: { type: String }
  },

  tokens: {
    type: [String],
    default: []
  },

  // Store atomic values as strings
  balances: {
  type: Map,
  of: mongoose.Schema.Types.Decimal128, // Change this
  default: {}
},

  nonce: {
    type: Number,
    default: 0
  },

  // YYYY-MM-DD -> atomic usage
  dailyBridgeUsage: {
    type: Map,
    of: String,
    default: {}
  }

}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
