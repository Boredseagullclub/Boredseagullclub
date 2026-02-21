const mongoose = require('mongoose');

const balanceSchema = new mongoose.Schema({}, { strict: false });

const userSchema = new mongoose.Schema({
  publicAddress: { type: String, required: true, unique: true },
  tokens: { type: [String], default: [] },
  balances: { type: Map, of: Number, default: {} },
  dailyBridgeUsage: {
    type: Map,
    of: new mongoose.Schema({
      date: String, // YYYY-MM-DD
      total: { type: Number, default: 0 }
    }),
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
