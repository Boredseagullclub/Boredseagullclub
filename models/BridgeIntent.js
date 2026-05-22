// models/BridgeIntent.js
const mongoose = require('mongoose');

const BridgeIntentSchema = new mongoose.Schema({
  userAddress: { type: String, required: true }, // The 0x or Wallet Address
  memo: { type: String, required: true, unique: true }, // The unique 6-8 digit code
  amount: { type: Number, required: true },
  asset: { type: String, required: true }, // SEAGULLCOIN or SEAGULLCASH
  fromChain: { type: String, required: true },
  toChain: { type: String, required: true },
  destinationAddress: { type: String, required: true }, // Where the funds go after bridge
  status: { type: String, default: 'pending', enum: ['pending', 'completed', 'failed'] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BridgeIntent', BridgeIntentSchema);

