const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
  type: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
  amountAtomic: { type: String, required: true },
  txHash: { type: String },
  reference: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ledger', ledgerSchema);
