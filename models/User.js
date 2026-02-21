const mongoose = require('mongoose');

const balanceSchema = new mongoose.Schema({}, { strict: false });

const userSchema = new mongoose.Schema({
  publicAddress: { type: String, required: true, unique: true },
  tokens: { type: [String], default: [] },
  balances: { type: Map, of: Number, default: {} }
});

module.exports = mongoose.model('User', userSchema);
