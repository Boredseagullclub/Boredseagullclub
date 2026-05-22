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

  depositTags: {
    type: Map,
    of: String,
    default: () => new Map(),
  },

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
    credentialID: { type: String, required: true },
    credentialPublicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: [{ type: String, enum: ['usb', 'nfc', 'ble', 'internal', 'hybrid'] }],
    attestationType: { type: String, enum: ['none', 'direct', 'enterprise', 'indirect'], default: 'none' },
    authenticatorAttachment: { type: String, enum: ['platform', 'cross-platform'] },
    createdAt: { type: Date, default: Date.now },
    linkedChain: String,
    linkedAddress: String,
  }],

  pendingWebauthnChallenge: { type: String, sparse: true },
  challengeExpiresAt: { 
    type: Date, 
    sparse: true, 
    expires: '5m' 
  },

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
  retryCount: { type: Number, default: 0 },
  errorMessage: { type: String, maxlength: 500 },

  // 🆔 KYC & COMPLIANCE LAYER (Moved inside the braces)
  kycStatus: { 
    type: String, 
    enum: ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'], 
    default: 'NONE',
    index: true 
  },
  kycData: {
    firstName: String,
    lastName: String,
    country: String,
    providerId: String, 
    verifiedAt: Date
  },

  // 📊 DAILY LIMITS (Moved inside the braces)
  limits: {
    dailyLimit: { type: mongoose.Schema.Types.Decimal128, default: "1000.00" },
    usedToday: { type: mongoose.Schema.Types.Decimal128, default: "0.00" }
  },

  // Login & security
  lastLogin: Date,
  loginCount: { type: Number, default: 0 },
  lastBalanceUpdate: Date,

}, { 
  timestamps: true,
  optimisticConcurrency: true 
});

// ... the rest of your indexes and methods stay exactly the same ...

