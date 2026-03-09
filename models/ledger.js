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

// Prevent duplicate credits
ledgerSchema.index(
  { txHash: 1, userId: 1, token: 1 },
  { unique: true, sparse: true }
);

// Fast user transaction history
ledgerSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Ledger', ledgerSchema);
