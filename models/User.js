const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  publicAddress: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true,          // ← normalize addresses (good practice)
  },

  depositTag: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },

  evmDeposits: {
    XDC: { type: String, lowercase: true },
    FLR: { type: String, lowercase: true },
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

  // ────────────────────────────────────────────────
  // Passkeys – very well structured
  // ────────────────────────────────────────────────
  passkeys: [{
    _id: false,

    credentialID: {
      type: String,
      required: true,
      index: true,              // ← fast lookup during auth
    },

    credentialPublicKey: {
      type: Buffer,
      required: true,
    },

    counter: {
      type: Number,
      required: true,
      default: 0,
    },

    transports: [{
      type: String,
      enum: ['usb', 'nfc', 'ble', 'internal', 'hybrid'], // optional enum
    }],

    attestationType: {
      type: String,
      enum: ['none', 'direct', 'enterprise', 'indirect'],
      default: 'none',
    },

    authenticatorAttachment: {
      type: String,
      enum: ['platform', 'cross-platform'],
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    // Optional: if you allow multiple wallets per user
    linkedChain: String,
    linkedAddress: String,
  }],

  dailyBridgeUsage: {
    type: Map,
    of: String,
    default: () => new Map(),
  },

  // Optional: last login / security fields
  lastLogin: Date,
  loginCount: { type: Number, default: 0 },

}, { timestamps: true });

// Add compound index if you query by credentialID often
userSchema.index({ "passkeys.credentialID": 1 });
