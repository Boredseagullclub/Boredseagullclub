const mongoose = require('mongoose');
const Decimal = require('decimal.js');

const userSchema = new mongoose.Schema({
  publicAddress: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true,
    trim: true,
  },

  // Per-chain memo/tag (XRP number, XLM text, etc.)
  depositTags: {
    type: Map,
    of: String,
    default: () => new Map(),
  },

  // Per-chain EVM deposit addresses
  evmDeposits: {
    type: Map,
    of: { type: String, lowercase: true, trim: true },
    default: () => new Map(),
  },

  tokens: [String],

  balances: {
    type: Map,
    of: mongoose.Schema.Types.Decimal128,
    default: () => new Map(),
  },

  nonce: {
    type: Number,
    default: 0,
  },

  // Passkeys (WebAuthn)
  passkeys: [{
    _id: false,
    credentialID: { type: String, required: true, index: true },
    credentialPublicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: [{ type: String, enum: ['usb', 'nfc', 'ble', 'internal', 'hybrid'] }],
    attestationType: { type: String, enum: ['none', 'direct', 'enterprise', 'indirect'], default: 'none' },
    authenticatorAttachment: { type: String, enum: ['platform', 'cross-platform'] },
    createdAt: { type: Date, default: Date.now },
    linkedChain: String,
    linkedAddress: String,
  }],

  dailyBridgeUsage: {
    type: Map,
    of: mongoose.Schema.Types.Decimal128,
    default: () => new Map(),
  },

  // Worker / job state
  processing: { type: Boolean, default: false, sparse: true, index: true },
  processingStartedAt: { type: Date },
  processingType: {
    type: String,
    enum: ['credit', 'withdraw', 'swap', 'auth', 'other'],
    sparse: true
  },
  retryCount: { type: Number, default: 0, index: true },
  errorMessage: { type: String, maxlength: 500 },

  // Login & security
  lastLogin: Date,
  loginCount: { type: Number, default: 0 },
  lastBalanceUpdate: Date,

}, { 
  timestamps: true,
  optimisticConcurrency: true 
});

// Indexes
userSchema.index({ "passkeys.credentialID": 1 }, { unique: true });
userSchema.index({ processing: 1, processingType: 1, processingStartedAt: 1 });
userSchema.index({ retryCount: 1 });

// Safe balance update method (using decimal.js)
userSchema.methods.updateBalance = function(tokenSymbol, deltaAmount) {
  const current = this.balances.get(tokenSymbol)
    ? new Decimal(this.balances.get(tokenSymbol).toString())
    : new Decimal(0);

  const delta = new Decimal(deltaAmount.toString());
  const newBalance = current.add(delta);

  this.balances.set(tokenSymbol, mongoose.Types.Decimal128.fromString(newBalance.toString()));
  this.lastBalanceUpdate = new Date();
};

module.exports = mongoose.model('User', userSchema);
